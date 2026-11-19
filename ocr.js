import { Worker } from 'node:worker_threads';
let ocupado=false;
export function lerCnh(imagem) {
 if(ocupado)throw Object.assign(Error('OCR ocupado. Aguarde a leitura atual.'),{status:429});
 if(typeof imagem!=='string'||imagem.length>7000000)throw Object.assign(Error('Envie o PDF original da CNH de até 5 MB.'),{status:400});
 if(!imagem.startsWith('data:application/pdf;'))throw Object.assign(Error('Aceitamos somente PDF da CNH com frente, verso e QR Code legível. Imagens não são aceitas.'),{status:415});
 if(!/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/.test(imagem))throw Object.assign(Error('Arquivo PDF inválido.'),{status:400});
 const buffer=Buffer.from(imagem.split(',')[1],'base64');
 const pdf=imagem.startsWith('data:application/pdf;');
 if(buffer.length>5*1024*1024||buffer.subarray(0,5).toString()!=='%PDF-')throw Object.assign(Error('Arquivo PDF inválido. Renomear uma imagem não a transforma em PDF.'),{status:400});
 ocupado=true;
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./ocr-worker.js',import.meta.url),{workerData:{buffer,pdf},resourceLimits:{maxOldGenerationSizeMb:256}});
  let finalizado=false;
  const encerrar=(err,data)=>{if(finalizado)return;finalizado=true;clearTimeout(timer);worker.terminate().finally(()=>{ocupado=false;err?reject(Object.assign(Error(err),{status:422})):resolve(data);});};
  const timer=setTimeout(()=>encerrar('Leitura inconclusiva: limite de 60 segundos. Preencha manualmente para revisão.'),60000);
  worker.once('message',r=>r.erro?encerrar(r.mensagem||'Leitura inconclusiva. Tente um arquivo mais nítido ou preencha manualmente.'):encerrar(null,r));
  worker.once('error',()=>encerrar('Não foi possível ler a imagem. Preencha manualmente para revisão.'));
  worker.once('exit',()=>{if(!finalizado)encerrar('Leitura interrompida. Preencha manualmente.');});
 });
}
