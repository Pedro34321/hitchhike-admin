import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'hitchhike-pay-'));
process.env.DB_PATH = join(temp, 'test.sqlite');
delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
delete process.env.MERCADOPAGO_ACCESS_TOKEN;
delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
const { calcularValores, criarTratadorPagamentos, assinaturaWebhookValida } = await import('../pagamentos.js');
const { db: sqlite } = await import('../db.js');
const { server: servidorAdmin } = await import('../server.js');

const TOKEN_FIREBASE_VALIDO = 'token-firebase-de-teste-aaaaaaaaaaaaaaaa';
const SEGREDO = 'segredo-de-teste-do-webhook';
const AGORA = new Date('2026-11-15T12:00:00.000Z');

function criarFirestore(inicial = {}) {
  const docs = new Map(Object.entries(inicial));
  let seq = 0;
  const lerDoc = chave => ({ exists: docs.has(chave), data: () => (docs.has(chave) ? { ...docs.get(chave) } : undefined) });
  return {
    docs,
    collection(nome) {
      const filtros = [];
      let limite = Infinity;
      const consulta = {
        doc(id = `auto${++seq}`) {
          const chave = `${nome}/${id}`;
          return { id, path: chave, get: async () => lerDoc(chave), set: async dados => { docs.set(chave, { ...dados }); } };
        },
        where(campo, _op, valor) { filtros.push([campo, valor]); return consulta; },
        limit(n) { limite = n; return consulta; },
        async get() {
          const lista = [];
          for (const [chave, dado] of docs) {
            if (!chave.startsWith(`${nome}/`)) continue;
            if (filtros.every(([c, v]) => dado[c] === v)) lista.push({ id: chave.slice(nome.length + 1), data: () => ({ ...dado }) });
          }
          return { docs: lista.slice(0, limite) };
        }
      };
      return consulta;
    },
    async runTransaction(fn) {
      const preparado = new Map();
      const tx = {
        async get(ref) { return lerDoc(ref.path); },
        update(ref, campos) {
          if (!docs.has(ref.path)) throw new Error('documento inexistente');
          preparado.set(ref.path, { ...docs.get(ref.path), ...campos });
        }
      };
      const resultado = await fn(tx);
      for (const [chave, valor] of preparado) docs.set(chave, valor);
      return resultado;
    }
  };
}

function cenario(extra = {}) {
  return {
    'usuarios/pass1': { status: 'ATIVO', nome: 'Passageira' },
    'usuarios/pass2': { status: 'ATIVO' },
    'usuarios/pass3': { status: 'BLOQUEADO' },
    'usuarios/mot1': { status: 'ATIVO' },
    'caronas/carona1': { motoristaUid: 'mot1', valor: 20, status: 'ABERTA' },
    'caronas/caronaBarata': { motoristaUid: 'mot1', valor: 2, status: 'ABERTA' },
    'solicitacoes_caronas/carona1_pass1': { caronaId: 'carona1', passageiroUid: 'pass1', motoristaUid: 'mot1', status: 'ACEITA' },
    'solicitacoes_caronas/carona1_pass2': { caronaId: 'carona1', passageiroUid: 'pass2', motoristaUid: 'mot1', status: 'PENDENTE' },
    'solicitacoes_caronas/carona1_pass3': { caronaId: 'carona1', passageiroUid: 'pass3', motoristaUid: 'mot1', status: 'ACEITA' },
    'solicitacoes_caronas/caronaBarata_pass1': { caronaId: 'caronaBarata', passageiroUid: 'pass1', motoristaUid: 'mot1', status: 'ACEITA' },
    ...extra
  };
}

const UIDS_POR_TOKEN = {
  [TOKEN_FIREBASE_VALIDO]: { uid: 'pass1', email_verified: true },
  'token-pass2-de-teste-aaaaaaaaaaaaaaaaaa': { uid: 'pass2', email_verified: true },
  'token-pass3-de-teste-aaaaaaaaaaaaaaaaaa': { uid: 'pass3', email_verified: true },
  'token-sem-email-de-teste-aaaaaaaaaaaaaa': { uid: 'pass1', email_verified: false }
};

