# API administrativa

Base local: `http://localhost:3000/api`. Todas as rotas, exceto login, exigem cookie `hh_session` de administrador. Não há CORS público. Escritas aceitam `application/json`; chamadas de outra origem são recusadas. As sessões ficam no servidor com token armazenado como SHA-256, não como token utilizável.

| Método | Rota | Uso |
| --- | --- | --- |
| POST | `/login` | `{ "email": "...", "password": "..." }` |
| POST | `/logout` | `{}`; revoga a sessão corrente |
| GET | `/data` | Conta autenticada, pessoas, viagens, denúncias e últimas 200 ações |
| POST | `/people/:id/status` | `{ "status": "suspenso", "reason": "Justificativa obrigatória" }` |
| POST | `/reports` | `{ "target_id": 2, "trip_id": 1, "reporter": "Nome", "category": "Conduta inadequada", "description": "Descrição com ao menos 10 caracteres" }`; `trip_id` opcional |
| POST | `/reports/:id` | `{ "status": "resolvida", "resolution": "Parecer da análise" }` |
| GET | `/trips.csv?from=2026-10-01&to=2026-10-31&status=concluida` | Exporta viagens do período inclusivo; filtros opcionais |
| POST | `/password` | `{ "current": "...", "password": "nova senha de no mínimo 12 caracteres" }`; revoga todas as sessões |

Erros: `{ "error": "Mensagem em português" }`, com HTTP 400, 401, 403, 404, 409, 413, 415 ou 429 conforme o caso. Falhas inesperadas retornam 500 sem detalhes internos.

## Regras

Motorista: `pendente → ativo/cancelado`; `ativo → suspenso/cancelado`; `suspenso → ativo/cancelado`. Usuário: `ativo → bloqueado/cancelado`; `bloqueado → ativo/cancelado`. Inscrições canceladas não são reativadas por esta API. Alterações exigem justificativa de 5 a 1.000 caracteres, e são gravadas na mesma transação da auditoria.

Denúncia: `aberta → em_analise/resolvida/arquivada`; `em_analise → resolvida/arquivada`. Parecer obrigatório de 5 a 2.000 caracteres. Denúncias encerradas não são reabertas nesta versão.

## Próxima integração com o app

1. Definir autenticação própria dos passageiros/motoristas e vinculação a `people.id`.
2. Criar endpoints de cadastro que sempre iniciem motoristas como `pendente`; somente administradores aprovam.
3. Registrar viagens reais e denúncias autenticadas, derivando o denunciante da sessão do usuário (não de um nome fornecido pelo cliente).
4. Consultar status ao autenticar, solicitar/oferecer caronas e confirmar viagens; rejeitar perfis bloqueados, suspensos ou cancelados.
5. Definir o tratamento de viagens futuras e sessões existentes após punições, inclusive comunicação aos envolvidos.
6. Implementar armazenamento protegido para documentos, política de retenção, notificações e recuperação de acesso conforme as decisões do projeto.

Não exponha o arquivo SQLite, as rotas administrativas ou credenciais de administrador diretamente ao aplicativo. Uma API de usuários deve aplicar autorização por titular e por participação na viagem.
