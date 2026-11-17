// Vínculo OAuth do motorista com o Mercado Pago (Split 1:1) — somente ambiente de TESTE.
// Tokens ficam apenas no SQLite do backend, cifrados com AES-256-GCM. Nunca vão ao app,
// ao Firestore, aos logs ou ao repositório. Credenciais só via variáveis de ambiente.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const MP_API = 'https://api.mercadopago.com';
const MP_AUTH = 'https://auth.mercadopago.com.br/authorization';
const VALIDADE_STATE_MS = 10 * 60 * 1000;
const MARGEM_RENOVACAO_MS = 5 * 60 * 1000;

function falhar(status, mensagem, codigo) {
  throw Object.assign(new Error(mensagem), { status, codigo });
}

function json(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}

function pagina(res, status, titulo, texto) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hitchhike</title><h3>${titulo}</h3><p>${texto}</p>`);
}

const sha256 = texto => createHash('sha256').update(texto).digest('hex');

/** Chave de 32 bytes em hex (64 caracteres) ou base64. Retorna null se inválida. */
export function lerChaveCifra(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  if (/^[a-fA-F0-9]{64}$/.test(texto)) return Buffer.from(texto, 'hex');
  if (/^[A-Za-z0-9+/]{43}=$/.test(texto)) {
    const bytes = Buffer.from(texto, 'base64');
    return bytes.length === 32 ? bytes : null;
  }
  return null;
}

export function cifrar(texto, chave) {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  return ['v1', iv.toString('base64'), cifra.getAuthTag().toString('base64'), dados.toString('base64')].join(':');
}

export function decifrar(registro, chave) {
  const [versao, iv, tag, dados] = String(registro).split(':');
  if (versao !== 'v1' || !iv || !tag || !dados) throw new Error('Registro cifrado inválido.');
  const decifra = createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64'));
  decifra.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decifra.update(Buffer.from(dados, 'base64')), decifra.final()]).toString('utf8');
}

export function criarOauthMercadoPago(deps = {}) {
  const d = {
    config: () => ({
      clientId: process.env.MERCADOPAGO_CLIENT_ID || '',
      clientSecret: process.env.MERCADOPAGO_CLIENT_SECRET || '',
      redirectUri: process.env.MERCADOPAGO_REDIRECT_URI || '',
      chave: lerChaveCifra(process.env.MERCADOPAGO_TOKEN_KEY || '')
    }),
    fetch: (...args) => globalThis.fetch(...args),
    agora: () => new Date(),
    banco: null, // DatabaseSync; por padrão usa o SQLite do servidor (carregado sob demanda)
    ...deps
  };

  let pronto = null;
  async function sqlite() {
    if (!pronto) {
      pronto = (async () => {
        const conexao = d.banco || (await import('./db.js')).db;
        conexao.exec(`CREATE TABLE IF NOT EXISTS mp_contas(uid TEXT PRIMARY KEY, collector_id TEXT NOT NULL, access_cifrado TEXT NOT NULL, refresh_cifrado TEXT NOT NULL, expira_em INTEGER NOT NULL, atualizado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mp_oauth_states(hash TEXT PRIMARY KEY, uid TEXT NOT NULL, expira INTEGER NOT NULL);`);
        return conexao;
      })();
    }
    return pronto;
  }

  function configuracao() {
    const c = d.config();
    if (!c.clientId || !c.clientSecret || !/^https:\/\/[^\s]+$/.test(c.redirectUri) || !c.chave) {
      falhar(503, 'Vínculo com o Mercado Pago não configurado.', 'oauth_nao_configurado');
    }
    return c;
  }

  async function chamarToken(corpo) {
    let resposta;
    try {
      resposta = await d.fetch(`${MP_API}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      falhar(502, 'Mercado Pago indisponível. Tente novamente.', 'mp_indisponivel');
    }
    let dados = null;
    try { dados = await resposta.json(); } catch { /* corpo inválido */ }
    if (resposta.status >= 500 || resposta.status === 429) falhar(502, 'Mercado Pago indisponível. Tente novamente.', 'mp_indisponivel');
    if (!resposta.ok || typeof dados?.access_token !== 'string' || typeof dados?.refresh_token !== 'string') {
      falhar(400, 'O Mercado Pago recusou a autorização.', 'autorizacao_recusada');
    }
    if (dados.live_mode === true) falhar(400, 'Credenciais de produção não são aceitas nesta etapa de testes.', 'producao_bloqueada');
    return dados;
  }

  async function iniciar(uid) {
    const c = configuracao();
    const conexao = await sqlite();
    const agora = d.agora().getTime();
    conexao.prepare('DELETE FROM mp_oauth_states WHERE expira < ?').run(agora);
    const state = randomBytes(32).toString('hex');
    conexao.prepare('INSERT INTO mp_oauth_states(hash,uid,expira) VALUES(?,?,?)').run(sha256(state), uid, agora + VALIDADE_STATE_MS);
    const url = new URL(MP_AUTH);
    url.searchParams.set('client_id', c.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('platform_id', 'mp');
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', c.redirectUri);
    return url.toString();
  }

  /** Conclui a autorização. Falhas lançam erro com `codigo`; nunca incluem tokens. */
  async function concluir(code, state) {
    const c = configuracao();
    if (typeof code !== 'string' || !/^[A-Za-z0-9._-]{4,512}$/.test(code)) falhar(400, 'Autorização inválida.', 'codigo_invalido');
    if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) falhar(400, 'Autorização inválida.', 'state_invalido');
    const conexao = await sqlite();
    const agora = d.agora().getTime();
    const registro = conexao.prepare('SELECT uid, expira FROM mp_oauth_states WHERE hash = ?').get(sha256(state));
    conexao.prepare('DELETE FROM mp_oauth_states WHERE hash = ?').run(sha256(state)); // uso único
    if (!registro || registro.expira < agora) falhar(400, 'A autorização expirou. Inicie novamente pelo aplicativo.', 'state_expirado');
    const dados = await chamarToken({
      grant_type: 'authorization_code',
      client_id: c.clientId,
      client_secret: c.clientSecret,
      code,
      redirect_uri: c.redirectUri
    });
    const collectorId = String(dados.user_id ?? '');
    if (!/^\d{1,20}$/.test(collectorId)) falhar(400, 'O Mercado Pago recusou a autorização.', 'autorizacao_recusada');
    const expiraEm = agora + (Number.isFinite(dados.expires_in) ? dados.expires_in : 15552000) * 1000;
    conexao.prepare(`INSERT INTO mp_contas(uid,collector_id,access_cifrado,refresh_cifrado,expira_em,atualizado_em) VALUES(?,?,?,?,?,?)
      ON CONFLICT(uid) DO UPDATE SET collector_id=excluded.collector_id, access_cifrado=excluded.access_cifrado, refresh_cifrado=excluded.refresh_cifrado, expira_em=excluded.expira_em, atualizado_em=excluded.atualizado_em`)
      .run(registro.uid, collectorId, cifrar(dados.access_token, c.chave), cifrar(dados.refresh_token, c.chave), expiraEm, d.agora().toISOString());
    return { uid: registro.uid };
  }

  async function vinculado(uid) {
    const conexao = await sqlite();
    return Boolean(conexao.prepare('SELECT 1 FROM mp_contas WHERE uid = ?').get(uid));
  }

  /** Token do motorista (renova se estiver perto de expirar). Retorna null se não houver vínculo. */
  async function obterContaMotorista(uid) {
    const c = configuracao();
    const conexao = await sqlite();
    const linha = conexao.prepare('SELECT * FROM mp_contas WHERE uid = ?').get(uid);
    if (!linha) return null;
    let accessToken = decifrar(linha.access_cifrado, c.chave);
    let expiraEm = linha.expira_em;
    if (expiraEm - d.agora().getTime() < MARGEM_RENOVACAO_MS) {
      const dados = await chamarToken({
        grant_type: 'refresh_token',
        client_id: c.clientId,
        client_secret: c.clientSecret,
        refresh_token: decifrar(linha.refresh_cifrado, c.chave)
      });
      accessToken = dados.access_token;
      expiraEm = d.agora().getTime() + (Number.isFinite(dados.expires_in) ? dados.expires_in : 15552000) * 1000;
      conexao.prepare('UPDATE mp_contas SET access_cifrado=?, refresh_cifrado=?, expira_em=?, atualizado_em=? WHERE uid=?')
        .run(cifrar(accessToken, c.chave), cifrar(dados.refresh_token, c.chave), expiraEm, d.agora().toISOString(), uid);
    }
    return { accessToken, collectorId: linha.collector_id };
  }

  async function desvincular(uid) {
    const conexao = await sqlite();
    conexao.prepare('DELETE FROM mp_contas WHERE uid = ?').run(uid);
  }

  /** Rotas /api/mercadopago/oauth/*. `autenticar(req)` devolve o uid do Firebase. */
  async function tratar(req, res, url, autenticar) {
    const caminho = url.pathname;
    if (caminho === '/api/mercadopago/oauth/iniciar') {
      if (req.method !== 'POST') falhar(405, 'Método não permitido.');
      const uid = await autenticar(req);
      json(res, 200, { authUrl: await iniciar(uid) });
    } else if (caminho === '/api/mercadopago/oauth/status') {
      if (req.method !== 'GET') falhar(405, 'Método não permitido.');
      const uid = await autenticar(req);
      json(res, 200, {
        vinculado: await vinculado(uid),
        splitAtivo: d.splitAtivo ? d.splitAtivo() : process.env.MERCADOPAGO_SPLIT_ENABLED === 'true'
      });
    } else if (caminho === '/api/mercadopago/oauth/desvincular') {
      if (req.method !== 'POST') falhar(405, 'Método não permitido.');
      const uid = await autenticar(req);
      await desvincular(uid);
      json(res, 200, { vinculado: false });
    } else if (caminho === '/api/mercadopago/oauth/callback') {
      if (req.method !== 'GET') falhar(405, 'Método não permitido.');
      if (url.searchParams.get('error')) {
        pagina(res, 400, 'Vínculo não concluído', 'A autorização foi cancelada ou recusada. Volte ao aplicativo Hitchhike e tente novamente.');
        return true;
      }
      try {
        await concluir(url.searchParams.get('code'), url.searchParams.get('state'));
        pagina(res, 200, 'Mercado Pago vinculado', 'Conta vinculada com sucesso. Volte ao aplicativo Hitchhike.');
      } catch (erro) {
        if (!erro.status) {
          console.error(`Falha inesperada no vínculo Mercado Pago (${erro.name}).`);
          pagina(res, 500, 'Vínculo não concluído', 'Erro interno. Tente novamente.');
        } else {
          pagina(res, erro.status === 503 ? 503 : 400, 'Vínculo não concluído', 'Não foi possível concluir a autorização. Volte ao aplicativo e tente novamente.');
        }
      }
    } else {
      return false;
    }
    return true;
  }

  return { iniciar, concluir, vinculado, obterContaMotorista, desvincular, tratar };
}
