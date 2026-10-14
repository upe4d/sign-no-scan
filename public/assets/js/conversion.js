import {exportPdf} from './pdf.js';
import {exportDocx} from './docx.js';
import {imageWord} from './image-docx.js';

export const EXPORT_LIMITS=Object.freeze({dpi:150,pixels:5_000_000,dimension:8192,bytes:150*1024*1024});
export function signedName(name,extension) {return name.replace(/\.(pdf|docx)$/i,'').replace(/[\\/]/g,'_')+' — с подписью.'+extension;}
export function rasterScale(page) {
  // На телефонах ограничиваем площадь и длину; физический размер в PDF остаётся прежним.
  return Math.min(EXPORT_LIMITS.dpi/72,Math.sqrt(EXPORT_LIMITS.pixels/(page.width*page.height)),EXPORT_LIMITS.dimension/Math.max(page.width,page.height));
}
async function rasterPage(doc,index,rasterWord,format) {
  const meta=doc.pages[index],scale=rasterScale(meta),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.floor(meta.width*scale));canvas.height=Math.max(1,Math.floor(meta.height*scale));
  const context=canvas.getContext('2d');
  if (!context) throw new Error('Браузер не смог создать картинку страницы.');
  try {
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    if (doc.kind==='pdf') {
      const page=await doc.pdf.getPage(index+1),viewport=page.getViewport({scale});
      await page.render({canvasContext:context,viewport}).promise;
    } else {
      const bytes=await rasterWord(index,scale*0.75),image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
      try {context.drawImage(image,0,0,canvas.width,canvas.height);} finally {image.close();}
    }
    for (const item of doc.placements.filter(x=>x.page===index)) {
      const bytes=Uint8Array.from(atob(item.data.split(',')[1]),char=>char.charCodeAt(0));
      const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
      try {
        const width=item.width*canvas.width,height=item.height*canvas.height;
        context.save();context.translate((item.x+item.width/2)*canvas.width,(item.y+item.height/2)*canvas.height);context.rotate(item.angle*Math.PI/180);context.drawImage(image,-width/2,-height/2,width,height);context.restore();
      } finally {image.close();}
    }
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,format==='jpg'?'image/jpeg':'image/png',0.95));
    if (!blob) throw new Error('Браузер не смог сохранить картинку страницы.');
    return blob;
  } finally {canvas.width=1;canvas.height=1;}
}
export async function convertDocument(doc,format,rasterWord,progress) {
  const target=format==='original'?doc.kind:format;
  if (!['pdf','docx','png','jpg'].includes(target)) throw new Error('Неизвестный формат скачивания.');
  if (target===doc.kind) return [{name:signedName(doc.name,target),blob:await (target==='pdf'?exportPdf(doc):exportDocx(doc))}];
  if (!doc.pages?.length||doc.pages.some(page=>page.overflow)) throw new Error('Документ не укладывается в страницы предпросмотра. Сначала сохраните его в PDF через Word.');
  const pdf=target==='pdf'?await PDFLib.PDFDocument.create():null,word=target==='docx'?imageWord():null,results=[];
  let total=0;
  for (let index=0;index<doc.pages.length;index++) {
    progress(index+1,doc.pages.length);
    const blob=await rasterPage(doc,index,rasterWord,target),bytes=new Uint8Array(await blob.arrayBuffer()),page=doc.pages[index];
    total+=bytes.byteLength;if (total>EXPORT_LIMITS.bytes) throw new Error('Картинки документа превышают 150 МБ. Скачайте исходный формат или уменьшите документ.');
    if (pdf) {const image=await pdf.embedPng(bytes);pdf.addPage([page.width,page.height]).drawImage(image,{x:0,y:0,width:page.width,height:page.height});}
    else if (word) word.add(page,bytes);
    else results.push({name:signedName(doc.name,target).replace(/\.(png|jpg)$/,doc.pages.length===1?'.'+target:` — страница ${String(index+1).padStart(3,'0')}.${target}`),blob});
  }
  if (pdf) return [{name:signedName(doc.name,'pdf'),blob:new Blob([await pdf.save()],{type:'application/pdf'})}];
  if (word) return [{name:signedName(doc.name,'docx'),blob:await word.finish()}];
  return results;
}