function montar({ firestore, respostasMp = [], config = {} } = {}) {
  const store = firestore ?? criarFirestore(cenario());
  const chamadasMp = [];
  const fila = [...respostasMp];
  const fetchFalso = async (url, opcoes = {}) => {
    chamadasMp.push({ url, opcoes, corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
    const resposta = fila.length ? fila.shift() : { status: 200, dados: {} };
    const r = typeof resposta === 'function' ? resposta(url, opcoes) : resposta;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.dados };
  };
  const tratar = criarTratadorPagamentos({
    firestore: () => store,
    verificarToken: async token => {
      if (!UIDS_POR_TOKEN[token]) throw new Error('inválido');
      return UIDS_POR_TOKEN[token];
    },
    fetch: fetchFalso,
    agora: () => AGORA,
    config: () => ({ accessToken: 'TOKEN-DE-TESTE-FALSO', webhookSecret: SEGREDO, baseUrl: 'https://exemplo-teste.onrender.com', urlCheckout: 'init_point', ...config })
  });
  const servidor = http.createServer((req, res) => tratar(req, res, new URL(req.url, 'http://localhost')));
  return { store, chamadasMp, servidor };
}

async function iniciar(servidor) {
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${servidor.address().port}`;
}
const encerrar = servidor => new Promise(r => servidor.close(r));

function assinar({ dataId, requestId = 'req-1', ts = '1731672000', segredo = SEGREDO }) {
  const manifesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return { 'x-signature': `ts=${ts},v1=${createHmac('sha256', segredo).update(manifesto).digest('hex')}`, 'x-request-id': requestId };
}

function postarPreferencia(base, corpo, token = TOKEN_FIREBASE_VALIDO) {
  return fetch(`${base}/api/pagamentos/preferencia`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(corpo)
  });
}

function postarWebhook(base, dataId, extraHeaders) {
  return fetch(`${base}/api/pagamentos/webhook?type=payment&data.id=${dataId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ type: 'payment', data: { id: dataId } })
  });
}

const pagamentoMp = (extra = {}) => ({
  id: 987654321,
  status: 'approved',
  status_detail: 'accredited',
  external_reference: 'auto1',
  transaction_amount: 25,
  currency_id: 'BRL',
  live_mode: false,
  date_last_updated: '2026-11-15T12:05:00.000-03:00',
  ...extra
});

test('cálculo monetário: taxa de 25% em centavos com arredondamento meio para cima', () => {
  assert.deepEqual(calcularValores(20), { baseCentavos: 2000, taxaCentavos: 500, totalCentavos: 2500 });
  assert.deepEqual(calcularValores(2.5), { baseCentavos: 250, taxaCentavos: 63, totalCentavos: 313 });
  assert.deepEqual(calcularValores(10.1), { baseCentavos: 1010, taxaCentavos: 253, totalCentavos: 1263 });
  assert.deepEqual(calcularValores(0.1 + 0.2), { baseCentavos: 30, taxaCentavos: 8, totalCentavos: 38 });
  for (const invalido of [0, -1, NaN, Infinity, '20', null, undefined]) assert.equal(calcularValores(invalido), null);
});

test('assinatura do webhook: manifesto, HMAC e entradas inválidas', () => {
  const ok = assinar({ dataId: '123' });
  assert.equal(assinaturaWebhookValida({ segredo: SEGREDO, xSignature: ok['x-signature'], xRequestId: 'req-1', dataId: '123' }), true);
  assert.equal(assinaturaWebhookValida({ segredo: SEGREDO, xSignature: ok['x-signature'], xRequestId: 'req-1', dataId: '124' }), false);
  assert.equal(assinaturaWebhookValida({ segredo: 'outro', xSignature: ok['x-signature'], xRequestId: 'req-1', dataId: '123' }), false);
  assert.equal(assinaturaWebhookValida({ segredo: SEGREDO, xSignature: 'ts=1,v1=zz', xRequestId: 'req-1', dataId: '123' }), false);
  assert.equal(assinaturaWebhookValida({ segredo: '', xSignature: ok['x-signature'], xRequestId: 'req-1', dataId: '123' }), false);
  assert.equal(assinaturaWebhookValida({ segredo: SEGREDO, xSignature: undefined, xRequestId: 'req-1', dataId: '123' }), false);
});

