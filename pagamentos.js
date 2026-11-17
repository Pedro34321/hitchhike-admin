// Pagamentos de TESTE com Mercado Pago Checkout Pro.
// O aplicativo nunca informa valores nem altera o status: tudo é recalculado e
// confirmado aqui, consultando a API do Mercado Pago. Credenciais só via ambiente.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { obterFirestore } from './firebaseMotoristas.js';
import { calcularSplit, conferirRepasse, lerTarifaEstimadaBp } from './split.js';
import { criarOauthMercadoPago } from './mercadopagoOauth.js';

const MP_API = 'https://api.mercadopago.com';
const TAXA_PERCENTUAL = 25;
const MINIMO_CENTAVOS = 250; // R$ 2,50
const MAXIMO_CENTAVOS = 100000; // R$ 1.000,00 (limite de segurança para o valor-base)
const ID_SEGURO = /^[A-Za-z0-9_-]{1,128}$/;
const ID_MP = /^\d{1,20}$/;

function falhar(status, mensagem) {
  throw Object.assign(new Error(mensagem), { status });
}

function json(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}

/** Cálculo em centavos inteiros: taxa de 25% com arredondamento "meio para cima". */
export function calcularValores(valorBase) {
  if (typeof valorBase !== 'number' || !Number.isFinite(valorBase) || valorBase <= 0) return null;
  const baseCentavos = Math.round(Number((valorBase * 100).toFixed(4)));
  const taxaCentavos = Math.floor((baseCentavos * TAXA_PERCENTUAL + 50) / 100);
  return { baseCentavos, taxaCentavos, totalCentavos: baseCentavos + taxaCentavos };
}

const reais = centavos => centavos / 100;

export function statusInterno(statusMp) {
  switch (statusMp) {
    case 'approved': return 'APROVADO';
    case 'rejected': return 'RECUSADO';
    case 'cancelled': return 'CANCELADO';
    case 'pending': case 'in_process': case 'in_mediation': case 'authorized': return 'EM_PROCESSAMENTO';
    default: return null;
  }
}

