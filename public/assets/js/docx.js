import {LIMITS,safeXml,uuid} from './core.js';
const NS={w:'http://schemas.openxmlformats.org/wordprocessingml/2006/main',rel:'http://schemas.openxmlformats.org/package/2006/relationships',ct:'http://schemas.openxmlformats.org/package/2006/content-types',wp:'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'};
const xmlString=xml=>new XMLSerializer().serializeToString(xml);
export async function openDocx(bytes) {
  const zip=await JSZip.loadAsync(bytes);
  const entries=Object.values(zip.files);
  if (entries.length>LIMITS.zipEntries) throw new Error('Слишком много частей внутри DOCX.');
  let size=0;
  for (const entry of entries) {
    if (!entry.dir) {
      const expanded=entry._data?.uncompressedSize;
      if (!Number.isSafeInteger(expanded)||expanded<0) throw new Error('Не удалось проверить размеры частей DOCX.');
      size+=expanded;
    }
    if (size>LIMITS.zipExpanded) throw new Error('Распакованный DOCX превышает 100 МБ.');
  }
  if (!zip.file('word/document.xml')||!zip.file('[Content_Types].xml')) throw new Error('Файл не является документом DOCX.');
  const text=await zip.file('word/document.xml').async('string');
  if (text.length>8_000_000) throw new Error('Слишком большой XML документа Word.');
  const xml=safeXml(text), body=xml.getElementsByTagNameNS(NS.w,'body')[0];
  if (!body) throw new Error('В DOCX отсутствует текст документа.');
  const paragraphs=[...body.getElementsByTagNameNS(NS.w,'p')];
  if (!paragraphs.length) throw new Error('В документе Word нет абзацев для размещения подписи.');
  // Закладки добавляются только в копию для просмотра: исходный пакет не изменяется.
  const ids=[...xml.getElementsByTagNameNS(NS.w,'bookmarkStart')].map(x=>Number(x.getAttributeNS(NS.w,'id'))||0);
  let bookmarkId=Math.max(0,...ids)+1;
  const prefix='_ss_'+uuid().replaceAll('-','')+'_';
  paragraphs.forEach((paragraph,index)=>{
    const start=xml.createElementNS(NS.w,'w:bookmarkStart'),end=xml.createElementNS(NS.w,'w:bookmarkEnd');
    start.setAttributeNS(NS.w,'w:id',String(bookmarkId)); start.setAttributeNS(NS.w,'w:name',prefix+index);
    end.setAttributeNS(NS.w,'w:id',String(bookmarkId++));
    const position=[...paragraph.children].find(x=>x.localName!=='pPr')||null;
    paragraph.insertBefore(start,position); paragraph.insertBefore(end,position);
  });
  zip.file('word/document.xml',xmlString(xml));
  const preview=await zip.generateAsync({type:'arraybuffer',compression:'DEFLATE'});
  return {preview,prefix,paragraphCount:paragraphs.length};
}
export async function exportDocx(doc) {
  const zip=await JSZip.loadAsync(doc.bytes), xml=safeXml(await zip.file('word/document.xml').async('string'));
  const body=xml.getElementsByTagNameNS(NS.w,'body')[0],paragraphs=[...body.getElementsByTagNameNS(NS.w,'p')];
  const relPath='word/_rels/document.xml.rels';
  const relXml=zip.file(relPath)?safeXml(await zip.file(relPath).async('string')):safeXml(`<Relationships xmlns="${NS.rel}"/>`);
  const ctXml=safeXml(await zip.file('[Content_Types].xml').async('string'));
  if (![...ctXml.getElementsByTagNameNS(NS.ct,'Default')].some(x=>x.getAttribute('Extension').toLowerCase()==='png')) {
    const entry=ctXml.createElementNS(NS.ct,'Default'); entry.setAttribute('Extension','png');entry.setAttribute('ContentType','image/png');ctXml.documentElement.append(entry);
  }
  let drawingId=100_000;
  for (const entry of Object.values(zip.files).filter(x=>/^word\/.*\.xml$/.test(x.name)&&!x.dir)) {
    const part=safeXml(await entry.async('string'));
    for (const item of part.getElementsByTagNameNS(NS.wp,'docPr')) drawingId=Math.max(drawingId,Number(item.getAttribute('id'))||0);
  }
  const images=new Map();
  for (const item of doc.placements) {
    const page=doc.pages[item.page];
    if (page.overflow) throw new Error('Содержимое DOCX выходит за страницу в браузере. Сохраните исходный документ как PDF для точного размещения.');
    const anchor=page.anchors.reduce((best,p)=>!best||Math.abs(p.y-(item.y+item.height/2))<Math.abs(best.y-(item.y+item.height/2))?p:best,null);
    if (!anchor||!paragraphs[anchor.index]) throw new Error('На выбранной странице Word нет однозначного абзаца для привязки подписи.');
    let relationship=images.get(item.data);
    if (!relationship) {
      const suffix=uuid().replaceAll('-',''),media='signature-'+suffix+'.png';
      relationship='rIdSignature'+suffix; images.set(item.data,relationship);
      zip.file('word/media/'+media,item.data.split(',')[1],{base64:true});
      const relation=relXml.createElementNS(NS.rel,'Relationship');relation.setAttribute('Id',relationship);relation.setAttribute('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');relation.setAttribute('Target','media/'+media);relXml.documentElement.append(relation);
    }
    const emu=value=>Math.round(value*12700);
    const x=emu(item.x*page.width),y=emu(item.y*page.height),width=emu(item.width*page.width),height=emu(item.height*page.height);
    const rotation=Math.round(((item.angle%360+360)%360)*60000);
    const drawing=safeXml(`<w:r xmlns:w="${NS.w}" xmlns:wp="${NS.wp}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="0" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${x}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${y}</wp:posOffset></wp:positionV><wp:extent cx="${width}" cy="${height}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${++drawingId}" name="Подпись ${drawingId}" descr="Рукописная подпись"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="signature.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationship}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm rot="${rotation}"><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`);
    const paragraph=paragraphs[anchor.index],run=xml.importNode(drawing.documentElement,true);
    paragraph.insertBefore(run,[...paragraph.children].find(x=>x.localName!=='pPr')||null);
  }
  zip.file('word/document.xml',xmlString(xml));zip.file(relPath,xmlString(relXml));zip.file('[Content_Types].xml',xmlString(ctXml));
  return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
