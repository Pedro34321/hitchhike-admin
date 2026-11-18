import { FieldPath } from 'firebase-admin/firestore';
import { banco } from './firebaseMotoristas.js';
import { avaliarCnh, validarConferencia } from './cnh.js';
const erro=(msg,status=400)=>Object.assign(Error(msg),{status});
export async function salvarConferencia(uid,b,admin){
 const dados=validarConferencia(b),db=await banco();if(!db)throw erro('Firebase indisponível.',503);
 return db.runTransaction(async tx=>{
  const pedido=db.collection('solicitacoes_motoristas').doc(uid),usuario=db.collection('usuarios').doc(uid),ref=db.collection('cnh_admin').doc(uid);
  const [p,u]=await Promise.all([tx.get(pedido),tx.get(usuario)]);
  if(!p.exists||!u.exists)throw erro('Cadastro ou solicitação não encontrado.',404);
  if(p.data().motoristaUid&&p.data().motoristaUid!==uid)throw erro('UID divergente.',409);
  if(!['PENDENTE','APROVADA'].includes(p.data().status))throw erro('Solicitação encerrada.',409);
  // Toda nova conferência exige decisão explícita posterior. Nunca concede acesso.
  const usuarioDados=u.data();
  tx.set(ref,{...dados,conferidoPor:admin,conferidoEm:new Date().toISOString(),bloqueioAplicado:false});
  tx.update(usuario,{condutorValidado:false,...(usuarioDados.papelAtivo==='MOTORISTA'?{papelAtivo:'PASSAGEIRO'}:{}),cnhValidade:dados.validade,cnhRevisaoNecessaria:!avaliarCnh(dados).apta});
  tx.set(db.collection('cnh_eventos').doc(),{uid,acao:'conferencia registrada',administrador:admin,criadoEm:new Date().toISOString()});
  return {ok:true,...avaliarCnh(dados)};
 });
}
export async function listarCnh(){
 const db=await banco();if(!db)return {disponivel:false,itens:[],limitado:false};
 const docs=(await db.collection('cnh_admin').orderBy(FieldPath.documentId()).limit(101).get()).docs;
 return {disponivel:true,limitado:docs.length>100,itens:docs.slice(0,100).map(d=>{const c=d.data();return {uid:d.id,nome:c.nome,categoria:c.categoria,validade:c.validade,documentoConferido:c.documentoConferido===true,qrConferidoVio:c.qrConferidoVio===true,...avaliarCnh(c)};})};
}
// Percorre todas as páginas. Cada documento é relido na transação para não bloquear uma renovação concorrente.
export async function processarVencimentos(){
 const db=await banco();if(!db)return {disponivel:false,bloqueados:0};
 let cursor=null,bloqueados=0;
 while(true){let q=db.collection('cnh_admin').orderBy(FieldPath.documentId()).limit(100);if(cursor)q=q.startAfter(cursor);const docs=(await q.get()).docs;if(!docs.length)break;
  for(const doc of docs){if(avaliarCnh(doc.data()).situacao!=='vencida'||doc.data().bloqueioAplicado===true)continue;
   const alterado=await db.runTransaction(async tx=>{
    const ref=db.collection('cnh_admin').doc(doc.id),user=db.collection('usuarios').doc(doc.id);
    const [c,u]=await Promise.all([tx.get(ref),tx.get(user)]);
    if(!c.exists||!u.exists||avaliarCnh(c.data()).situacao!=='vencida'||c.data().bloqueioAplicado===true)return false;
    tx.update(user,{condutorValidado:false,cnhRevisaoNecessaria:true,...(u.data().papelAtivo==='MOTORISTA'?{papelAtivo:'PASSAGEIRO'}:{})});
    tx.update(ref,{bloqueioAplicado:true});
    tx.set(db.collection('cnh_eventos').doc(),{uid:doc.id,acao:'acesso de motorista retirado por vencimento',criadoEm:new Date().toISOString(),administrador:'sistema'});
    return true;
   });if(alterado)bloqueados++;
  }if(docs.length<100)break;cursor=docs.at(-1);
 }return {disponivel:true,bloqueados};
}
export function iniciarControleCnh(){let executando=false;const executar=async()=>{if(executando)return;executando=true;try{await processarVencimentos();}catch{console.error('Controle de CNH não concluído; nova tentativa em uma hora.');}finally{executando=false;}};void executar();const timer=setInterval(executar,3600000);timer.unref();return timer;}
