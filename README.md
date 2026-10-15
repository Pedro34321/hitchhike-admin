# Hitchhike Admin

Painel administrativo para o TCC Hitchhike, plataforma de caronas universitárias. Interface em **HTML, CSS e JavaScript**, servidor em **JavaScript (Node.js 24)** e banco **SQLite**. Sem dependências npm externas.

## Iniciar

1. Instale Node.js 24 ou mais recente.
2. Abra o terminal na pasta do projeto.
3. Execute `npm run setup`, informe seu e-mail e guarde a senha aleatória exibida **uma única vez**.
4. Opcional: execute `npm run seed` para inserir dados fictícios para a apresentação do TCC. O comando recusa bancos que já têm cadastros.
5. Execute `npm start` e abra **http://localhost:3000**.
6. Entre com a conta criada e altere sua senha em **Configurações**.

Não existe senha padrão no código. As senhas usam `scrypt` com salt aleatório. O banco é criado em `data/admin.sqlite`, ignorado pelo Git. `npm run setup` também permite criar outras contas administrativas com e-mails distintos.

## Funcionalidades

- Login de administrador validado no servidor, sessões de 8 horas e logout.
- Dashboard com totais reais do banco, atividade dos últimos sete dias e fila de pendências.
- Motoristas: consulta, aprovação, suspensão, reativação e cancelamento de inscrição.
- Usuários: consulta, bloqueio, desbloqueio e cancelamento.
- Justificativa obrigatória e histórico de cada decisão, com data e administrador.
- Denúncias contra motoristas ou passageiros, com vínculo opcional a viagens, cadastro pelo atendimento, análise, resolução e arquivamento.
- Viagens filtradas por data/status e exportação CSV compatível com Excel (UTF-8 com BOM, separador `;`, valores decimais brasileiros).
- Proteção contra fórmulas no CSV, consultas parametrizadas, escape de conteúdo no HTML e validação de status no servidor.
- Layout responsivo, estados vazios e feedback de erros.

## Arquivos para editar

| Arquivo | Finalidade |
| --- | --- |
| `public/index.html` | Estrutura do login, menu e modais |
| `public/styles.css` | Cores, layout, componentes e responsividade |
| `public/app.js` | Telas, filtros, formulários e chamadas da API |
| `server.js` | Login, autorização, regras administrativas e exportação |
| `db.js` | Esquema SQLite e auditoria |
| `scripts/seed.js` | Dados fictícios opcionais |
| `docs/API.md` | Contrato das rotas e plano de integração com o app |

## Escopo atual e integração

Esta é uma aplicação administrativa independente e funcional. O app móvel ainda não possui banco/API conectado. Os dados de demonstração são fictícios e identificados no painel. **Bloquear alguém aqui ainda não bloqueia uma conta no aplicativo móvel.** Quando o app for implementado, ele deverá compartilhar estes dados por meio de uma API de usuários, consultar os status e invalidar sessões/acessos ao receber decisões administrativas.

O painel recebe denúncias **registradas manualmente pelo administrador**, a partir de relatos recebidos pelo atendimento. O recebimento direto do app precisa de endpoint próprio autenticado para usuários; não compartilhe sessões de administrador com o app. Não há cadastro público, upload de CNH, validação de documentos oficiais, envio de e-mails, recuperação automática de senha, MFA nem processamento de pagamento nesta versão.

A aprovação representa a decisão do administrador após conferência externa dos documentos. O cancelamento é lógico e mantém o histórico; não equivale a excluir dados pessoais. Concluir uma denúncia não aplica punição automática. Os valores das viagens representam valores combinados, sem comprovação de pagamento.

## Testar

Execute `npm test`. Os testes usam um banco temporário e verificam acesso protegido, credenciais incorretas, cookie de sessão, origem de requisições, justificativa mínima, transições válidas, bloqueios, denúncias, auditoria, filtros CSV, neutralização de fórmulas, troca de senha e logout.

## Hospedar

**GitHub armazena o código; GitHub Pages não executa este servidor nem SQLite.** Use um servidor com Node.js 24 e disco persistente. Execute `npm run setup` no ambiente de hospedagem, configure `NODE_ENV=production` e coloque um proxy HTTPS na frente do processo local (porta 3000 por padrão). Em produção o cookie exige HTTPS. Mantenha a pasta `data/` em volume persistente e faça backups consistentes do SQLite, incluindo o estado WAL (preferencialmente pelo mecanismo de backup do SQLite).

As variáveis opcionais são `PORT`, `DB_PATH` e `NODE_ENV`. `.env.example` documenta os nomes, mas `.env` não é carregado automaticamente; use variáveis do provedor ou `node --env-file=.env server.js`. O servidor escuta em `127.0.0.1`, adequado para proxy reverso na mesma máquina. Não altere para exposição pública sem configurar HTTPS e os controles do ambiente.

Esta versão usa limitação de login em memória por IP (10 tentativas / 15 minutos). Atrás de proxy, o limite é compartilhado pelo IP do proxy; configure também limites no proxy para uso real. Reinícios zeram esse limite. Para implantação com vários processos, implemente limitação compartilhada e um banco adequado a esse cenário. O protótipo não é uma certificação de conformidade legal ou de segurança operacional.

## Referências do TCC

A documentação enviada descreve caronas universitárias e o papel de supervisão do administrador. O projeto implementa as funcionalidades pedidas na conversa. As orientações acadêmicas dos anexos são contexto documental; não foram tratadas como ordens para alterar o TCC ou contatar professores. Os documentos originais não são publicados neste repositório.
