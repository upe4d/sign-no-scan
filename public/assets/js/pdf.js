import * as pdfjs from '../vendor/pdf.mjs';
import {LIMITS} from './core.js';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('../vendor/pdf.worker.mjs',import.meta.url).href;
export async function openPdf(bytes) {
  const task=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false,cMapUrl:new URL('../vendor/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('../vendor/standard_fonts/',import.meta.url).href,wasmUrl:new URL('../vendor/wasm/',import.meta.url).href});
  try {
    const pdf=await task.promise;
    if (pdf.numPages>LIMITS.pages) { await pdf.destroy(); throw new Error(`Поддерживается до ${LIMITS.pages} страниц в документе.`); }
    const pages=[];
    for (let i=1;i<=pdf.numPages;i++) {
      const page=await pdf.getPage(i), viewport=page.getViewport({scale:1});
      pages.push({width:viewport.width,height:viewport.height,viewport});
    }
    return {pdf,pages};
  } catch(error) {
    await task.destroy();
    if (error.name==='PasswordException') throw new Error('PDF защищён паролем. Сначала сохраните открываемую копию без пароля.');
    throw error;
  }
}
export async function renderPdf(pdf,index,canvas,cssWidth) {
  const page=await pdf.getPage(index+1);
  const base=page.getViewport({scale:1});
  const scale=Math.min(3,Math.max(1,cssWidth/base.width*(window.devicePixelRatio||1)));
  const viewport=page.getViewport({scale});
  if (viewport.width*viewport.height>20_000_000) throw new Error('Страница слишком большая для предпросмотра.');
  canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
}
export async function exportPdf(doc) {
  const pdf=await window.PDFLib.PDFDocument.load(doc.bytes);
  const embedded=new Map(), pages=pdf.getPages();
  for (const item of doc.placements) {
    let image=embedded.get(item.data);
    if (!image) { image=await pdf.embedPng(item.data); embedded.set(item.data,image); }
    const meta=doc.pages[item.page], v=meta.viewport;
    const width=item.width*meta.width,height=item.height*meta.height;
    const cx=(item.x+item.width/2)*meta.width,cy=(item.y+item.height/2)*meta.height;
    const [px,py]=v.convertToPdfPoint(cx,cy);
    const angle=item.angle*Math.PI/180;
    const [vx,vy]=v.convertToPdfPoint(cx+Math.cos(angle),cy+Math.sin(angle));
    const rotation=Math.atan2(vy-py,vx-px);
    // Преобразование viewport учитывает поворот страницы и смещение CropBox.
    pages[item.page].drawImage(image,{x:px-width/2*Math.cos(rotation)+height/2*Math.sin(rotation),y:py-width/2*Math.sin(rotation)-height/2*Math.cos(rotation),width,height,rotate:window.PDFLib.degrees(rotation*180/Math.PI)});
  }
  return new Blob([await pdf.save()],{type:'application/pdf'});
}
