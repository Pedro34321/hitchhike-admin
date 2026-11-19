import {createCanvas,getDocument,OPS,jsQR} from './ocrDependencias.js';
function multiplicar(m,n){return [m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];}
export function localizarFrentes(ops,viewport){
 let matrix=[1,0,0,1,0,0];const stack=[],imagens=[];
 for(let i=0;i<ops.fnArray.length;i++){
  const op=ops.fnArray[i],args=ops.argsArray[i];
  if(op===OPS.save)stack.push([...matrix]);else if(op===OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];
  else if(op===OPS.transform)matrix=multiplicar(matrix,args);
  else if(op===OPS.paintImageXObject||op===OPS.paintInlineImageXObject){const pontos=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>viewport.convertToViewportPoint(matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]));const xs=pontos.map(p=>p[0]),ys=pontos.map(p=>p[1]);const r={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};const aspect=r.width/r.height;if(r.width>viewport.width*.25&&r.width<viewport.width*.65&&aspect>1.25&&aspect<1.5)imagens.push(r);}
 }
 return imagens.sort((a,b)=>a.y-b.y);
}
export async function renderizarPdf(buffer){
 const task=getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:true,disableFontFace:true,maxImageSize:12000000,stopAtErrors:true});
 let doc;
 try{doc=await task.promise;if(doc.numPages!==1)throw Error('Envie o PDF da CNH com uma página.');
  const page=await doc.getPage(1);const viewport=page.getViewport({scale:3});if(viewport.width*viewport.height>14000000)throw Error('Dimensões do PDF excedem o limite.');
  const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  const regioes=localizarFrentes(await page.getOperatorList(),viewport);
  return {canvas,frente:regioes.length>=2?regioes[0]:null};
 }finally{await task.destroy();}
}
export function recortar(canvas,r){
 const x=Math.max(0,Math.floor(r.x)),y=Math.max(0,Math.floor(r.y)),w=Math.min(Math.ceil(r.width),canvas.width-x),h=Math.min(Math.ceil(r.height),canvas.height-y);
 if(w<1||h<1)throw Error('Região inválida.');const out=createCanvas(w,h);out.getContext('2d').drawImage(canvas,x,y,w,h,0,0,w,h);return out;
}
export function ampliarParaOcr(canvas){
 const out=createCanvas(canvas.width*3+40,canvas.height*3+40),ctx=out.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(canvas,20,20,canvas.width*3,canvas.height*3);const data=ctx.getImageData(0,0,out.width,out.height);for(let i=0;i<data.data.length;i+=4){const v=.299*data.data[i]+.587*data.data[i+1]+.114*data.data[i+2]<170?0:255;data.data[i]=data.data[i+1]=data.data[i+2]=v;}ctx.putImageData(data,0,0);return out;
}
export function temQrLegivel(canvas){
 const direita=recortar(canvas,{x:canvas.width*.5,y:0,width:canvas.width*.5,height:canvas.height*.6});
 return detectarQr(canvas)||detectarQr(direita);
}
function detectarQr(canvas){
 const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
 const rgba=new Uint8ClampedArray(pixels.data);
 for(let i=0;i<rgba.length;i+=4){const a=rgba[i+3]/255;for(let c=0;c<3;c++)rgba[i+c]=Math.round(rgba[i+c]*a+255*(1-a));rgba[i+3]=255;}
 return !!jsQR(rgba,canvas.width,canvas.height,{inversionAttempts:'attemptBoth'});
}