/** Valida x-signature conforme a documentação oficial: HMAC-SHA256 do manifesto. */
export function assinaturaWebhookValida({ segredo, xSignature, xRequestId, dataId }) {
  if (!segredo || typeof xSignature !== 'string') return false;
  let ts = '';
  let v1 = '';
  for (const parte of xSignature.split(',')) {
    const [chave, valor] = parte.split('=').map(x => x?.trim());
    if (chave === 'ts') ts = valor || '';
    if (chave === 'v1') v1 = (valor || '').toLowerCase();
  }
  if (!ts || !/^[a-f0-9]{64}$/.test(v1)) return false;
  let manifesto = '';
  if (dataId) manifesto += `id:${/^[A-Za-z0-9]+$/.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (xRequestId) manifesto += `request-id:${xRequestId};`;
  manifesto += `ts:${ts};`;
  const esperado = createHmac('sha256', segredo).update(manifesto).digest();
  return timingSafeEqual(esperado, Buffer.from(v1, 'hex'));
}

async function lerJson(req, limite = 16384) {
  let texto = '';
  for await (const pedaco of req) {
    texto += pedaco;
    if (Buffer.byteLength(texto) > limite) falhar(413, 'Requisição muito grande.');
  }
  try { return JSON.parse(texto || '{}'); } catch { return falhar(400, 'JSON inválido.'); }
}

function data(valor) {
  if (typeof valor?.toDate === 'function') return valor.toDate();
  return valor instanceof Date ? valor : null;
}

export function criarTratadorPagamentos(deps = {}) {
  const d = {
    config: () => ({
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
      webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET || '',
      baseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
      urlCheckout: process.env.MERCADOPAGO_CHECKOUT_URL === 'sandbox_init_point' ? 'sandbox_init_point' : 'init_point',
      // Split 1:1: DESLIGADO por padrão. Só ativa com MERCADOPAGO_SPLIT_ENABLED=true.
      splitAtivo: process.env.MERCADOPAGO_SPLIT_ENABLED === 'true',
      // Tarifa Mercado Pago ESTIMADA (%). Sem valor configurado o split não é habilitado.
      tarifaBp: lerTarifaEstimadaBp(process.env.MERCADOPAGO_TARIFA_PIX_PERCENT || ''),
      // Restringe o checkout a Pix (bank_transfer) para a estimativa de tarifa fazer sentido.
      restringirPix: process.env.MERCADOPAGO_SPLIT_SOMENTE_PIX !== 'false'
    }),
    firestore: () => obterFirestore(),
    verificarToken: async token => {
      const app = getApps()[0];
      if (!app) throw new Error('Firebase Admin indisponível.');
      return getAuth(app).verifyIdToken(token, true);
    },
    fetch: (...args) => globalThis.fetch(...args),
    agora: () => new Date(),
    ...deps
  };

  const banco = () => d.firestore() || falhar(503, 'Integração com o Firebase indisponível.');

  function configuracao({ exigirToken = false, exigirSegredo = false } = {}) {
    const c = d.config();
    if (exigirToken && !c.accessToken) falhar(503, 'Pagamentos de teste não configurados.');
    if (exigirSegredo && !c.webhookSecret) falhar(503, 'Webhook de pagamentos não configurado.');
    return c;
  }

  const oauth = d.oauth || criarOauthMercadoPago({ fetch: d.fetch, agora: d.agora });

  async function mercadoPago(caminho, { method = 'GET', body, chaveIdempotencia, token } = {}) {
    const accessToken = token || d.config().accessToken;
    const cabecalhos = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
    if (body) cabecalhos['Content-Type'] = 'application/json';
    if (chaveIdempotencia) cabecalhos['X-Idempotency-Key'] = chaveIdempotencia;
    const resposta = await d.fetch(MP_API + caminho, {
      method,
      headers: cabecalhos,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    });
    let dados = null;
    try { dados = await resposta.json(); } catch { /* corpo vazio ou inválido */ }
    return { ok: resposta.ok, status: resposta.status, dados };
  }

  async function autenticar(req) {
    const db = banco();
    const correspondencia = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(req.headers.authorization || '');
    if (!correspondencia) falhar(401, 'Faça login para continuar.');
    let token;
    try { token = await d.verificarToken(correspondencia[1]); } catch { return falhar(401, 'Sessão inválida ou expirada.'); }
    if (!token?.uid || !ID_SEGURO.test(token.uid)) falhar(401, 'Sessão inválida ou expirada.');
    if (token.email_verified !== true) falhar(403, 'Confirme seu e-mail institucional para pagar.');
    const perfil = await db.collection('usuarios').doc(token.uid).get();
    if (!perfil.exists || perfil.data()?.status !== 'ATIVO') falhar(403, 'Seu cadastro não está ativo.');
    return token.uid;
  }

  /** Aplica um pagamento já confirmado na API do Mercado Pago. Idempotente. */
  async function aplicarPagamentoMp(db, mp) {
    const pagamentoId = typeof mp?.external_reference === 'string' ? mp.external_reference : '';
    if (!ID_SEGURO.test(pagamentoId)) return { ignorado: 'sem_referencia' };
    const novoStatus = statusInterno(mp.status);
    if (!novoStatus) return { ignorado: 'status_desconhecido' };
    const ref = db.collection('pagamentos').doc(pagamentoId);
    return db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { ignorado: 'nao_encontrado' };
      const atual = doc.data() || {};
      const financeiro = () => {
        if (atual.split !== true || mp.status !== 'approved') return {};
        const c = conferirRepasse(mp, atual.valorBaseCentavos);
        const campos = {
          reconciliacao: c.situacao,
          tarifaRealCentavos: c.tarifaRealCentavos ?? null,
          comissaoRealCentavos: c.comissaoRealCentavos ?? null,
          liquidoMotoristaCentavos: c.liquidoMotoristaCentavos ?? null,
          diferencaMotoristaCentavos: c.diferencaMotoristaCentavos ?? null,
          divergenciaFinanceira: c.situacao === 'DIVERGENTE'
        };
        return campos;
      };
      if (atual.status === 'APROVADO') {
        // Aprovação nunca regride; só completa a conferência financeira se ainda estava indisponível.
        if (atual.split === true && atual.reconciliacao === 'INDISPONIVEL' && mp.status === 'approved'
          && String(mp.id) === atual.mpPaymentId) {
          const extra = financeiro();
          if (extra.reconciliacao && extra.reconciliacao !== 'INDISPONIVEL') tx.update(ref, { ...extra, atualizadoEm: d.agora() });
        }
        return { ignorado: 'ja_aprovado', status: 'APROVADO' };
      }
      const ultimaMp = mp.date_last_updated ? Date.parse(mp.date_last_updated) : NaN;
      const ultimaGravada = atual.mpUltimaAtualizacao ? Date.parse(atual.mpUltimaAtualizacao) : NaN;
      if (novoStatus !== 'APROVADO' && Number.isFinite(ultimaMp) && Number.isFinite(ultimaGravada) && ultimaMp < ultimaGravada) {
        return { ignorado: 'tentativa_antiga', status: atual.status };
      }
      const valorConfere = typeof mp.transaction_amount === 'number'
        && Math.round(Number((mp.transaction_amount * 100).toFixed(4))) === atual.totalCentavos;
      const coletorConfere = atual.split !== true || String(mp.collector_id ?? '') === atual.mpCollectorId;
      const consistente = mp.currency_id === 'BRL' && valorConfere && coletorConfere && mp.live_mode !== true;
      const agora = d.agora();
      const campos = {
        mpPaymentId: String(mp.id),
        mpStatus: String(mp.status),
        mpStatusDetail: typeof mp.status_detail === 'string' ? mp.status_detail.slice(0, 100) : null,
        mpUltimaAtualizacao: typeof mp.date_last_updated === 'string' ? mp.date_last_updated : null,
        atualizadoEm: agora
      };
      if (!consistente) {
        tx.update(ref, { ...campos, status: 'DIVERGENTE' });
        return { status: 'DIVERGENTE' };
      }
      if (novoStatus === 'APROVADO') Object.assign(campos, { aprovadoEm: agora }, financeiro());
      tx.update(ref, { ...campos, status: novoStatus });
      return { status: novoStatus };
    });
  }

  async function reconciliarPorReferencia(db, pagamentoId, token) {
    const r = await mercadoPago(`/v1/payments/search?external_reference=${encodeURIComponent(pagamentoId)}&sort=date_created&criteria=desc&limit=10`, { token });
    if (!r.ok || !Array.isArray(r.dados?.results)) return false;
    const ordenados = r.dados.results
      .filter(p => p?.external_reference === pagamentoId)
      .sort((a, b) => Date.parse(a.date_last_updated || 0) - Date.parse(b.date_last_updated || 0));
    for (const pagamento of ordenados) await aplicarPagamentoMp(db, pagamento);
    return true;
  }

  async function criarPreferencia(req, res) {
    const config = configuracao({ exigirToken: !d.config().splitAtivo });
    if (!req.headers['content-type']?.startsWith('application/json')) falhar(415, 'Use application/json.');
    const corpo = await lerJson(req);
    const caronaId = corpo?.caronaId;
    if (typeof caronaId !== 'string' || !ID_SEGURO.test(caronaId)) falhar(400, 'Carona inválida.');
    const uid = await autenticar(req);
    const db = banco();

    // Valores e passageiroUid enviados pelo app são ignorados: tudo vem do Firestore.
    const solicitacaoId = `${caronaId}_${uid}`;
    const solicitacao = await db.collection('solicitacoes_caronas').doc(solicitacaoId).get();
    if (!solicitacao.exists) falhar(404, 'Solicitação não encontrada.');
    const pedido = solicitacao.data() || {};
    if (pedido.passageiroUid !== uid || pedido.caronaId !== caronaId) falhar(403, 'Solicitação não pertence a este passageiro.');
    if (pedido.status !== 'ACEITA') falhar(409, 'O pagamento só é liberado após o motorista aceitar o pedido.');

    const carona = await db.collection('caronas').doc(caronaId).get();
    if (!carona.exists) falhar(404, 'Carona não encontrada.');
    const dadosCarona = carona.data() || {};
    if (dadosCarona.status === 'CANCELADA') falhar(409, 'Esta carona foi cancelada.');
    if (!dadosCarona.motoristaUid || dadosCarona.motoristaUid !== pedido.motoristaUid || dadosCarona.motoristaUid === uid) {
      falhar(409, 'Dados da carona inconsistentes.');
    }
    const valores = calcularValores(dadosCarona.valor);
    if (!valores || valores.baseCentavos < MINIMO_CENTAVOS) falhar(422, 'O valor-base mínimo para pagamento é R$ 2,50.');
    if (valores.baseCentavos > MAXIMO_CENTAVOS) falhar(422, 'Valor-base acima do limite permitido no ambiente de teste.');

    const jaPago = await db.collection('pagamentos').where('solicitacaoId', '==', solicitacaoId).where('status', '==', 'APROVADO').limit(1).get();
    if (jaPago.docs.length) falhar(409, 'Esta solicitação já foi paga.');

    // Split 1:1 (desligado por padrão): usa a conta OAuth do motorista e marketplace_fee.
    let split = null;
    if (config.splitAtivo) {
      if (config.tarifaBp === null) falhar(503, 'Split de pagamentos não configurado (tarifa estimada ausente).');
      const conta = await oauth.obterContaMotorista(dadosCarona.motoristaUid);
      if (!conta) falhar(409, 'O motorista ainda não vinculou a conta do Mercado Pago.');
      const calculo = calcularSplit({ baseCentavos: valores.baseCentavos, taxaCentavos: valores.taxaCentavos, tarifaBp: config.tarifaBp });
      if (!calculo.viavel) falhar(422, 'Valor insuficiente para dividir o pagamento.');
      split = { calculo, conta };
    }

    const ref = db.collection('pagamentos').doc();
    const pagamentoId = ref.id;
    const corpoPreferencia = {
      items: [{
        id: caronaId,
        title: 'Carona Hitchhike (pagamento de teste)',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: reais(valores.totalCentavos)
      }],
      external_reference: pagamentoId,
      statement_descriptor: 'HITCHHIKE'
    };
    if (split) {
      corpoPreferencia.marketplace_fee = reais(split.calculo.marketplaceFeeCentavos);
      if (config.restringirPix) {
        // Pendente de validação prática: tipos excluídos para deixar apenas Pix (bank_transfer).
        corpoPreferencia.payment_methods = {
          excluded_payment_types: ['credit_card', 'debit_card', 'ticket', 'atm', 'prepaid_card', 'account_money']
        };
      }
    }
    if (/^https:\/\/[^\s/]+/.test(config.baseUrl)) {
      // No split o pid indica qual conta de motorista consultar; a aprovação continua dependendo da assinatura e da API.
      corpoPreferencia.notification_url = `${config.baseUrl}/api/pagamentos/webhook${split ? `?pid=${pagamentoId}` : ''}`;
      const retorno = `${config.baseUrl}/api/pagamentos/retorno`;
      corpoPreferencia.back_urls = { success: retorno, pending: retorno, failure: retorno };
      corpoPreferencia.auto_return = 'approved';
    }
    const criada = await mercadoPago('/checkout/preferences', { method: 'POST', body: corpoPreferencia, chaveIdempotencia: pagamentoId, token: split?.conta.accessToken });
    const urlCheckout = criada.dados?.[config.urlCheckout];
    if (!criada.ok || typeof criada.dados?.id !== 'string' || typeof urlCheckout !== 'string') {
      console.error(`Mercado Pago recusou a criação da preferência (HTTP ${criada.status}).`);
      falhar(502, 'Não foi possível criar o checkout de teste. Tente novamente.');
    }

    const agora = d.agora();
    await ref.set({
      id: pagamentoId,
      caronaId,
      solicitacaoId,
      passageiroUid: uid,
      motoristaUid: dadosCarona.motoristaUid,
      valorBaseCentavos: valores.baseCentavos,
      taxaCentavos: valores.taxaCentavos,
      totalCentavos: valores.totalCentavos,
      valorBase: reais(valores.baseCentavos),
      taxa: reais(valores.taxaCentavos),
      total: reais(valores.totalCentavos),
      taxaPercentual: TAXA_PERCENTUAL,
      moeda: 'BRL',
      ambiente: 'TESTE',
      status: 'PENDENTE',
      mpPreferenceId: criada.dados.id,
      mpPaymentId: null,
      mpStatus: null,
      ...(split ? {
        split: true,
        mpCollectorId: split.conta.collectorId,
        marketplaceFeeCentavos: split.calculo.marketplaceFeeCentavos,
        tarifaEstimadaCentavos: split.calculo.tarifaEstimadaCentavos,
        tarifaEstimadaBp: config.tarifaBp,
        motoristaPrevistoCentavos: split.calculo.motoristaPrevistoCentavos,
        somentePix: config.restringirPix,
        reconciliacao: 'PENDENTE',
        divergenciaFinanceira: false
      } : { split: false }),
      criadoEm: agora,
      atualizadoEm: agora
    });
    json(res, 201, {
      pagamentoId,
      checkoutUrl: urlCheckout,
      valorBase: reais(valores.baseCentavos),
      taxa: reais(valores.taxaCentavos),
      total: reais(valores.totalCentavos),
      status: 'PENDENTE'
    });
  }

  async function consultarStatus(req, res, pagamentoId) {
    const uid = await autenticar(req);
    const db = banco();
    const ref = db.collection('pagamentos').doc(pagamentoId);
    let doc = await ref.get();
    const inicial = doc.exists ? doc.data() || {} : null;
    if (!inicial || (inicial.passageiroUid !== uid && inicial.motoristaUid !== uid)) falhar(404, 'Pagamento não encontrado.');
    let consultaMp = 'nao_necessaria';
    if (inicial.status !== 'APROVADO' && inicial.passageiroUid === uid) {
      try {
        let token = d.config().accessToken;
        if (inicial.split === true) token = (await oauth.obterContaMotorista(inicial.motoristaUid))?.accessToken || '';
        consultaMp = token && (await reconciliarPorReferencia(db, pagamentoId, token)) ? 'ok' : 'indisponivel';
      } catch {
        consultaMp = 'indisponivel';
      }
      doc = await ref.get();
    }
    const p = doc.data() || {};
    json(res, 200, {
      pagamentoId,
      status: p.status,
      valorBase: p.valorBase,
      taxa: p.taxa,
      total: p.total,
      mpStatus: p.mpStatus ?? null,
      atualizadoEm: data(p.atualizadoEm)?.toISOString() ?? null,
      consultaMp
    });
  }

  async function receberWebhook(req, res, url) {
    const config = configuracao({ exigirSegredo: true });
    const corpo = await lerJson(req);
    const dataId = String(url.searchParams.get('data.id') ?? corpo?.data?.id ?? '');
    const valida = assinaturaWebhookValida({
      segredo: config.webhookSecret,
      xSignature: req.headers['x-signature'],
      xRequestId: req.headers['x-request-id'],
      dataId
    });
    if (!valida) {
      console.warn('Webhook de pagamento rejeitado: assinatura inválida.');
      falhar(401, 'Assinatura inválida.');
    }
    const tipo = url.searchParams.get('type') ?? url.searchParams.get('topic') ?? corpo?.type ?? corpo?.topic;
    if (tipo !== 'payment' || !ID_MP.test(dataId)) {
      json(res, 200, { ok: true, ignorado: 'evento_nao_tratado' });
      return;
    }
    const db = banco();
    // Pagamentos em split pertencem à conta do motorista: a consulta usa o token dele (via pid).
    let token = config.accessToken;
    const pid = url.searchParams.get('pid');
    if (pid && ID_SEGURO.test(pid)) {
      const alvo = await db.collection('pagamentos').doc(pid).get();
      if (alvo.exists && alvo.data()?.split === true) {
        try { token = (await oauth.obterContaMotorista(alvo.data().motoristaUid))?.accessToken || ''; } catch { token = ''; }
      }
    }
    if (!token) falhar(503, 'Pagamentos de teste não configurados.');
    let consulta;
    try { consulta = await mercadoPago(`/v1/payments/${dataId}`, { token }); } catch { consulta = null; }
    if (!consulta || consulta.status >= 500 || consulta.status === 429) falhar(502, 'Mercado Pago indisponível. Tente novamente.');
    if (!consulta.ok || !consulta.dados) {
      json(res, 200, { ok: true, ignorado: 'pagamento_nao_encontrado' });
      return;
    }
    const resultado = await aplicarPagamentoMp(db, consulta.dados);
    json(res, 200, { ok: true, resultado: resultado.ignorado || resultado.status });
  }

  return async function tratarPagamentos(req, res, url) {
    const caminho = url.pathname;
    try {
      let status;
      if (caminho === '/api/pagamentos/preferencia') {
        if (req.method !== 'POST') falhar(405, 'Método não permitido.');
        await criarPreferencia(req, res);
      } else if (caminho === '/api/pagamentos/webhook') {
        if (req.method !== 'POST') falhar(405, 'Método não permitido.');
        await receberWebhook(req, res, url);
      } else if (caminho === '/api/pagamentos/retorno') {
        if (req.method !== 'GET') falhar(405, 'Método não permitido.');
        // Página informativa: o resultado NUNCA é lido da URL de retorno.
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hitchhike</title><p>Pagamento enviado para confirmação. Volte ao aplicativo Hitchhike para ver o resultado.</p>');
      } else if ((status = /^\/api\/pagamentos\/([A-Za-z0-9_-]{1,128})\/status$/.exec(caminho))) {
        if (req.method !== 'GET') falhar(405, 'Método não permitido.');
        await consultarStatus(req, res, status[1]);
      } else {
        falhar(404, 'Rota não encontrada.');
      }
    } catch (erro) {
      if (erro.status) json(res, erro.status, { error: erro.message });
      else {
        console.error(`Falha inesperada no módulo de pagamentos (${erro.name}).`);
        json(res, 500, { error: 'Erro interno. Tente novamente.' });
      }
    }
    return true;
  };
}

export const tratarPagamentos = criarTratadorPagamentos();
