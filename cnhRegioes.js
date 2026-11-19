import { dataValida } from './cnh.js';
export function interpretarRegioes(resultados){
 const normal=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
 const nomeTexto=normal(resultados.nome.text),validadeTexto=normal(resultados.validade.text),categoriaTexto=normal(resultados.categoria.text);
 const nomeLinhas=nomeTexto.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 const nomeCandidato=nomeLinhas.filter(s=>!/NOME|SOBRENOME|NAME|NOM|PERMIS|NACIONAL/.test(s)).filter(s=>/^[A-Z][A-Z '\-]{4,199}$/.test(s));
 const datas=[...validadeTexto.matchAll(/\b(\d{2})[\/.-](\d{2})[\/.-](\d{4})\b/g)].map(m=>`${m[3]}-${m[2]}-${m[1]}`).filter(dataValida);
 const categorias=categoriaTexto.split(/\r?\n/).map(s=>s.trim()).filter(s=>/^(A|B|AB|AC|AD|AE|C|D|E|ACC)$/.test(s));
 // O recorte só é utilizado se os próprios rótulos confirmarem o layout esperado.
 const layout=/NOME|NAME|NOM/.test(nomeTexto)&&/VALIDADE|4\s*[B8]/.test(validadeTexto)&&/CAT|HAB/.test(categoriaTexto);
 const sugestoes={nome:layout&&resultados.nome.confidence>=70&&nomeCandidato.length===1?nomeCandidato[0]:'',validade:layout&&resultados.validade.confidence>=70&&datas.length===1?datas[0]:'',categoria:layout&&resultados.categoria.confidence>=70&&categorias.length===1?categorias[0]:''};
 return {sugestoes,confianca:Math.round((resultados.nome.confidence+resultados.validade.confidence+resultados.categoria.confidence)/3),revisaoNecessaria:true,metodo:'pdf_regioes',camposPendentes:Object.keys(sugestoes).filter(k=>!sugestoes[k]),mensagem:layout?'PDF lido por regiões de nome, 4b (validade) e 9 (categoria). Confira todos os campos e preencha os vazios. Documento e QR no Vio exigem conferência manual.':'Layout não identificado com segurança. Preencha manualmente os campos após conferir o documento. OCR não comprova autenticidade.'};
}
