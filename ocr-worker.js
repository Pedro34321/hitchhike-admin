import { parentPort, workerData } from 'node:worker_threads';
import { createWorker } from 'tesseract.js';
import por from '@tesseract.js-data/por';
import { sugerirCnh } from './cnh.js';
import { interpretarRegioes } from './cnhRegioes.js';
let worker;
try {
 worker=await createWorker('por',1,{langPath:por.langPath,gzip:true,cacheMethod:'none',errorHandler:()=>{}});
 if(workerData.pdf){
  const {renderizarPdf,recortar,ampliarParaOcr,temQrLegivel}=await import('./pdfCnh.js');
  const {canvas,frente}=await renderizarPdf(workerData.buffer);
  if(!temQrLegivel(canvas))throw Error('QR Code não identificado ou ilegível. Envie o PDF original completo da CNH com o QR Code legível.');
  if(frente){
   const card=recortar(canvas,frente);
   const campos={nome:{rotulo:[.18,.252,.34,.031],valor:[.18,.281,.61,.041]},validade:{rotulo:[.646,.421,.15,.025],valor:[.646,.445,.145,.040]},categoria:{rotulo:[.856,.581,.115,.025],valor:[.855,.607,.10,.038]}};
   const resultados={};
   for(const [campo,regioes]of Object.entries(campos)){
    const ler=async(r,whitelist='')=>{await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:whitelist});const crop=ampliarParaOcr(recortar(card,{x:r[0]*card.width,y:r[1]*card.height,width:r[2]*card.width,height:r[3]*card.height}));return(await worker.recognize(crop.toBuffer('image/png'))).data;};
    const rotulo=await ler(regioes.rotulo),valor=await ler(regioes.valor,campo==='categoria'?'ABCDE':campo==='validade'?'0123456789/.-':'');
    resultados[campo]={text:rotulo.text.trim()+'\n'+valor.text.trim(),confidence:valor.confidence};
   }
   parentPort.postMessage({...interpretarRegioes(resultados),qrDetectado:true});
  }else{const {data}=await worker.recognize(canvas.toBuffer('image/png'));parentPort.postMessage({...sugerirCnh(data.text,data.confidence),metodo:'pdf_pagina',qrDetectado:true,mensagem:'PDF sem layout reconhecido. '+sugerirCnh(data.text,data.confidence).mensagem});}
 }else{const {data}=await worker.recognize(Buffer.from(workerData.buffer));parentPort.postMessage({...sugerirCnh(data.text,data.confidence),metodo:'imagem'});}
}catch(e){parentPort.postMessage({erro:true,mensagem:e.name==='PasswordException'?'PDF protegido por senha. Use uma cópia sem senha para a leitura.':e.message==='Envie o PDF da CNH com uma página.'||e.message.startsWith('QR Code não identificado')?e.message:'Não foi possível ler o arquivo. Verifique o PDF ou preencha manualmente.'});}finally{if(worker)await worker.terminate();}
