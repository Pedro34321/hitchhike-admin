// Regras da plataforma; não são uma consulta ao Detran.
export function hojeSP(agora = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(agora);
  const v = tipo => p.find(x=>x.type===tipo).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}
export function dataValida(v) {
  return typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v+'T12:00:00Z')) && new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
}
export function avaliarCnh(cnh, hoje=hojeSP()) {
  if (!cnh || !dataValida(cnh.validade)) return {situacao:'revisao',dias:null,apta:false};
  const dias=Math.round((Date.parse(cnh.validade+'T12:00:00Z')-Date.parse(hoje+'T12:00:00Z'))/86400000);
  if(dias<0)return {situacao:'vencida',dias,apta:false};
  const apta=cnh.documentoConferido===true&&cnh.qrConferidoVio===true&&['B','AB','C','AC','D','AD','E','AE'].includes(cnh.categoria);
  return {situacao:!apta?'revisao':dias<=30?'vence_em_breve':'conferida',dias,apta};
}
export function validarConferencia(b) {
  if(typeof b.nome!=='string'||b.nome.trim().length<3||b.nome.length>200)throw Object.assign(Error('Informe o nome conferido no documento.'),{status:400});
  if(!dataValida(b.validade))throw Object.assign(Error('Data de validade inválida.'),{status:400});
  if(!['A','B','AB','C','AC','D','AD','E','AE','ACC'].includes(b.categoria))throw Object.assign(Error('Categoria inválida.'),{status:400});
  if(typeof b.observacao!=='string'||b.observacao.trim().length<5||b.observacao.length>1000)throw Object.assign(Error('Informe o parecer com 5 a 1.000 caracteres.'),{status:400});
  return {nome:b.nome.trim(),categoria:b.categoria,validade:b.validade,documentoConferido:b.documentoConferido===true,qrConferidoVio:b.qrConferidoVio===true,observacao:b.observacao.trim()};
}
export function sugerirCnh(texto,confidence=0) {
  const linhas=String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().split(/\r?\n/).map(x=>x.trim());
  const proximo=(regex)=>{const i=linhas.findIndex(x=>regex.test(x));return i<0?'':linhas.slice(i,i+3).join(' ');};
  const validadeTexto=proximo(/VALIDADE/),datas=[...validadeTexto.matchAll(/\b(\d{2})[\/.-](\d{2})[\/.-](\d{4})\b/g)].map(m=>`${m[3]}-${m[2]}-${m[1]}`).filter(dataValida);
  const nomeLinha=linhas.findIndex(x=>/\bNOME\b/.test(x));
  const nome=nomeLinha<0?'':linhas[nomeLinha].replace(/^.*?\bNOME\b\s*[:.-]?\s*/,'').replace(/E SOBRENOME.*/,'').trim()||linhas[nomeLinha+1]||'';
  const categoria=proximo(/CAT(?:EGORIA)?\.?\s*(?:HAB|HABILITACAO)/).match(/(?:HAB(?:ILITACAO)?\.?\s*[:.-]?\s*)(AB|AC|AD|AE|ACC|A|B|C|D|E)\b/)?.[1]||'';
  const sugestoes={nome:nome.slice(0,200),categoria,validade:datas.length===1?datas[0]:''};
  return {sugestoes,confianca:Number.isFinite(confidence)?confidence:0,revisaoNecessaria:true,mensagem:'Sugestões de OCR. Corrija os campos e confira documento e QR no Vio. OCR não comprova autenticidade.'};
}
