import { parentPort, workerData } from 'node:worker_threads';
import { createWorker } from 'tesseract.js';
import por from '@tesseract.js-data/por';
import { sugerirCnh } from './cnh.js';
let worker;
try {
 worker=await createWorker('por',1,{langPath:por.langPath,gzip:true,cacheMethod:'none',errorHandler:()=>{}});
 const {data}=await worker.recognize(Buffer.from(workerData));
 parentPort.postMessage(sugerirCnh(data.text,data.confidence));
}catch{parentPort.postMessage({erro:true});}finally{if(worker)await worker.terminate();}
