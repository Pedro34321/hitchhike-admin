import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {avaliarCnh,dataValida,hojeSP,sugerirCnh} from '../cnh.js';
import {definirProvedorParaTeste,decidirSolicitacaoMotorista} from '../firebaseMotoristas.js';
import {salvarConferencia,processarVencimentos,listarCnh} from '../cnhFirebase.js';
import {lerCnh} from '../ocr.js';
import {readFile} from 'node:fs/promises';
const cnh={nome:'Pessoa Ficticia',categoria:'B',validade:'2099-12-31',documentoConferido:true,qrConferidoVio:true,observacao:'Documento e QR conferidos para teste.'};
function fake(){const docs=new Map();let eventos=0;return {docs,collection(nome){let limite=100,cursor='';const q={doc(id){return {path:nome+'/'+(id||'evento'+(++eventos)),id};},orderBy(){return q;},limit(n){limite=n;return q;},startAfter(doc){cursor=doc.id;return q;},async get(){return {docs:[...docs].filter(([p])=>p.startsWith(nome+'/')&&p.split('/')[1]>cursor).sort(([a],[b])=>a.localeCompare(b)).slice(0,limite).map(([p,v])=>({id:p.split('/')[1],data:()=>structuredClone(v)}))};}};return q;},async runTransaction(fn){const writes=[];const tx={async get(ref){return {exists:docs.has(ref.path),data:()=>structuredClone(docs.get(ref.path))};},set(ref,v){writes.push([ref.path,v]);},update(ref,v){assert.ok(docs.has(ref.path));writes.push([ref.path,{...docs.get(ref.path),...v}]);}};const result=await fn(tx);writes.forEach(([k,v])=>docs.set(k,v));return result;}};}
after(()=>definirProvedorParaTeste(null));
test('datas: São Paulo, dia de validade inclusivo, categoria e confirmações',()=>{
 assert.equal(hojeSP(new Date('2026-11-19T01:00:00Z')),'2026-11-18');
 assert.equal(dataValida('2026-02-30'),false);assert.equal(dataValida('2028-02-29'),true);
 assert.equal(avaliarCnh({...cnh,validade:'2026-11-18'},'2026-11-18').apta,true);
 assert.equal(avaliarCnh({...cnh,validade:'2026-11-17'},'2026-11-18').situacao,'vencida');
 assert.equal(avaliarCnh({...cnh,validade:'2026-12-18'},'2026-11-18').situacao,'vence_em_breve');
 assert.equal(avaliarCnh({...cnh,qrConferidoVio:false}).apta,false);assert.equal(avaliarCnh({...cnh,categoria:'A'}).apta,false);
});
test('OCR só sugere campos junto aos rótulos e sempre exige revisão',()=>{
 const s=sugerirCnh('NOME\nPESSOA FICTICIA\nNASCIMENTO 02/01/2000\nVALIDADE 18/11/2030\nCAT. HAB. B',90);
 assert.deepEqual(s.sugestoes,{nome:'PESSOA FICTICIA',categoria:'B',validade:'2030-11-18'});assert.equal(s.revisaoNecessaria,true);
 assert.equal(sugerirCnh('NASCIMENTO 01/01/2000').sugestoes.validade,'');
 assert.equal(sugerirCnh('VALIDADE 30/02/2030').sugestoes.validade,'');
 assert.equal(sugerirCnh('').revisaoNecessaria,true);
});
test('OCR não confunde emissão com validade e se abstém em baixa confiança',()=>{
 assert.equal(sugerirCnh('VALIDADE\nEMISSAO 02/10/2025',95).sugestoes.validade,'');
 assert.equal(sugerirCnh('EMISSAO VALIDADE\n02/10/2025 03/01/2027',95).sugestoes.validade,'');
 assert.equal(sugerirCnh('VALIDADE\n02/10/2025 03/01/2027',95).sugestoes.validade,'');
 assert.equal(sugerirCnh('VALIDADE\n03/01/2027',95).sugestoes.validade,'2027-01-03');
 assert.equal(sugerirCnh('VALIDADE 03/01/2027',53).sugestoes.validade,'');
 assert.equal(sugerirCnh('NOME\nRONA | PESSOA TESTE | (25072024)',95).sugestoes.nome,'');
});
test('aprovação exige conferência privada; renovação nunca reativa por conta própria',async()=>{
 const db=fake(),uid='teste';db.docs.set('usuarios/'+uid,{status:'ATIVO',papelAtivo:'PASSAGEIRO',condutorValidado:false});db.docs.set('solicitacoes_motoristas/'+uid,{status:'PENDENTE',motoristaUid:uid});definirProvedorParaTeste(()=>db);
 assert.equal((await decidirSolicitacaoMotorista(uid,'aprovar')).status,409);
 await salvarConferencia(uid,{...cnh,qrConferidoVio:false},'admin@example.com');assert.equal((await decidirSolicitacaoMotorista(uid,'aprovar')).status,409);
 await salvarConferencia(uid,cnh,'admin@example.com');assert.equal(db.docs.get('usuarios/'+uid).condutorValidado,false);
 assert.equal((await decidirSolicitacaoMotorista(uid,'aprovar')).ok,true);
 await salvarConferencia(uid,{...cnh,validade:'2000-01-01'},'admin@example.com');assert.equal(db.docs.get('usuarios/'+uid).condutorValidado,false);assert.equal((await decidirSolicitacaoMotorista(uid,'aprovar')).status,409);
 await salvarConferencia(uid,cnh,'admin@example.com');assert.equal(db.docs.get('usuarios/'+uid).condutorValidado,false);assert.equal((await decidirSolicitacaoMotorista(uid,'aprovar')).ok,true);
 await assert.rejects(()=>salvarConferencia(uid,{...cnh,validade:'2026-02-30'},'admin'),/inválida/);
 assert.equal((await listarCnh()).itens.length,1);
});
test('controle percorre mais de 100 CNHs, retira acesso vencido, mantém renovação e é idempotente',async()=>{
 const db=fake();for(let i=0;i<103;i++){const uid='u'+String(i).padStart(3,'0');db.docs.set('cnh_admin/'+uid,{...cnh,validade:i===102?'2099-12-31':'2000-01-01'});db.docs.set('usuarios/'+uid,{condutorValidado:true,papelAtivo:'MOTORISTA',status:'ATIVO'});}definirProvedorParaTeste(()=>db);
 assert.equal((await processarVencimentos()).bloqueados,102);assert.equal(db.docs.get('usuarios/u100').condutorValidado,false);assert.equal(db.docs.get('usuarios/u102').condutorValidado,true);assert.equal((await processarVencimentos()).bloqueados,0);
 assert.equal([...db.docs.keys()].filter(x=>x.startsWith('cnh_eventos/')).length,102);
});
test('imagens são rejeitadas, inclusive renomeadas para PDF',async()=>{
 const b=await readFile(new URL('./fixtures/ocr-sintetico.png',import.meta.url));
 for(const tipo of ['image/png','image/jpeg'])assert.throws(()=>lerCnh('data:'+tipo+';base64,'+b.toString('base64')),e=>e.status===415);
 assert.throws(()=>lerCnh('data:application/pdf;base64,'+b.toString('base64')),e=>e.status===400);
});
test('PDF sintético: lê campos por região e separa emissão da validade',async()=>{
 const buffer=await readFile(new URL('./fixtures/cnh-sintetica.pdf',import.meta.url));
 const r=await lerCnh('data:application/pdf;base64,'+buffer.toString('base64'));
 assert.equal(r.metodo,'pdf_regioes');assert.equal(r.qrDetectado,true);assert.equal(r.sugestoes.validade,'2030-11-18');assert.equal(r.sugestoes.categoria,'B');assert.equal(r.sugestoes.nome,'PESSOA FICTICIA TESTE');assert.equal(r.revisaoNecessaria,true);
});
test('PDF sem QR Code é rejeitado sem sugestões de aprovação',async()=>{
 const b=await readFile(new URL('./fixtures/cnh-sem-qr.pdf',import.meta.url));
 await assert.rejects(()=>lerCnh('data:application/pdf;base64,'+b.toString('base64')),e=>e.status===422&&/QR Code/.test(e.message));
});
test('PDF inválido, protegido e de múltiplas páginas não fornece sugestões',async()=>{
 assert.throws(()=>lerCnh('data:application/pdf;base64,aGVsbG8='),/inválido/);
 for(const file of ['pdf-duas-paginas.pdf','pdf-senha.pdf']){const b=await readFile(new URL('./fixtures/'+file,import.meta.url));await assert.rejects(()=>lerCnh('data:application/pdf;base64,'+b.toString('base64')),/uma página|senha/);}
});
