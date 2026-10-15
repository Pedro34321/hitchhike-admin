import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { db, audit } from './db.js';
const prod=process.env.NODE_ENV==='production';
const publicDir=fileURLToPath(new URL('./public/',import.meta.url));
const attempts=new Map();
const digest=s=>createHash('sha256').update(s).digest('hex');
export function csvCell(value){let s=String(value??'');if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function fail(message,status=400){throw Object.assign(Error(message),{status});}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
async function body(req){let s='';for await(const chunk of req){s+=chunk;if(Buffer.byteLength(s)>32768)fail('Requisição muito grande',413);}try{return JSON.parse(s||'{}');}catch{fail('JSON inválido');}}
function str(v,min=1,max=1000){if(typeof v!=='string'||v.trim().length<min||v.length>max)fail(`Preencha o campo com ${min} a ${max} caracteres.`);return v.trim();}
function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
function cookie(token='',age=28800){return `hh_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${prod?'; Secure':''}`;}
function session(req){const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('hh_session='))?.slice(11);if(!token)return null;return db.prepare('SELECT a.id,a.email,s.token FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token=? AND s.expires>?').get(digest(token),Date.now());}
function tripFilter(url){const from=url.searchParams.get('from')||'',to=url.searchParams.get('to')||'',status=url.searchParams.get('status')||'';if([from,to].some(x=>x&&!/^\d{4}-\d{2}-\d{2}$/.test(x))||(from&&to&&from>to))fail('Período inválido');if(status&&!['concluida','agendada','cancelada'].includes(status))fail('Status inválido');return db.prepare(`SELECT t.*,p.name driver FROM trips t JOIN people p ON p.id=t.driver_id WHERE (?='' OR substr(t.date,1,10)>=?) AND (?='' OR substr(t.date,1,10)<=?) AND (?='' OR t.status=?) ORDER BY t.date DESC`).all(from,from,to,to,status,status);}
export const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
 try{
 const url=new URL(req.url,'http://localhost');const path=url.pathname;
 if(req.method==='GET'&&!path.startsWith('/api/')){const files={'/':'index.html','/styles.css':'styles.css','/app.js':'app.js'};if(!files[path])fail('Página não encontrada',404);const type=path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'text/html';res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(await readFile(publicDir+files[path]));return;}
 if(!['GET','POST'].includes(req.method))fail('Método não permitido',405);
 if(req.method==='POST'){
  if(req.headers['sec-fetch-site']==='cross-site')fail('Origem não permitida',403);
  if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{fail('Origem inválida',403);}if(origin.host!==req.headers.host||!['https:','http:'].includes(origin.protocol))fail('Origem não permitida',403);}
  if(!req.headers['content-type']?.startsWith('application/json'))fail('Use application/json',415);
 }
 if(path==='/api/login'&&req.method==='POST'){
  const now=Date.now();for(const [k,v]of attempts)if(v.until<now)attempts.delete(k);
  const key=req.socket.remoteAddress;let attempt=attempts.get(key)||{count:0,until:now+900000};if(attempt.count>=10)fail('Muitas tentativas. Aguarde 15 minutos.',429);attempt.count++;attempts.set(key,attempt);
  const b=await body(req);const email=str(b.email,3,254).toLowerCase();const password=str(b.password,1,256);const admin=db.prepare('SELECT * FROM admins WHERE email=?').get(email);
  const hash=scryptSync(password,admin?.salt||'dummy-salt-for-timing',64);if(!admin||!timingSafeEqual(hash,Buffer.from(admin.hash,'hex')))fail('E-mail ou senha incorretos.',401);
  attempts.delete(key);db.prepare('DELETE FROM sessions WHERE expires<?').run(now);const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),admin.id,now+28800000);res.setHeader('Set-Cookie',cookie(token));json(res,200,{email:admin.email});return;
 }
 const admin=session(req);if(!admin)fail('Entre com sua conta de administrador.',401);
 if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(admin.token);res.setHeader('Set-Cookie',cookie('',0));json(res,200,{ok:true});return;}
 if(path==='/api/password'&&req.method==='POST'){const b=await body(req);const current=str(b.current,1,256),password=str(b.password,12,256);const row=db.prepare('SELECT * FROM admins WHERE id=?').get(admin.id);if(!timingSafeEqual(scryptSync(current,row.salt,64),Buffer.from(row.hash,'hex')))fail('Senha atual incorreta',403);const salt=randomBytes(16).toString('hex');transaction(()=>{db.prepare('UPDATE admins SET salt=?,hash=? WHERE id=?').run(salt,scryptSync(password,salt,64).toString('hex'),admin.id);db.prepare('DELETE FROM sessions WHERE admin_id=?').run(admin.id);audit(admin.email,'senha alterada','admin','Sessões encerradas');});res.setHeader('Set-Cookie',cookie('',0));json(res,200,{ok:true});return;}
 if(path==='/api/data'&&req.method==='GET'){json(res,200,{admin:{email:admin.email},demo:db.prepare("SELECT value FROM settings WHERE key='demo'").get()?.value==='true',people:db.prepare('SELECT * FROM people ORDER BY id DESC').all(),trips:tripFilter(url),reports:db.prepare('SELECT r.*,p.name target_name,p.role target_role FROM reports r JOIN people p ON p.id=r.target_id ORDER BY r.id DESC').all(),audit:db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all()});return;}
 const match=path.match(/^\/api\/people\/(\d+)\/status$/);
 if(match&&req.method==='POST'){const b=await body(req);const reason=str(b.reason,5,1000);const row=db.prepare('SELECT * FROM people WHERE id=?').get(Number(match[1]));if(!row)fail('Cadastro não encontrado',404);const transitions=row.role==='motorista'?{pendente:['ativo','cancelado'],ativo:['suspenso','cancelado'],suspenso:['ativo','cancelado'],cancelado:[]}:{ativo:['bloqueado','cancelado'],bloqueado:['ativo','cancelado'],cancelado:[]};if(!transitions[row.status]?.includes(b.status))fail('Esta alteração não é permitida para o status atual.',409);transaction(()=>{db.prepare('UPDATE people SET status=?,reason=? WHERE id=?').run(b.status,reason,row.id);audit(admin.email,`${row.status} → ${b.status}`,`${row.role} #${row.id}`,reason);});json(res,200,{ok:true});return;}
 if(path==='/api/reports'&&req.method==='POST'){const b=await body(req);const target=Number(b.target_id);if(!Number.isSafeInteger(target)||!db.prepare('SELECT id FROM people WHERE id=?').get(target))fail('Selecione um cadastro válido');const trip=b.trip_id?Number(b.trip_id):null;if(trip!==null&&(!Number.isSafeInteger(trip)||!db.prepare('SELECT id FROM trips WHERE id=?').get(trip)))fail('Viagem não encontrada');const reporter=str(b.reporter,3,150),category=str(b.category,3,100),description=str(b.description,10,3000);transaction(()=>{const r=db.prepare('INSERT INTO reports(target_id,trip_id,reporter,category,description,created) VALUES(?,?,?,?,?,?)').run(target,trip,reporter,category,description,new Date().toISOString());audit(admin.email,'denúncia registrada',r.lastInsertRowid,'Registro recebido pelo atendimento');});json(res,201,{ok:true});return;}
 const reportMatch=path.match(/^\/api\/reports\/(\d+)$/);
 if(reportMatch&&req.method==='POST'){const b=await body(req);const row=db.prepare('SELECT * FROM reports WHERE id=?').get(Number(reportMatch[1]));if(!row)fail('Denúncia não encontrada',404);if(!({aberta:['em_analise','resolvida','arquivada'],em_analise:['resolvida','arquivada'],resolvida:[],arquivada:[]})[row.status]?.includes(b.status))fail('Transição inválida',409);const resolution=str(b.resolution,5,2000);transaction(()=>{db.prepare('UPDATE reports SET status=?,resolution=? WHERE id=?').run(b.status,resolution,row.id);audit(admin.email,`denúncia ${b.status}`,row.id,resolution);});json(res,200,{ok:true});return;}
 if(path==='/api/trips.csv'&&req.method==='GET'){const rows=tripFilter(url);const fields=['id','driver','origin','destination','date','status','passengers','amount'];const csv='\uFEFF'+[['ID','Motorista','Origem','Destino','Data','Status','Passageiros','Valor combinado (R$)'],...rows.map(r=>fields.map(k=>k==='amount'?Number(r[k]).toFixed(2).replace('.',','):r[k]))].map(r=>r.map(csvCell).join(';')).join('\r\n');audit(admin.email,'exportação CSV','viagens',`${rows.length} registros`);res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="hitchhike-viagens.csv"'});res.end(csv);return;}
 fail('Rota não encontrada',404);
 }catch(e){if(!e.status)console.error('Falha no servidor:',e.message);json(res,e.status||500,{error:e.status?e.message:'Erro interno. Tente novamente.'});}
});
if(process.argv[1]===fileURLToPath(import.meta.url)){server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log(`Hitchhike: http://localhost:${process.env.PORT||3000}`));}
