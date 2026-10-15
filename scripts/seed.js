import { db } from '../db.js';
if(db.prepare('SELECT count(*) n FROM people').get().n) throw Error('O banco já contém cadastros; importação cancelada.');
db.exec('BEGIN');
try {
const names=['Marina Oliveira','Lucas Santos','Beatriz Costa','Rafael Lima','Camila Souza','Pedro Alves','Julia Martins','Gabriel Rocha','Ana Ribeiro','Bruno Ferreira','Lara Gomes','Felipe Nunes'];
names.forEach((name,i)=>db.prepare('INSERT INTO people VALUES(?,?,?,?,?,?,?,?,?,?)').run(i+1,name,`demo${i+1}@example.com`,i<6?'motorista':'usuario',i<2?'pendente':i===5?'suspenso':'ativo',i<6?['Honda Fit · Prata','VW Polo · Branco','Fiat Argo · Azul'][i%3]:'',i<6?'DEMO-'+(i+1):'','Sistemas de Informação',i===5?'Exemplo de suspensão para análise':'',new Date().toISOString()));
for(let i=1;i<=48;i++){const d=new Date();d.setDate(d.getDate()-(i%28));db.prepare('INSERT INTO trips VALUES(?,?,?,?,?,?,?,?)').run(i,3+i%3,['Metrô Santo Amaro','Terminal João Dias','Largo Treze'][i%3],'Senac Santo Amaro',d.toISOString().slice(0,10)+'T'+(i%2?'07:30':'18:20'),i%9===0?'cancelada':i%7===0?'agendada':'concluida',1+i%3,5+i%6);}
[['Atraso no encontro',3,1,'Motorista não compareceu ao ponto combinado.'],['Conduta inadequada',7,2,'Passageiro desrespeitou as regras combinadas.'],['Direção perigosa',4,3,'Relato demonstrativo para análise administrativa.']].forEach((r,i)=>db.prepare('INSERT INTO reports(target_id,trip_id,reporter,category,description,created) VALUES(?,?,?,?,?,?)').run(r[1],r[2],'Comunidade (demonstração)',r[0],r[3],new Date().toISOString()));
db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run('demo','true');db.exec('COMMIT');console.log('Dados fictícios inseridos. Nenhum usuário real foi importado.');
}catch(e){db.exec('ROLLBACK');throw e;}
