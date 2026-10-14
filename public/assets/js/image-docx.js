/* PDF переносится в Word страницами-картинками: размеры и подпись сохраняются. */
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xmlHeader='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const section=page=>`<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="${Math.round(page.width*20)}" w:h="${Math.round(page.height*20)}"${page.width>page.height?' w:orient="landscape"':''}/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
export function imageWord() {
  const zip=new JSZip(),paragraphs=[],relations=[];
  zip.file('[Content_Types].xml',xmlHeader+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels',xmlHeader+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  let lastPage=null;
  return {
    add(page,bytes) {
      const index=paragraphs.length+1,width=Math.round(page.width*12700),height=Math.round(page.height*12700);
      if (page.width>1584||page.height>1584) throw new Error('Word поддерживает страницы не более 55,88 см. Для этого документа выберите PDF или PNG.');
      // Разрыв секции находится на предыдущей странице, размеры могут чередоваться.
      if (lastPage) paragraphs[paragraphs.length-1]=paragraphs.at(-1).replace('</w:pPr>',section(lastPage)+'</w:pPr>');
      zip.file(`word/media/page-${index}.png`,bytes);
      relations.push(`<Relationship Id="rIdPage${index}" Type="${R}/image" Target="media/page-${index}.png"/>`);
      paragraphs.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="0" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${width}" cy="${height}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${index}" name="Страница ${index}" descr="Подписанная страница документа"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${index}" name="page-${index}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdPage${index}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`);
      lastPage=page;
    },
    async finish() {
      zip.file('word/document.xml',xmlHeader+`<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${paragraphs.join('')}${section(lastPage)}</w:body></w:document>`);
      zip.file('word/_rels/document.xml.rels',xmlHeader+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join('')}</Relationships>`);
      return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    }
  };
}