test('preferência: autenticação, autorização e regras de negócio', async () => {
  const { servidor, chamadasMp } = montar();
  const base = await iniciar(servidor);
  try {
    assert.equal((await postarPreferencia(base, { caronaId: 'carona1' }, null)).status, 401);
    assert.equal((await postarPreferencia(base, { caronaId: 'carona1' }, 'token-invalido-de-teste-aaaaaaaaaaaaaaa')).status, 401);
    assert.equal((await postarPreferencia(base, { caronaId: 'carona1' }, 'token-sem-email-de-teste-aaaaaaaaaaaaaa')).status, 403);
    assert.equal((await postarPreferencia(base, { caronaId: 'carona1' }, 'token-pass3-de-teste-aaaaaaaaaaaaaaaaaa')).status, 403);
    assert.equal((await postarPreferencia(base, { caronaId: 'carona1' }, 'token-pass2-de-teste-aaaaaaaaaaaaaaaaaa')).status, 409);
    assert.equal((await postarPreferencia(base, { caronaId: '../x' })).status, 400);
    assert.equal((await postarPreferencia(base, { caronaId: 'inexistente' })).status, 404);
    assert.equal((await postarPreferencia(base, { caronaId: 'caronaBarata' })).status, 422);
    assert.equal(chamadasMp.length, 0, 'nenhuma chamada ao Mercado Pago antes de passar nas validações');
    const get = await fetch(`${base}/api/pagamentos/preferencia`);
    assert.equal(get.status, 405);
  } finally { await encerrar(servidor); }
});

