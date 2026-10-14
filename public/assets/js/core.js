export const LIMITS = Object.freeze({files:8, fileBytes:30*1024*1024, totalBytes:100*1024*1024, pages:100, signatures:8, imageBytes:15*1024*1024, imagePixels:20_000_000, zipEntries:2000, zipExpanded:100*1024*1024, placements:200});
export const STORAGE_KEY = 'signature-studio.v1';
export const uuid = () => crypto.randomUUID();
export const clamp = (value,min,max) => Math.min(max,Math.max(min,value));
export const mmToPt = value => value*72/25.4;
export const ptToMm = value => value*25.4/72;
export const clone = value => JSON.parse(JSON.stringify(value));
export const $ = id => document.getElementById(id);
export function status(message,kind='info') { $('status').textContent=message; $('status').dataset.kind=kind; }
export function fileLabel(bytes) { return bytes>=1024*1024 ? `${(bytes/1024/1024).toFixed(1)} МБ` : `${Math.ceil(bytes/1024)} КБ`; }
export function userMessage(error,fallback) {
  if (error?.name==='NotReadableError') return 'Браузер не смог прочитать файл. Выберите его заново.';
  return typeof error?.message==='string'&&/[А-Яа-яЁё]/.test(error.message)?error.message:fallback;
}
export function downloadBlob(blob,name) {
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url; link.download=name; document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60_000);
}
export function outputName(name) { return name.replace(/\.(pdf|docx)$/i,'')+' — с подписью.'+name.split('.').pop().toLowerCase(); }
export function safeXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Этот DOCX содержит неподдерживаемые XML-объявления.');
  const xml=new DOMParser().parseFromString(text,'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('Повреждён XML внутри документа Word.');
  return xml;
}
export function keepWithinPage(item,page) {
  const angle=item.angle*Math.PI/180;
  const width=item.width*page.width, height=item.height*page.height;
  const extentX=(Math.abs(width*Math.cos(angle))+Math.abs(height*Math.sin(angle)))/page.width;
  const extentY=(Math.abs(width*Math.sin(angle))+Math.abs(height*Math.cos(angle)))/page.height;
  const fit=Math.min(1,1/extentX,1/extentY);
  item.width*=fit; item.height*=fit;
  const halfX=extentX*fit/2, halfY=extentY*fit/2;
  const cx=clamp(item.x+item.width/2,halfX,1-halfX),cy=clamp(item.y+item.height/2,halfY,1-halfY);
  item.x=cx-item.width/2; item.y=cy-item.height/2;
  return item;
}
export function pngInfo(data) {
  if (typeof data!=='string'||data.length>2_500_000||!data.startsWith('data:image/png;base64,')) throw new Error('Некорректная сохранённая подпись.');
  return data;
}
