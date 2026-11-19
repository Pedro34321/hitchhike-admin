# CNH: OCR gratuito e conferência administrativa

## Política atual: somente PDF completo com QR Code

Aceitamos somente PDF original da CNH com frente, verso e QR Code legível, em uma página e até 5 MB. Fotos, prints, PNG e JPG são recusados no formulário e na API (HTTP 415). Uma imagem renomeada para .pdf ou declarada como application/pdf é recusada pela verificação de conteúdo, e o parser precisa conseguir abrir o PDF. PDF sem QR detectável/legível é recusado (HTTP 422).

A detecção genérica de QR é feita localmente e retorna apenas `qrDetectado: true`; o payload não é armazenado nem devolvido. Encontrar um QR não demonstra que ele seja um QR Vio legítimo, que corresponda à CNH, nem que frente/verso estejam completos. O administrador deve conferir a documentação completa e comparar os dados no aplicativo oficial Vio. PDFs com impressão degradada ou QR incompatível com o leitor local podem ser rejeitados e devem ser reenviados a partir do original. O formulário é administrativo; o envio pelo Flutter ainda exige integração correspondente.

Esta política substitui a aceitação de imagens descrita nas seções históricas abaixo.

## Atualização: PDF original e leitura por regiões

Agora aceita PDF de uma página, PNG ou JPEG, até 5 MB. Instale as dependências atualizadas com `npm install` (PDF.js e @napi-rs/canvas, além do Tesseract). O PDF é renderizado em memória. No layout de exportação com imagens separadas da frente e verso, o sistema localiza a frente pela geometria e confirma o layout pelos rótulos: nome, 4b (validade) e 9 (categoria). Cada valor é lido separadamente do rótulo, com ampliação e binarização. A data de emissão fica fora do recorte de validade.

PDF sem esse layout passa pela leitura conservadora da página e pode exigir preenchimento manual. Não há garantia de compatibilidade com todos os modelos, versões, rotações ou PDFs digitalizados. PDF protegido por senha, inválido ou com mais de uma página gera uma mensagem de revisão, sem aprovação. O limite de processamento continua sendo 60 segundos e uma leitura por vez.

A confiança mínima de 70 é uma regra de triagem, não um limiar estatístico de segurança validado. Na leitura da página/imagem, baixa confiança deixa todas as sugestões vazias. Na leitura por regiões, o limiar é aplicado a cada campo e os rótulos esperados precisam ser reconhecidos. A conferência humana continua obrigatória mesmo com resultado completo. Renderizar um PDF não verifica sua assinatura digital, sua autenticidade nem a situação atual no Detran.

Os PDFs de teste em `tests/fixtures/` são inteiramente fictícios. Nenhum documento real foi incluído no repositório.

Implementação baseada no commit `89454f3` (17/11/2026), preservando a integração Firebase e pagamentos. Não há consulta ao Detran nem API paga. O Tesseract.js executa OCR em português **no próprio servidor**, com o modelo instalado pelo npm; a imagem não é enviada a um fornecedor de OCR, persistida ou incluída em logs. Processamento e hospedagem consomem recursos.

## Instalação e uso

1. Atualize o código e execute `npm install` (Node.js 24+). Foram adicionados `tesseract.js` e `@tesseract.js-data/por`. O modelo português é instalado localmente; após a instalação, a leitura não depende de CDN.
2. Configure `FIREBASE_SERVICE_ACCOUNT_PATH` como já utilizado no painel. Nunca publique essa credencial.
3. **Antes de ativar em ambiente real, proteja as coleções `cnh_admin` e `cnh_eventos` nas regras do Firestore**: clientes do app não podem ler/gravar essas coleções. Somente o backend Firebase Admin, com IAM restrito, deve acessá-las. As permissões de `usuarios` também devem impedir o próprio usuário de alterar `condutorValidado`, `papelAtivo`, `cnhValidade` e `cnhRevisaoNecessaria`. Um `allow` amplo sobreposto invalida um `deny`; revise as regras completas do projeto. Este repositório não contém as regras atuais do app, portanto elas não foram alteradas/deployadas.
4. Execute `npm start`, entre e abra **Motoristas → Conferir CNH / OCR** na solicitação real. Para testar OCR sem dados pessoais, use `tests/fixtures/ocr-sintetico.png`.
5. Selecione PNG/JPEG de até 5 MB, clique em **Ler imagem com OCR gratuito**, confira e corrija nome, categoria e validade. Fotos legíveis podem ainda ter erros de leitura. Campos ausentes ou ambíguos ficam vazios. Todo resultado exige revisão humana; a confiança do texto não é uma probabilidade de autenticidade.
6. Compare o documento com o cadastro e confira o QR pelo aplicativo oficial Vio no celular. Marque as duas confirmações **após realizar as verificações** e registre o parecer. Não há integração automática com o Vio. O servidor guarda a declaração do administrador, não prova tecnicamente que a leitura do QR ocorreu.
7. Salve. Depois use **Aprovar** na solicitação ou **Aprovar após conferência**. Sem as duas confirmações, validade vigente e categoria compatível (B, AB, C, AC, D, AD, E ou AE), o servidor recusa aprovação. Essa categoria é uma regra do Hitchhike para caronas em automóvel, não uma certificação de aptidão legal.