test('preferência: cria registro PENDENTE, ignora valores do app e não vaza segredos', async () => {
  const { servidor, store, chamadasMp } = montar({
    respostasMp: [{ status: 201, dados: { id: 'pref-1', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1', sandbox_init_point: 'https://sandbox.mercadopago.com.br/x' } }]
  });
  const base = await iniciar(servidor);
  try {
    const r = await postarPreferencia(base, { caronaId: 'carona1', valor: 0.01, total: 0.01, passageiroUid: 'pass2', status: 'APROVADO' });
    assert.equal(r.status, 201);
    const texto = await r.text();
    assert.ok(!texto.includes('TOKEN-DE-TESTE-FALSO'));
    const corpo = JSON.parse(texto);
    assert.deepEqual({ valorBase: corpo.valorBase, taxa: corpo.taxa, total: corpo.total, status: corpo.status }, { valorBase: 20, taxa: 5, total: 25, status: 'PENDENTE' });
    assert.match(corpo.checkoutUrl, /^https:\/\/www\.mercadopago\.com\.br\//);
    const enviado = chamadasMp[0];
    assert.equal(enviado.url, 'https://api.mercadopago.com/checkout/preferences');
    assert.equal(enviado.corpo.items[0].unit_price, 25);
    assert.equal(enviado.corpo.items[0].currency_id, 'BRL');
    assert.equal(enviado.corpo.external_reference, corpo.pagamentoId);
    assert.equal(enviado.corpo.notification_url, 'https://exemplo-teste.onrender.com/api/pagamentos/webhook');
    const gravado = store.docs.get(`pagamentos/${corpo.pagamentoId}`);
    assert.equal(gravado.status, 'PENDENTE');
    assert.equal(gravado.passageiroUid, 'pass1');
    assert.equal(gravado.solicitacaoId, 'carona1_pass1');
    assert.equal(gravado.totalCentavos, 2500);
    assert.equal(gravado.ambiente, 'TESTE');
  } finally { await encerrar(servidor); }
});

test('preferência: falha do Mercado Pago não cria registro e solicitação já paga é recusada', async () => {
  const falha = montar({ respostasMp: [{ status: 500, dados: { message: 'erro' } }] });
  let base = await iniciar(falha.servidor);
  try {
    assert.equal((await postarPreferencia(base, { caronaId: 'carona1' })).status, 502);
    assert.equal([...falha.store.docs.keys()].some(k => k.startsWith('pagamentos/')), false);
  } finally { await encerrar(falha.servidor); }

  const pago = montar({ firestore: criarFirestore(cenario({ 'pagamentos/antigo': { solicitacaoId: 'carona1_pass1', status: 'APROVADO' } })) });
  base = await iniciar(pago.servidor);
  try {
    assert.equal((await postarPreferencia(base, { caronaId: 'carona1' })).status, 409);
    assert.equal(pago.chamadasMp.length, 0);
  } finally { await encerrar(pago.servidor); }
});

function cenarioPagamento(extra = {}) {
  return cenario({
    'pagamentos/auto1': {
      id: 'auto1', caronaId: 'carona1', solicitacaoId: 'carona1_pass1', passageiroUid: 'pass1', motoristaUid: 'mot1',
      totalCentavos: 2500, total: 25, valorBase: 20, taxa: 5, status: 'PENDENTE', mpPaymentId: null, mpStatus: null, ...extra
    }
  });
}

test('webhook: exige assinatura válida e consulta a API antes de aprovar', async () => {
  const { servidor, store, chamadasMp } = montar({
    firestore: criarFirestore(cenarioPagamento()),
    respostasMp: [{ status: 200, dados: pagamentoMp() }, { status: 200, dados: pagamentoMp() }]
  });
  const base = await iniciar(servidor);
  try {
    assert.equal((await postarWebhook(base, '987654321', {})).status, 401);
    assert.equal((await postarWebhook(base, '987654321', assinar({ dataId: '987654321', segredo: 'errado' }))).status, 401);
    assert.equal((await postarWebhook(base, '987654321', assinar({ dataId: '111' }))).status, 401);
    assert.equal(chamadasMp.length, 0, 'sem assinatura válida não há consulta nem escrita');
    assert.equal(store.docs.get('pagamentos/auto1').status, 'PENDENTE');

    let r = await postarWebhook(base, '987654321', assinar({ dataId: '987654321' }));
    assert.equal(r.status, 200);
    assert.equal(chamadasMp[0].url, 'https://api.mercadopago.com/v1/payments/987654321');
    assert.equal(store.docs.get('pagamentos/auto1').status, 'APROVADO');
    assert.equal(store.docs.get('pagamentos/auto1').mpPaymentId, '987654321');

    r = await postarWebhook(base, '987654321', assinar({ dataId: '987654321', requestId: 'req-2' }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).resultado, 'ja_aprovado');
  } finally { await encerrar(servidor); }
});

test('webhook: divergências, tentativas antigas e eventos ignorados não aprovam nem sobrescrevem', async () => {
  const casos = [
    pagamentoMp({ transaction_amount: 20 }),
    pagamentoMp({ currency_id: 'USD' }),
    pagamentoMp({ live_mode: true })
  ];
  for (const mp of casos) {
    const { servidor, store } = montar({ firestore: criarFirestore(cenarioPagamento()), respostasMp: [{ status: 200, dados: mp }] });
    const base = await iniciar(servidor);
    try {
      assert.equal((await postarWebhook(base, '987654321', assinar({ dataId: '987654321' }))).status, 200);
      assert.equal(store.docs.get('pagamentos/auto1').status, 'DIVERGENTE');
    } finally { await encerrar(servidor); }
  }

  const aprovado = montar({
    firestore: criarFirestore(cenarioPagamento({ status: 'APROVADO', mpPaymentId: '1', mpStatus: 'approved' })),
    respostasMp: [{ status: 200, dados: pagamentoMp({ id: 2, status: 'rejected' }) }]
  });
  let base = await iniciar(aprovado.servidor);
  try {
    await postarWebhook(base, '2', assinar({ dataId: '2' }));
    assert.equal(aprovado.store.docs.get('pagamentos/auto1').status, 'APROVADO');
    assert.equal(aprovado.store.docs.get('pagamentos/auto1').mpPaymentId, '1');
  } finally { await encerrar(aprovado.servidor); }

  const antiga = montar({
    firestore: criarFirestore(cenarioPagamento({ status: 'EM_PROCESSAMENTO', mpUltimaAtualizacao: '2026-11-15T12:10:00.000-03:00' })),
    respostasMp: [{ status: 200, dados: pagamentoMp({ id: 3, status: 'rejected', date_last_updated: '2026-11-15T12:01:00.000-03:00' }) }]
  });
  base = await iniciar(antiga.servidor);
  try {
    await postarWebhook(base, '3', assinar({ dataId: '3' }));
    assert.equal(antiga.store.docs.get('pagamentos/auto1').status, 'EM_PROCESSAMENTO');
  } finally { await encerrar(antiga.servidor); }

  const outros = montar({ firestore: criarFirestore(cenarioPagamento()), respostasMp: [{ status: 404, dados: { message: 'not found' } }] });
  base = await iniciar(outros.servidor);
  try {
    const naoPagamento = await fetch(`${base}/api/pagamentos/webhook?type=merchant_order&data.id=55`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...assinar({ dataId: '55' }) }, body: '{}' });
    assert.equal(naoPagamento.status, 200);
    assert.equal(outros.chamadasMp.length, 0);
    const inexistente = await postarWebhook(base, '123456', assinar({ dataId: '123456' }));
    assert.equal(inexistente.status, 200);
    assert.equal(outros.store.docs.get('pagamentos/auto1').status, 'PENDENTE');
  } finally { await encerrar(outros.servidor); }

  const indisponivel = montar({ firestore: criarFirestore(cenarioPagamento()), respostasMp: [{ status: 503, dados: {} }] });
  base = await iniciar(indisponivel.servidor);
  try {
    assert.equal((await postarWebhook(base, '9', assinar({ dataId: '9' }))).status, 502);
  } finally { await encerrar(indisponivel.servidor); }

  const semSegredo = montar({ config: { webhookSecret: '' } });
  base = await iniciar(semSegredo.servidor);
  try {
    assert.equal((await postarWebhook(base, '9', assinar({ dataId: '9' }))).status, 503);
  } finally { await encerrar(semSegredo.servidor); }
});

test('status: só participantes consultam e a aprovação vem da API do Mercado Pago', async () => {
  const { servidor, store, chamadasMp } = montar({
    firestore: criarFirestore(cenarioPagamento()),
    respostasMp: [{ status: 200, dados: { results: [pagamentoMp({ id: 10, status: 'rejected', date_last_updated: '2026-11-15T12:01:00.000-03:00' }), pagamentoMp({ id: 11 })] } }]
  });
  const base = await iniciar(servidor);
  const status = token => fetch(`${base}/api/pagamentos/auto1/status`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  try {
    assert.equal((await status(null)).status, 401);
    assert.equal((await status('token-pass2-de-teste-aaaaaaaaaaaaaaaaaa')).status, 404);
    assert.equal(chamadasMp.length, 0);
    const r = await status(TOKEN_FIREBASE_VALIDO);
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.status, 'APROVADO');
    assert.equal(corpo.total, 25);
    assert.equal(corpo.consultaMp, 'ok');
    assert.match(chamadasMp[0].url, /\/v1\/payments\/search\?external_reference=auto1/);
    assert.equal(store.docs.get('pagamentos/auto1').mpPaymentId, '11');
    const novamente = await (await status(TOKEN_FIREBASE_VALIDO)).json();
    assert.equal(novamente.consultaMp, 'nao_necessaria');
    assert.equal(chamadasMp.length, 1);
  } finally { await encerrar(servidor); }
});

test('retorno do checkout não aprova nada e rotas desconhecidas respondem 404', async () => {
  const { servidor, store } = montar({ firestore: criarFirestore(cenarioPagamento()) });
  const base = await iniciar(servidor);
  try {
    const r = await fetch(`${base}/api/pagamentos/retorno?status=approved&external_reference=auto1&payment_id=1`);
    assert.equal(r.status, 200);
    assert.equal(store.docs.get('pagamentos/auto1').status, 'PENDENTE');
    assert.equal((await fetch(`${base}/api/pagamentos/aprovar`, { method: 'POST' })).status, 404);
  } finally { await encerrar(servidor); }
});

test('servidor administrativo: rotas de pagamento são isoladas e as demais continuam protegidas', async () => {
  await new Promise(r => servidorAdmin.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidorAdmin.address().port}`;
  try {
    const sessao = await fetch(`${base}/api/data`);
    assert.equal(sessao.status, 401);
    assert.match((await sessao.json()).error, /administrador/);
    assert.equal((await fetch(`${base}/api/usuarios`)).status, 401);
    assert.equal((await fetch(`${base}/api/caronas`)).status, 401);
    assert.equal((await fetch(`${base}/api/solicitacoes-motoristas/abc/decisao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);

    // Sem configuração, as rotas de pagamento respondem 503 (e não 401 de administrador).
    const preferencia = await postarPreferencia(base, { caronaId: 'x' });
    assert.equal(preferencia.status, 503);
    assert.doesNotMatch((await preferencia.json()).error, /administrador/);
    const webhook = await postarWebhook(base, '1', {});
    assert.equal(webhook.status, 503);
    assert.equal((await fetch(`${base}/api/pagamentos/retorno`)).status, 200);
  } finally { await new Promise(r => servidorAdmin.close(r)); }
});

after(() => { sqlite.close(); rmSync(temp, { recursive: true, force: true }); });
