# Pagamentos de teste (Mercado Pago Checkout Pro)

Infraestrutura backend para a banca do TCC abrir o Checkout Pro **de teste**. Nenhum dinheiro real é movimentado e não há repasse ao motorista: a taxa e o valor do motorista são apenas informativos. Código em `pagamentos.js`; testes em `tests/pagamentos.test.js`.

## Regras

- O app envia **somente** `caronaId` e o Firebase ID Token. Valores, `passageiroUid` e status enviados pelo app são ignorados.
- O servidor exige e-mail verificado, `usuarios/{uid}.status == ATIVO` e `solicitacoes_caronas/{caronaId}_{uid}` com status `ACEITA`.
- Valor-base vem de `caronas/{caronaId}.valor` (mínimo R$ 2,50; máximo R$ 1.000,00 no ambiente de teste). Taxa de 25% e total são calculados em centavos inteiros, com arredondamento meio para cima.
- Todo resultado vem da API do Mercado Pago (`GET /v1/payments/{id}` ou busca por `external_reference`). Parâmetros da URL de retorno nunca aprovam nada.
- A aprovação só é gravada se `external_reference` existir em `pagamentos/`, a moeda for `BRL`, o valor for igual ao total esperado e `live_mode` não for `true`. Qualquer divergência vira `DIVERGENTE`.
- `APROVADO` é final: tentativas antigas, recusadas ou repetidas não sobrescrevem. Eventos mais antigos que o último gravado são ignorados.
- Nesta versão de teste, estornos e chargebacks posteriores à aprovação não alteram o registro.
- O Android nunca grava em `pagamentos/`. As regras do Firestore devem permitir somente leitura aos participantes e `write: false` (o Admin SDK ignora as regras). **Publique essas regras manualmente.**

## Endpoints

| Método | Rota | Autenticação |
| --- | --- | --- |
| POST | `/api/pagamentos/preferencia` | `Authorization: Bearer <Firebase ID Token>`; corpo `{ "caronaId": "..." }`. Retorna `pagamentoId`, `checkoutUrl`, `valorBase`, `taxa`, `total`, `status` |
| GET | `/api/pagamentos/:pagamentoId/status` | Mesmo token (passageiro ou motorista do pagamento). O passageiro dispara a reconciliação com o Mercado Pago quando ainda não está `APROVADO` |
| POST | `/api/pagamentos/webhook` | Assinatura `x-signature` (HMAC-SHA256 do manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`) com `MERCADOPAGO_WEBHOOK_SECRET`. Sem cookie administrativo |
| GET | `/api/pagamentos/retorno` | Página informativa das `back_urls`; não lê nem altera nada |

Estas rotas são tratadas **antes** da sessão administrativa em `server.js`, somente para o prefixo `/api/pagamentos/`. Todas as demais rotas continuam exigindo sessão de administrador e a verificação de origem existente. Nenhum cabeçalho CORS é enviado: o app Android não precisa de CORS.

## Registro `pagamentos/{pagamentoId}`

`id`, `caronaId`, `solicitacaoId`, `passageiroUid`, `motoristaUid`, `valorBase`/`taxa`/`total` (R$) e `valorBaseCentavos`/`taxaCentavos`/`totalCentavos`, `taxaPercentual`, `moeda`, `ambiente` (`TESTE`), `status` (`PENDENTE`, `EM_PROCESSAMENTO`, `APROVADO`, `RECUSADO`, `CANCELADO`, `DIVERGENTE`), `mpPreferenceId`, `mpPaymentId`, `mpStatus`, `mpStatusDetail`, `mpUltimaAtualizacao`, `criadoEm`, `atualizadoEm`, `aprovadoEm`.

## Configuração

Defina as variáveis no `.env` local (ignorado pelo Git) ou no painel do serviço de hospedagem. Nunca coloque valores no repositório ou em `.env.example`.

| Variável | Uso |
| --- | --- |
| `MERCADOPAGO_ACCESS_TOKEN` | Access Token de **teste** da conta vendedora de teste (Suas integrações > Credenciais de teste) |
| `MERCADOPAGO_WEBHOOK_SECRET` | Assinatura secreta do webhook (Suas integrações > Webhooks) |
| `PUBLIC_BASE_URL` | URL pública HTTPS do backend, sem barra final, por exemplo a URL do Render |
| `MERCADOPAGO_CHECKOUT_URL` | Opcional: `init_point` (padrão) ou `sandbox_init_point` |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Já usada pelo painel; o módulo reutiliza o mesmo Firebase Admin |

Sem `MERCADOPAGO_ACCESS_TOKEN` as rotas respondem 503. Sem `MERCADOPAGO_WEBHOOK_SECRET` o webhook responde 503 e nada é processado.

### URL de checkout

A resposta de `POST /checkout/preferences` traz `init_point` e `sandbox_init_point`. Com credenciais de teste, abra primeiro o `init_point` (padrão) e entre com a **conta compradora de teste**. Se a página de checkout não carregar em ambiente de teste, defina `MERCADOPAGO_CHECKOUT_URL=sandbox_init_point` e repita. Confirme na documentação vigente do Mercado Pago, pois esse comportamento mudou ao longo do tempo. Use cartões de teste oficiais e o usuário comprador de teste.

### Webhook em ambiente local

O Mercado Pago só entrega notificações a uma URL pública HTTPS. Com o servidor apenas local, o webhook **não chegará**: `PUBLIC_BASE_URL` não deve ser definida (a preferência é criada sem `notification_url`) e o resultado é confirmado por `GET /api/pagamentos/:id/status`, que consulta o Mercado Pago. Para testar o webhook, hospede o servidor (por exemplo no Render) e configure no painel do Mercado Pago a URL `https://SEU-SERVICO/api/pagamentos/webhook` com o evento *Pagamentos*. O servidor continua escutando em `127.0.0.1`; atrás de proxy, siga a observação de hospedagem do README.

Não há validação de data (`ts`) no webhook, para não rejeitar reenvios legítimos. A proteção contra replay vem da consulta obrigatória à API e da idempotência das atualizações.
