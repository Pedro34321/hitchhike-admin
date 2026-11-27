# Hospedagem temporária do TCC no Railway

## Primeiro deploy

1. Conectar este repositório no Railway e selecionar a branch de publicação.
2. Adicionar **um volume persistente**, montado em `/data`, antes do primeiro início. Manter uma única réplica com SQLite.
3. Definir `NODE_ENV=production`, `HOST=0.0.0.0` e `DB_PATH=/data/admin.sqlite`. O Dockerfile já fornece esses padrões. A porta vem de `PORT`, fornecida pelo Railway.
4. Nos segredos do serviço, definir `ADMIN_INITIAL_EMAIL` e `ADMIN_INITIAL_PASSWORD` (senha exclusiva com 16 a 256 caracteres). Nunca colocar senha no Git, em capturas ou em logs. Se o banco já contém administradores, essas variáveis não redefinem a conta.
5. Gerar o domínio público HTTPS do serviço. O health check usa `/healthz` e não expõe dados.
6. Entrar na conta administrativa e trocar a senha. Remover as duas variáveis `ADMIN_INITIAL_*` após confirmar o acesso; a conta já está no volume.
7. Para consultar o Firebase, definir o conteúdo completo da conta de serviço em `FIREBASE_SERVICE_ACCOUNT_JSON` nos segredos do Railway. Como alternativa, fornecer arquivo secreto e definir `FIREBASE_SERVICE_ACCOUNT_PATH` com o caminho real. Sem a credencial, a parte local funciona e a integração indica indisponibilidade. Não comitar nem embutir a chave na imagem.
8. Para pagamentos, manter apenas ambiente de TESTE, conforme `PAGAMENTOS.md`. Atualizar `PUBLIC_BASE_URL` e as URLs de retorno no provedor quando o domínio estiver definido.

Não executar `npm run seed` em todo deploy. Não executar `npm run setup` no build: o volume só é usado em execução. Um banco local anterior não é copiado automaticamente; sua migração deve ser feita por backup consistente e restauração no volume, com o serviço parado.

## Atualizações até domingo

Depois de integrar as mudanças de hospedagem à branch principal, usar `main` como fonte de deploy. Ativar a opção de aguardar os testes do GitHub antes da implantação, se disponível na conta. Novos pushes nessa branch geram deploys. Não é preciso criar outro serviço ou domínio.

O código pode ser substituído; o volume `/data` deve ser mantido. Não remover o volume nem recriar o serviço para atualizar. Não mudar `DB_PATH`. Alterações no esquema do banco precisam de migração compatível e backup anterior.

## Teste de persistência

Entrar no painel, confirmar uma conta e um registro fictício identificado, publicar uma alteração sem mudar o esquema e verificar que a mesma conta e o registro continuam disponíveis. A preparação local não comprova a montagem do volume na conta Railway.

## Encerramento após o TCC

Exportar um backup consistente do SQLite (incluindo WAL pelo mecanismo de backup do SQLite), guardar somente o necessário e revogar a credencial de serviço exclusiva da hospedagem. Remover o serviço e o volume somente após conferir o backup e confirmar o encerramento. O fim dos créditos pode interromper o serviço antes do prazo; conferir o saldo e a data no painel Railway. Não habilitar upgrade pago automaticamente.

Referências: https://docs.railway.com/volumes/reference e https://docs.railway.com/config-as-code
