import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
const temp=mkdtempSync(join(tmpdir(),'hitchhike-test-'));process.env.DB_PATH=join(temp,'test.sqlite');delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const {db}=await import('../db.js');const {server,csvCell}=await import('../server.js');const {definirProvedorParaTeste,definirAuditoriaParaTeste}=await import('../firebaseMotoristas.js');
function pedido(uid,status='PENDENTE',extra={}){return {motoristaUid:uid,placa:'ABC1D23',modelo:'Fit',cor:'Prata',status,cnhNumero:'cnh-secreta',criadoEm:{toDate:()=>new Date('2026-03-01T15:04:00.000Z')},...extra};}
function perfil(status='ATIVO',extra={}){return {nome:'Marina',email:'marina@senacsp.edu.br',curso:'ADS',instituicao:'Senac',status,papelAtivo:'PASSAGEIRO',condutorValidado:false,cnhNumero:'cnh-secreta',...extra};}
function criarFirestore(inicial){const docs=new Map(inicial);let chain=Promise.resolve();const api={falhar:false,docs,collection(nome){const consulta={doc(id){return {path:`${nome}/${id}`,id};},orderBy(){return consulta;},limit(n){consulta._limit=n;return consulta;},async get(){const lista=[];for(const [chave,dado] of docs){if(!chave.startsWith(`${nome}/`))continue;lista.push({id:chave.slice(nome.length+1),data:()=>({...dado})});}lista.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);return {docs:lista.slice(0,consulta._limit??lista.length)};}};return consulta;},async getAll(...refs){return refs.map(ref=>{const dado=docs.get(ref.path);return {id:ref.id,exists:dado!==undefined,data:()=>dado?{...dado}:undefined};});},runTransaction(fn){const executar=async()=>{if(api.falhar)throw Error('falha simulada');const staged=new Map();const tx={async get(ref){const dado=staged.has(ref.path)?staged.get(ref.path):docs.get(ref.path);return {exists:dado!==undefined,id:ref.id,data:()=>dado===undefined?undefined:{...dado}};},update(ref,campos){const base=staged.has(ref.path)?staged.get(ref.path):docs.get(ref.path);if(!base)throw Error('update em documento inexistente');staged.set(ref.path,{...base,...campos});}};const resultado=await fn(tx);for(const [chave,valor] of staged)docs.set(chave,valor);return resultado;};const atual=chain.then(executar,executar);chain=atual.then(()=>{},()=>{});return atual;}};return api;}
async function postar(sessao,uid,decisao,headers={}){return fetch(`${base}/api/solicitacoes-motoristas/${uid}/decisao`,{method:'POST',headers:{'Content-Type':'application/json',...(sessao?{cookie:sessao}:{}),...headers},body:JSON.stringify({decisao})});}
let base,cookie;
async function call(path,body,auth=true,headers={}){return fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth&&cookie?{cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});}
before(async()=>{db.prepare('INSERT INTO admins VALUES(1,?,?,?)').run('test@example.com','test-salt',scryptSync('TestingPassword123','test-salt',64).toString('hex'));db.prepare('INSERT INTO admins VALUES(2,?,?,?)').run('reader@example.com','reader-salt',scryptSync('ReaderPassword123','reader-salt',64).toString('hex'));db.prepare('INSERT INTO people VALUES(1,?,?,?,?,?,?,?,?,?)').run('Motorista Teste','driver@example.com','motorista','pendente','Carro','TEST','Curso','',new Date().toISOString());db.prepare('INSERT INTO people VALUES(2,?,?,?,?,?,?,?,?,?)').run('Passageiro Teste','passenger@example.com','usuario','ativo','','','Curso','',new Date().toISOString());db.prepare('INSERT INTO trips VALUES(1,1,?,?,?,?,?,?)').run('=HYPERLINK("example")','Senac','2026-10-15T07:30','concluida',2,10);await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{await new Promise(r=>server.close(r));db.close();rmSync(temp,{recursive:true,force:true});});
test('fluxo administrativo com autenticação, moderação, auditoria e CSV',async()=>{
assert.equal((await call('data',null,false)).status,401);
assert.equal((await call('trips.csv',null,false)).status,401);
assert.equal((await call('login',{email:'test@example.com',password:'wrong'},false)).status,401);
let r=await call('login',{email:'test@example.com',password:'TestingPassword123'},false);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);cookie=r.headers.get('set-cookie').split(';')[0];
assert.equal((await call('people/1/status',{status:'ativo',reason:'ok'})).status,400);
assert.equal((await call('people/1/status',{status:'ativo',reason:'Documentos conferidos'},{},{Origin:'https://evil.example'})).status,403);
assert.equal((await call('people/1/status',{status:'ativo',reason:'Documentos conferidos'})).status,200);
assert.equal((await call('people/1/status',{status:'bloqueado',reason:'Transição incorreta'})).status,409);
assert.equal((await call('people/1/status',{status:'suspenso',reason:'Análise da ocorrência'})).status,200);
assert.equal((await call('people/2/status',{status:'bloqueado',reason:'Violação de regra informada'})).status,200);
r=await call('data');let data=await r.json();assert.equal(data.people.find(x=>x.id===1).status,'suspenso');assert.equal(data.people.find(x=>x.id===2).status,'bloqueado');assert.equal(data.audit.length,3);
assert.equal((await call('reports',{target_id:2,trip_id:99,reporter:'Teste',category:'Conduta',description:'Relato para avaliação.'})).status,400);
assert.equal((await call('reports',{target_id:2,trip_id:1,reporter:'Teste',category:'Conduta',description:'Relato para avaliação.'})).status,201);
assert.equal((await call('reports/1',{status:'em_analise',resolution:'Recebida para apuração'})).status,200);
assert.equal((await call('reports/1',{status:'resolvida',resolution:'Análise concluída e ação registrada'})).status,200);
assert.equal((await call('reports/1',{status:'arquivada',resolution:'Tentativa indevida'})).status,409);
r=await call('trips.csv?from=2026-10-15&to=2026-10-15');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/csv/);const csv=await r.text();assert.match(csv,/'=HYPERLINK/);assert.match(csv,/10,00/);
r=await call('trips.csv?from=2026-11-01');assert.equal((await r.text()).split('\r\n').length,1);
assert.equal((await call('trips.csv?from=2026-11-01&to=2026-01-01')).status,400);
assert.equal((await call('people/1/status',{status:'cancelado',reason:'Encerramento solicitado'})).status,200);
assert.equal((await call('people/1/status',{status:'ativo',reason:'Não deve reativar'})).status,409);
assert.equal((await call('password',{current:'wrong',password:'NewPassword123456'})).status,403);
assert.equal((await call('password',{current:'TestingPassword123',password:'NewPassword123456'})).status,200);
assert.equal((await call('data')).status,401);
r=await call('login',{email:'test@example.com',password:'NewPassword123456'},false);assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];assert.equal((await call('logout',{})).status,200);assert.equal((await call('data')).status,401);
});
test('CSV neutraliza fórmulas e escapa aspas',()=>{assert.equal(csvCell('=2+2'),'"\'=2+2"');assert.equal(csvCell(' +SUM(A1)'),'"\' +SUM(A1)"');assert.equal(csvCell('a"b'),'"a""b"');});
test('rotas CNH exigem sessão, origem permitida e campos válidos',async()=>{
 assert.equal((await call('cnh',null,false)).status,401);
 assert.equal((await call('cnh/ocr',{imagem:'invalida'},false)).status,401);
 assert.equal((await call('cnh/uid',{nome:'Pessoa'},false)).status,401);
 const r=await call('login',{email:'reader@example.com',password:'ReaderPassword123'},false);
 const sessao=r.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('cnh/ocr',{imagem:'invalida'},false,{cookie:sessao,Origin:'https://evil.example'})).status,403);
 assert.equal((await call('cnh/ocr',{imagem:'invalida'},false,{cookie:sessao})).status,415);
 assert.equal((await call('cnh/uid',{nome:'Pessoa'},false,{cookie:sessao})).status,400);
});
test('arquivos e cabeçalhos de segurança',async()=>{const r=await fetch(base);assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal((await fetch(base+'/db.js')).status,404);assert.equal((await fetch(base+'/visaoResumo.js')).status,200);assert.match((await fetch(base+'/visaoResumo.js')).headers.get('content-type'),/javascript/);});
test('leitura das solicitações reais exige administrador e oculta dados sensíveis',async()=>{
const login=await call('login',{email:'reader@example.com',password:'ReaderPassword123'},false);
assert.equal(login.status,200);
const sessao=login.headers.get('set-cookie').split(';')[0];
const semSessao=await call('solicitacoes-motoristas',null,false);
assert.equal(semSessao.status,401);
const local=await fetch(base+'/api/solicitacoes-motoristas',{headers:{cookie:sessao}});
assert.equal(local.status,200);
const indisponivel=await local.json();
assert.equal(indisponivel.disponivel,false);
assert.deepEqual(indisponivel.solicitacoes,[]);
assert.doesNotMatch(JSON.stringify(indisponivel),/private_key|cnhNumero|senhaHash|BEGIN PRIVATE/i);
assert.equal((await fetch(base+'/api/usuarios')).status,401);
const usuariosOff=await fetch(base+'/api/usuarios',{headers:{cookie:sessao}});
assert.equal(usuariosOff.status,200);
const off=await usuariosOff.json();
assert.equal(off.disponivel,false);
assert.equal(off.limitado,false);
assert.deepEqual(off.usuarios,[]);
assert.equal((await fetch(base+'/api/caronas')).status,401);
const caronasOff=await fetch(base+'/api/caronas',{headers:{cookie:sessao}});
assert.equal(caronasOff.status,200);
const offCaronas=await caronasOff.json();
assert.equal(offCaronas.disponivel,false);
assert.equal(offCaronas.limitado,false);
assert.deepEqual(offCaronas.caronas,[]);
definirProvedorParaTeste(async()=>criarFirestore([
 ['solicitacoes_motoristas/uidSeguro1',pedido('uidSeguro1','PENDENTE',{placa:'ABC1D23',modelo:'Honda Fit',cor:'Prata',cnhNumero:'cnh-12345678900',senhaHash:'hash-da-senha-local',private_key:'-----BEGIN PRIVATE KEY-----'})],
 ['usuarios/uidSeguro1',perfil('ATIVO',{nome:'Marina Oliveira',cnhNumero:'cnh-12345678900',senhaHash:'hash-da-senha-local',private_key:'-----BEGIN PRIVATE KEY-----'})]
]));
try{
 const remota=await fetch(base+'/api/solicitacoes-motoristas',{headers:{cookie:sessao}});
 assert.equal(remota.status,200);
 const corpo=await remota.json();
 assert.equal(corpo.disponivel,true);
 assert.equal(corpo.solicitacoes.length,1);
 assert.deepEqual(Object.keys(corpo.solicitacoes[0]).sort(),['cor','criadoEm','curso','email','instituicao','modelo','nome','placa','status','uid']);
 assert.equal(corpo.solicitacoes[0].uid,'uidSeguro1');
 assert.equal(corpo.solicitacoes[0].nome,'Marina Oliveira');
 assert.equal(corpo.solicitacoes[0].criadoEm,'2026-03-01T15:04:00.000Z');
 assert.equal(Object.hasOwn(corpo.solicitacoes[0],'cnhNumero'),false);
 assert.doesNotMatch(JSON.stringify(corpo),/cnh-12345678900|hash-da-senha-local|BEGIN PRIVATE KEY/);
}finally{definirProvedorParaTeste(null);}
const conferencia={nome:'Marina',categoria:'B',validade:'2099-12-31',documentoConferido:true,qrConferidoVio:true};
const loja=criarFirestore([
 ...['uidAprovar','uidParalelo','uidAuditoria'].map(uid=>['cnh_admin/'+uid,conferencia]),
 ['solicitacoes_motoristas/uidAprovar',pedido('uidAprovar')],['usuarios/uidAprovar',perfil()],
 ['solicitacoes_motoristas/uidRecusar',pedido('uidRecusar')],['usuarios/uidRecusar',perfil()],
 ['solicitacoes_motoristas/uidAntigo',pedido('uidAntigo','aprovado')],['usuarios/uidAntigo',perfil()],
 ['solicitacoes_motoristas/uidInativo',pedido('uidInativo')],['usuarios/uidInativo',perfil('INATIVO')],
 ['solicitacoes_motoristas/uidJaAprovado',pedido('uidJaAprovado')],['usuarios/uidJaAprovado',perfil('ATIVO',{condutorValidado:true,papelAtivo:'MOTORISTA'})],
 ['solicitacoes_motoristas/uidDivergente',pedido('uidDivergente','PENDENTE',{motoristaUid:'outroUsuario'})],['usuarios/uidDivergente',perfil()],
 ['solicitacoes_motoristas/uidFalha',pedido('uidFalha')],['usuarios/uidFalha',perfil()],
 ['solicitacoes_motoristas/uidAuditoria',pedido('uidAuditoria')],['usuarios/uidAuditoria',perfil()],
 ['solicitacoes_motoristas/uidParalelo',pedido('uidParalelo')],['usuarios/uidParalelo',perfil()]
]);
definirProvedorParaTeste(async()=>loja);
try{
 assert.equal((await postar(null,'uidAprovar','aprovar')).status,401);
 const csrf=await postar(sessao,'uidAprovar','aprovar',{Origin:'https://evil.example'});
 assert.equal(csrf.status,403);
 assert.equal(loja.docs.get('solicitacoes_motoristas/uidAprovar').status,'PENDENTE');
 assert.equal((await postar(sessao,'uidAprovar','talvez')).status,400);
 assert.equal((await postar(sessao,'uidInexistente','aprovar')).status,404);
 const divergente=await postar(sessao,'uidDivergente','aprovar');
 assert.equal(divergente.status,409);
 assert.equal(loja.docs.get('solicitacoes_motoristas/uidDivergente').status,'PENDENTE');
 const antigo=await postar(sessao,'uidAntigo','aprovar');
 assert.equal(antigo.status,409);
 assert.equal(loja.docs.get('solicitacoes_motoristas/uidAntigo').status,'aprovado');
 assert.equal(loja.docs.get('usuarios/uidAntigo').condutorValidado,false);
 const inativo=await postar(sessao,'uidInativo','aprovar');
 assert.equal(inativo.status,409);
 assert.equal(loja.docs.get('solicitacoes_motoristas/uidInativo').status,'PENDENTE');
 const anterior=await postar(sessao,'uidJaAprovado','recusar');
 assert.equal(anterior.status,409);
 assert.equal(loja.docs.get('usuarios/uidJaAprovado').condutorValidado,true);
 assert.equal(loja.docs.get('solicitacoes_motoristas/uidJaAprovado').status,'PENDENTE');
 const recusa=await postar(sessao,'uidRecusar','recusar');
 assert.equal(recusa.status,200);
 assert.equal((await recusa.json()).status,'RECUSADA');
 assert.equal(loja.docs.get('solicitacoes_motoristas/uidRecusar').status,'RECUSADA');
 assert.equal(loja.docs.get('usuarios/uidRecusar').condutorValidado,false);
 assert.equal(loja.docs.get('usuarios/uidRecusar').papelAtivo,'PASSAGEIRO');
 const auditoriaRecusa=db.prepare('SELECT actor,action,target,reason FROM audit WHERE target=?').get('uidRecusar');
 assert.equal(auditoriaRecusa.actor,'reader@example.com');
 assert.equal(auditoriaRecusa.action,'motorista recusado');
 assert.doesNotMatch(JSON.stringify(auditoriaRecusa),/cnh|ABC1D23|senha|PRIVATE/i);
 const aprovacao=await postar(sessao,'uidAprovar','aprovar');
 assert.equal(aprovacao.status,200);
 const aprovado=loja.docs.get('usuarios/uidAprovar');
 assert.equal(aprovado.condutorValidado,true);
 assert.equal(typeof aprovado.condutorValidado,'boolean');
 assert.equal(aprovado.papelAtivo,'MOTORISTA');
 assert.equal(aprovado.status,'ATIVO');
 assert.equal(aprovado.cnhNumero,'cnh-secreta');
 assert.equal(loja.docs.get('solicitacoes_motoristas/uidAprovar').status,'APROVADA');
 assert.equal((await postar(sessao,'uidAprovar','aprovar')).status,409);
 assert.equal(db.prepare('SELECT count(*) n FROM audit WHERE target=?').get('uidAprovar').n,1);
 const simultaneas=await Promise.all([postar(sessao,'uidParalelo','aprovar'),postar(sessao,'uidParalelo','aprovar')]);
 assert.deepEqual(simultaneas.map(r=>r.status).sort(),[200,409]);
 assert.equal(loja.docs.get('solicitacoes_motoristas/uidParalelo').status,'APROVADA');
 assert.equal(db.prepare('SELECT count(*) n FROM audit WHERE target=?').get('uidParalelo').n,1);
 loja.falhar=true;
 const falha=await postar(sessao,'uidFalha','aprovar');
 assert.equal(falha.status,503);
 assert.equal((await falha.json()).decisaoAplicada,false);
 assert.equal(loja.docs.get('solicitacoes_motoristas/uidFalha').status,'PENDENTE');
 loja.falhar=false;
 definirAuditoriaParaTeste(()=>{throw Error('disco cheio');});
 const semHistorico=await postar(sessao,'uidAuditoria','aprovar');
 assert.equal(semHistorico.status,500);
 const aviso=await semHistorico.json();
 assert.equal(aviso.decisaoAplicada,true);
 assert.equal(aviso.auditoria,false);
 assert.match(aviso.error,/Firestore/);
 assert.match(aviso.error,/histórico/);
 assert.equal(loja.docs.get('solicitacoes_motoristas/uidAuditoria').status,'APROVADA');
 assert.equal(loja.docs.get('usuarios/uidAuditoria').condutorValidado,true);
 assert.equal(db.prepare('SELECT count(*) n FROM audit WHERE target=?').get('uidAuditoria').n,0);
 assert.equal((await postar(sessao,'uidAuditoria','aprovar')).status,409);
 const entradas=[];
 for(let i=1;i<=101;i++){
  const id='user'+String(i).padStart(3,'0');
  const extra={nome:i===1?'<script>alert(1)</script>':`Pessoa ${i}`,email:`pessoa${i}@senacsp.edu.br`,cnhNumero:'cnh-secreta',senhaHash:'hash-secreto',private_key:'-----BEGIN PRIVATE KEY-----'};
  if(i===2)extra.condutorValidado=true;
  if(i===50)extra.condutorValidado='true';
  entradas.push([`usuarios/${id}`,perfil('ATIVO',extra)]);
 }
 const lojaUsuarios=criarFirestore(entradas);
 definirProvedorParaTeste(async()=>lojaUsuarios);
 const leituraUsuarios=await fetch(base+'/api/usuarios',{headers:{cookie:sessao}});
 assert.equal(leituraUsuarios.status,200);
 const reais=await leituraUsuarios.json();
 assert.equal(reais.disponivel,true);
 assert.equal(reais.limitado,true);
 assert.equal(reais.usuarios.length,100);
 assert.equal(reais.usuarios.some(u=>u.uid==='user101'),false);
 const script=reais.usuarios.find(u=>u.uid==='user001');
 assert.equal(script.nome,'<script>alert(1)</script>');
 assert.equal(script.papelAtivo,'PASSAGEIRO');
 assert.equal(script.status,'ATIVO');
 assert.equal(typeof script.condutorValidado,'boolean');
 assert.equal(reais.usuarios.find(u=>u.uid==='user002').condutorValidado,true);
 assert.equal(reais.usuarios.find(u=>u.uid==='user050').condutorValidado,false);
 for(const usuario of reais.usuarios)assert.deepEqual(Object.keys(usuario).sort(),['condutorValidado','curso','email','instituicao','nome','papelAtivo','status','uid']);
 assert.doesNotMatch(JSON.stringify(reais),/cnh-secreta|hash-secreto|BEGIN PRIVATE KEY/);
 assert.equal(lojaUsuarios.docs.get('usuarios/user002').cnhNumero,'cnh-secreta');
 assert.equal(lojaUsuarios.docs.get('usuarios/user002').condutorValidado,true);
 definirProvedorParaTeste(async()=>criarFirestore([['usuarios/id invalido',perfil('ATIVO',{nome:'Invisivel',cnhNumero:'cnh-secreta'})],['usuarios/valido',perfil('ATIVO',{nome:'Visivel'})]]));
 const filtrados=await (await fetch(base+'/api/usuarios',{headers:{cookie:sessao}})).json();
 assert.equal(filtrados.limitado,false);
 assert.equal(filtrados.usuarios.length,1);
 assert.equal(filtrados.usuarios[0].uid,'valido');
 assert.equal(filtrados.usuarios[0].nome,'Visivel');
 const instante=iso=>({toDate:()=>new Date(iso)});
 const carona=(uid,extra={})=>({motoristaUid:uid,origem:'<script>alert(1)</script>',destino:'DestinoRealUnico',dataHoraSaida:instante('2099-06-01T12:00:00.000Z'),vagasTotais:3,vagasDisponiveis:2,valor:12.5,status:'ABERTA',email:'segredo@exemplo.com',cnhNumero:'cnh-secreta',ultimaSolicitacaoAceitaId:'solicitacao-secreta',passageiros:['uidPassageiro'],...extra});
 const lojaCaronas=criarFirestore([
  ['usuarios/uidIsabella',perfil('ATIVO',{nome:'Isabella',email:'isabella@senacsp.edu.br',cnhNumero:'cnh-secreta'})],
  ['caronas/caronaAberta',carona('uidIsabella')],
  ['caronas/caronaLotada',carona('uidIsabella',{vagasDisponiveis:0,status:'ABERTA'})],
  ['caronas/caronaEncerrada',carona('uidIsabella',{dataHoraSaida:instante('2020-01-01T12:00:00.000Z'),status:'ABERTA'})],
  ['caronas/caronaCancelada',carona('uidIsabella',{dataHoraSaida:instante('2020-01-01T12:00:00.000Z'),vagasDisponiveis:0,status:'CANCELADA'})],
  ['caronas/caronaMarcadaLotada',carona('uidIsabella',{status:'LOTADA'})],
  ['caronas/caronaFinalizada',carona('uidIsabella',{status:'FINALIZADA'})],
  ['caronas/caronaSemVagas',carona('uidIsabella',{vagasDisponiveis:undefined,status:'ABERTA'})],
  ['caronas/caronaSemPerfil',carona('uidDesconhecido')],
  ['caronas/id invalido',carona('uidIsabella',{origem:'Nao deve aparecer'})]
 ]);
 definirProvedorParaTeste(async()=>lojaCaronas);
 const leituraCaronas=await fetch(base+'/api/caronas',{headers:{cookie:sessao}});
 assert.equal(leituraCaronas.status,200);
 const viagens=await leituraCaronas.json();
 assert.equal(viagens.disponivel,true);
 assert.equal(viagens.limitado,false);
 const porId=Object.fromEntries(viagens.caronas.map(item=>[item.id,item]));
 assert.equal(porId.caronaAberta.statusExibicao,'ABERTA');
 assert.equal(porId.caronaAberta.motorista,'Isabella');
 assert.equal(porId.caronaAberta.origem,'<script>alert(1)</script>');
 assert.equal(porId.caronaAberta.saida,'2099-06-01T12:00:00.000Z');
 assert.equal(porId.caronaAberta.vagasTotais,3);
 assert.equal(porId.caronaAberta.vagasDisponiveis,2);
 assert.equal(porId.caronaAberta.vagasOcupadas,1);
 assert.equal(porId.caronaAberta.valor,12.5);
 assert.equal(porId.caronaLotada.statusExibicao,'LOTADA');
 assert.equal(porId.caronaEncerrada.statusExibicao,'ENCERRADA');
 assert.equal(porId.caronaCancelada.statusExibicao,'CANCELADA');
 assert.equal(porId.caronaMarcadaLotada.statusExibicao,'LOTADA');
 assert.equal(porId.caronaFinalizada.statusExibicao,'ABERTA');
 assert.equal(porId.caronaSemVagas.statusExibicao,'LOTADA');
 assert.equal(porId.caronaSemVagas.vagasDisponiveis,null);
 assert.equal(porId.caronaSemPerfil.motorista,'');
 assert.equal(porId['id invalido'],undefined);
 assert.equal(viagens.caronas.length,8);
 assert.deepEqual(viagens.indicadores,{abertas:3,lotadas:3,encerradas:1,canceladas:1});
 for(const item of viagens.caronas)assert.deepEqual(Object.keys(item).sort(),['destino','id','motorista','origem','saida','statusArmazenado','statusExibicao','vagasDisponiveis','vagasOcupadas','vagasTotais','valor']);
 assert.doesNotMatch(JSON.stringify(viagens),/segredo@exemplo.com|cnh-secreta|solicitacao-secreta|uidPassageiro|motoristaUid|uidIsabella/);
 assert.equal(lojaCaronas.docs.get('caronas/caronaAberta').status,'ABERTA');
 assert.equal(lojaCaronas.docs.get('caronas/caronaAberta').vagasDisponiveis,2);
 assert.equal(lojaCaronas.docs.get('caronas/caronaLotada').status,'ABERTA');
 const csvReal=await fetch(base+'/api/trips.csv',{headers:{cookie:sessao}});
 assert.equal(csvReal.status,200);
 const textoCsv=await csvReal.text();
 assert.doesNotMatch(textoCsv,/DestinoRealUnico/);
 assert.match(textoCsv,/Senac/);
 const muitas=[];
 for(let i=0;i<=100;i++)muitas.push([`caronas/carona${String(i).padStart(3,'0')}`,carona('uidIsabella',{destino:`Lote ${i}`})]);
 definirProvedorParaTeste(async()=>criarFirestore(muitas));
 const lote=await (await fetch(base+'/api/caronas',{headers:{cookie:sessao}})).json();
 assert.equal(lote.limitado,true);
 assert.equal(lote.caronas.length,100);
 assert.equal(lote.caronas.some(item=>item.id==='carona100'),false);
}finally{definirProvedorParaTeste(null);definirAuditoriaParaTeste(null);}
});
