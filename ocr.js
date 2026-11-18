import { Worker } from 'node:worker_threads';
let ocupado=false;
export function lerCnh(imagem) {
 if(ocupado)throw Object.assign(Error('OCR ocupado. Aguarde a leitura atual.'),{status:429});
 if(typeof imagem!=='string'||imagem.length>7000000||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(imagem))throw Object.assign(Error('Envie uma imagem PNG ou JPEG de até 5 MB.'),{status:400});
 const buffer=Buffer.from(imagem.split(',')[1],'base64');
 if(buffer.length>5*1024*1024||!((buffer[0]===0xff&&buffer[1]===0xd8)||(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))))throw Object.assign(Error('Imagem inválida.'),{status:400});
 ocupado=true;
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./ocr-worker.js',import.meta.url),{workerData:buffer,resourceLimits:{maxOldGenerationSizeMb:256}});
  let finalizado=false;
  const encerrar=(err,data)=>{if(finalizado)return;finalizado=true;clearTimeout(timer);worker.terminate().finally(()=>{ocupado=false;err?reject(Object.assign(Error(err),{status:422})):resolve(data);});};
  const timer=setTimeout(()=>encerrar('Leitura inconclusiva: limite de 60 segundos. Preencha manualmente para revisão.'),60000);
  worker.once('message',r=>r.erro?encerrar('Leitura inconclusiva. Tente uma foto mais nítida ou preencha manualmente.'):encerrar(null,r));
  worker.once('error',()=>encerrar('Não foi possível ler a imagem. Preencha manualmente para revisão.'));
  worker.once('exit',()=>{if(!finalizado)encerrar('Leitura interrompida. Preencha manualmente.');});
 });
}