## Revisão e renovação

- OCR inconclusivo nunca aprova. É possível preencher os campos manualmente e salvar as pendências sem marcar as conferências: a situação fica como revisão necessária. Se a validade nem puder ser identificada, mantenha a solicitação pendente e registre nova conferência quando o documento legível for recebido.
- Salvar uma nova conferência retira `condutorValidado` e passa `papelAtivo` de MOTORISTA para PASSAGEIRO. Isso impede que a atualização de uma CNH mantenha uma aprovação antiga. Só uma nova decisão explícita restaura o acesso, com usuário ATIVO e conferência apta. Aprovações antigas sem registro de CNH não são revogadas em massa: devem passar por conferência administrativa.
- Datas seguem America/Sao_Paulo. A validade é considerada vigente até o fim do dia informado. Esta é uma política conservadora da plataforma, sem aplicação de tolerâncias legais.
- Na inicialização e a cada hora com o servidor ligado, o processo percorre **todas** as conferências em páginas de 100, relê cada registro em transação e retira acesso vencido. Renovação concorrente não é sobrescrita. Falhas são registradas sem dados pessoais e tentadas novamente no próximo ciclo; não há garantia de execução enquanto o servidor está desligado.
- Alertas de vencimento em até 30 dias e revisão aparecem ao abrir/recarregar a tela Motoristas. Não há envio de e-mail/push. A tela mostra as primeiras 100 conferências; o processo de vencimento percorre todas.
- O app Flutter e suas regras/backend precisam conferir `condutorValidado`, `status`, `cnhValidade` e a data atual **em cada operação de oferecer/confirmar carona**. Trocar o campo no Firebase só bloqueia efetivamente funcionalidades que respeitem esse campo. O código Flutter e as regras não estão neste repositório; a checagem por operação ainda precisa ser integrada lá. Viagens existentes não são canceladas por este processo.

## Dados e rotas

`cnh_admin/{uid}` guarda nome conferido, categoria, validade, confirmações, parecer, administrador e instante da conferência. Não guarda número da CNH, CPF, imagem nem texto bruto do OCR. `cnh_eventos` registra conferências e bloqueios automáticos dentro da mesma transação do Firestore. A aprovação continua com a auditoria SQLite existente.

Todas as rotas usam a sessão administrativa e o controle de origem já existentes:

- `POST /api/cnh/ocr`: `{ "imagem": "data:image/png;base64,..." }`; sugestões editáveis, sempre `revisaoNecessaria: true`. Uma leitura por vez; limite de 60 segundos; erro 422 orienta revisão manual.
- `GET /api/cnh`: primeiras 100 conferências e situação calculada. A indisponibilidade nunca é exibida como ausência confirmada de pendências.
- `POST /api/cnh/{uid}`: `{ "nome": "...", "categoria": "B", "validade": "2030-11-18", "documentoConferido": true, "qrConferidoVio": true, "observacao": "..." }`. Salva em transação e não concede acesso.
- A rota existente `POST /api/solicitacoes-motoristas/{uid}/decisao` agora exige conferência apta para aprovar. Recusas continuam disponíveis. A renovação de solicitação APROVADA com acesso retirado pode ser aprovada novamente após conferência.

## Limites e fontes

Não há upload no Flutter nesta entrega: o administrador seleciona uma imagem recebida pelo atendimento. Não foram acessados dados reais nem aplicadas alterações no Firebase durante o desenvolvimento. Imagens são transitórias na memória do navegador e servidor; o administrador deve fechar o formulário após a análise. Os registros de conferência precisam de política de retenção definida pela equipe.

OCR extrai texto; QR conferido não consulta suspensão ou cassação atual. Fontes: [Tesseract.js](https://github.com/naptha/tesseract.js), [aplicativo e contratação Vio](https://centraldeajuda.serpro.gov.br/vio/comocontratar/), [leitura do QR](https://portalservicos.denatran.serpro.gov.br/static/carteiradigital/tutoriais/html/demo_25.html).

Execute `npm test` para testar OCR real com imagem sintética, validação de datas, permissões HTTP, bloqueio de aprovação, renovação e vencimentos paginados, além da suíte existente.
