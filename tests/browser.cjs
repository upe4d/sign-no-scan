/* Проверки используют синтетические документы и временный каталог вне релизов. */
const path=require('node:path');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const modules=process.env.SIGN_RUNTIME_MODULES;
function dependency(name) {return require(modules?path.join(modules,name):name);}
const {chromium}=dependency('playwright');
const {PDFDocument,degrees}=dependency('pdf-lib');
const JSZip=dependency('jszip');
const {PNG}=dependency('pngjs');
const QA=path.resolve(process.env.SIGN_QA_DIR||path.join(__dirname,'../../output/signature-studio-qa'));
const URL=process.env.SIGN_TEST_URL||'http://127.0.0.1:8787';
const wordNS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
let checks=0;
function check(condition,message) {assert.ok(condition,message);checks++;console.log('PASS',message);}
async function fixtures() {
  await fs.mkdir(QA,{recursive:true});
  const pdf=await PDFDocument.create();
  for (const rotation of [0,90,180,270]) {
    const page=pdf.addPage([400,600]);page.setCropBox(20,30,360,530);page.setRotation(degrees(rotation));page.drawText('PDF fixture '+rotation,{x:50,y:550,size:16});
  }
  await fs.writeFile(path.join(QA,'rotation.pdf'),await pdf.save());
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="txt" ContentType="text/plain"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const p=text=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const docXml=`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${wordNS}"><w:body>${p('Синтетический документ для проверки')}${p('Первая страница')}${p('Повторяющийся абзац')}${p('Дата 08.10.2026 — подпись __________________')}<w:p><w:r><w:br w:type="page"/></w:r></w:p>${p('Вторая страница')}${p('Повторяющийся абзац')}<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${p('Ячейка таблицы')}</w:tc><w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${p('Сохранить текст')}</w:tc></w:tr></w:tbl>${p('Подпись __________________')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
  zip.file('word/document.xml',docXml);zip.file('custom-preserve.txt','unchanged-package-member');
  await fs.writeFile(path.join(QA,'fixture.docx'),await zip.generateAsync({type:'nodebuffer'}));
  const overflow=new JSZip();for (const [name,entry] of Object.entries(zip.files)) if (!entry.dir) overflow.file(name,await entry.async('nodebuffer'));
  overflow.file('word/document.xml',docXml.replace(p('Первая страница'),Array.from({length:150},(_,i)=>p('Длинный текст '+i+' для проверки автоматических переносов страниц')).join('')));
  await fs.writeFile(path.join(QA,'overflow.docx'),await overflow.generateAsync({type:'nodebuffer'}));
  const image=new PNG({width:500,height:170});
  for (let y=0;y<image.height;y++) for (let x=0;x<image.width;x++) {const i=(y*image.width+x)*4;image.data[i]=210;image.data[i+1]=212;image.data[i+2]=210;image.data[i+3]=255;}
  const line=(x0,y0,x1,y1)=>{const steps=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));for (let n=0;n<=steps;n++) {const x=Math.round(x0+(x1-x0)*n/steps),y=Math.round(y0+(y1-y0)*n/steps);for (let j=-2;j<=2;j++) for(let k=-2;k<=2;k++) {const i=((y+j)*image.width+x+k)*4;if (i>=0&&i<image.data.length) {image.data[i]=28;image.data[i+1]=51;image.data[i+2]=175;image.data[i+3]=255;}}}};
  line(65,120,270,35);line(270,35,200,110);line(200,110,435,105);line(80,100,390,85);
  await fs.writeFile(path.join(QA,'signature-photo.png'),PNG.sync.write(image));
}
async function main() {
  await fixtures();
  const upload=async name=>({name,mimeType:name.endsWith('.pdf')?'application/pdf':name.endsWith('.png')?'image/png':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:await fs.readFile(path.join(QA,name))});
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1050}});
  const page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push({url:request.url(),method:request.method(),body:request.postData()}));
  page.on('console',message=>{if (message.type()==='error') console.log('BROWSER',message.text().slice(0,300));});
  try {
    await page.goto(URL);await page.waitForSelector('#documents-input',{state:'attached'});await page.waitForFunction(()=>document.getElementById('zoom-fit').textContent==='100%');
    check(!(await page.locator('#remember-signatures').isChecked()),'Сохранение подписи выключено по умолчанию');
    await page.screenshot({path:path.join(QA,'desktop-empty.png'),fullPage:true});
    await page.locator('#documents-input').setInputFiles(await upload('rotation.pdf'));
    await page.waitForFunction(()=>document.getElementById('page-total').textContent==='/ 4');
    await page.locator('#signature-input').setInputFiles(await upload('signature-photo.png'));
    await page.locator('#save-signature').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('save-signature').disabled);
    await page.locator('#save-signature').click();
    check(await page.locator('.signature-item').count()===1,'Фото обработано и подпись добавлена');
    const cleaned=await page.locator('.signature-item img').getAttribute('src');
    const alpha=await page.evaluate(async data=>{const image=await createImageBitmap(new Blob([Uint8Array.from(atob(data.split(",")[1]),x=>x.charCodeAt(0))],{type:"image/png"}));const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let transparent=0,blue=0;for (let i=0;i<pixels.length;i+=4) {if (!pixels[i+3]) transparent++;if (pixels[i+3]>100&&pixels[i+2]>pixels[i]+50) blue++;}image.close();return {transparent,blue};},cleaned);
    check(alpha.transparent>1000&&alpha.blue>200,'Серый фон удалён; синие чернила сохранены');
    check(await page.evaluate(()=>localStorage.length)===0,'Фотография не записана в localStorage');
    for (let number=1;number<=4;number++) {
      if (number>1) {await page.locator('#next-page').click();await page.waitForFunction(n=>document.getElementById('page-number').value===String(n)&&!document.getElementById('place-signature').disabled,number);}
      await page.locator('#signature-width').fill('35');await page.locator('#signature-angle').fill('17');await page.locator('#place-signature').click();
      const bounds=await page.locator('#overlay').boundingBox();await page.mouse.click(bounds.x+bounds.width*0.4,bounds.y+bounds.height*0.65);
      check(await page.locator('.placed-signature').count()===1,'Размещение на странице PDF '+number);
    }
    await page.locator('#undo').click();check(await page.locator('.placed-signature').count()===0,'Отмена последнего размещения');await page.locator('#redo').click();check(await page.locator('.placed-signature').count()===1,'Повтор размещения');
    const downloadPromise=page.waitForEvent('download');await page.locator('#download-current').click();const pdfDownload=await downloadPromise;const signedPdf=path.join(QA,'signed.pdf');await pdfDownload.saveAs(signedPdf);
    const resultPdf=await PDFDocument.load(await fs.readFile(signedPdf));check(resultPdf.getPageCount()===4,'Экспорт PDF сохраняет четыре страницы');
    const pixelBounds=await page.evaluate(async base64=>{
      const pdfjs=await import('./assets/vendor/pdf.mjs'),bytes=Uint8Array.from(atob(base64),x=>x.charCodeAt(0)),pdf=await pdfjs.getDocument({data:bytes,isEvalSupported:false}).promise,result=[];
      for (let n=1;n<=pdf.numPages;n++) {
        const page=await pdf.getPage(n),viewport=page.getViewport({scale:1.4}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d');await page.render({canvasContext:ctx,viewport}).promise;
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1,count=0;
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(pixels[i+2]>pixels[i]+50&&pixels[i+2]>pixels[i+1]+40&&pixels[i]<100){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);count++;}}
        result.push({x:(minX+maxX)/2/canvas.width,y:(minY+maxY)/2/canvas.height,count});
      }await pdf.destroy();return result;
    },(await fs.readFile(signedPdf)).toString('base64'));
    for (let i=0;i<4;i++) check(pixelBounds[i].count>100&&Math.abs(pixelBounds[i].x-0.4)<0.055&&Math.abs(pixelBounds[i].y-0.65)<0.035,'Координаты экспорта при повороте/CropBox '+i*90+'°');
    await page.locator('#remember-signatures').check();check(await page.evaluate(()=>Object.keys(localStorage).join(','))==='signature-studio.v1','Хранилище содержит только ключ подписей');
    const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('signature-studio.v1')));check(!JSON.stringify(stored).includes('rotation.pdf')&&!('documents' in stored),'Имена и содержимое документов не сохраняются');
    await page.locator('#documents-input').setInputFiles(await upload('fixture.docx'));await page.locator('.document-item button').filter({hasText:'fixture.docx'}).click();
    await page.waitForFunction(()=>document.getElementById('page-total').textContent==='/ 2'&&!document.getElementById('page-number').disabled,{},{timeout:35_000});
    check(await page.locator('#word-notice').isVisible(),'Для DOCX показана особенность предпросмотра');
    await page.locator('#next-page').click();await page.waitForFunction(()=>!document.getElementById('place-signature').disabled);
    const wordFrame=page.frames().find(frame=>frame.url().endsWith('/docx-frame.html'));
    check(await wordFrame.locator('section.ssdocx:visible').count()===1,'В Word видна только выбранная страница');
    await page.locator('#signature-width').fill('35');await page.locator('#signature-angle').fill('0');await page.locator('#place-signature').click();const wordBounds=await page.locator('#overlay').boundingBox();await page.mouse.click(wordBounds.x+wordBounds.width*0.5,wordBounds.y+wordBounds.height*0.42);
    await page.screenshot({path:path.join(QA,'desktop-word.png'),fullPage:true});
    const wordPromise=page.waitForEvent('download');await page.locator('#download-current').click();const wordDownload=await wordPromise;const signedWord=path.join(QA,'signed.docx');await wordDownload.saveAs(signedWord);
    const sourceZip=await JSZip.loadAsync(await fs.readFile(path.join(QA,'fixture.docx'))),signedZip=await JSZip.loadAsync(await fs.readFile(signedWord));
    const originalXml=await sourceZip.file('word/document.xml').async('string'),modifiedXml=await signedZip.file('word/document.xml').async('string');
    const texts=xml=>[...xml.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/gs)].map(x=>x[1]);
    check(JSON.stringify(texts(originalXml))===JSON.stringify(texts(modifiedXml)),'Текст, дата и таблица DOCX сохранены');
    check(await signedZip.file('custom-preserve.txt').async('string')==='unchanged-package-member','Другие части пакета Word не изменены');
    check((modifiedXml.match(/<wp:anchor\b/g)||[]).length===1&&modifiedXml.includes('relativeFrom="page"'),'Word содержит один плавающий якорь относительно страницы');
    check(!modifiedXml.includes('_ss_'),'Служебные закладки предпросмотра не попали в экспорт');
    check(Object.keys(signedZip.files).some(x=>x.startsWith('word/media/signature-')),'Изображение подписи встроено в DOCX');
    const allPromise=page.waitForEvent('download');await page.locator('#download-all').click();const allDownload=await allPromise;const allPath=path.join(QA,'signed-all.zip');await allDownload.saveAs(allPath);const archive=await JSZip.loadAsync(await fs.readFile(allPath));check(Object.values(archive.files).filter(x=>!x.dir).length===2,'ZIP содержит оба подписанных документа');
    await page.locator('#draw-signature').click();const drawing=await page.locator('#draw-canvas').boundingBox();await page.mouse.move(drawing.x+40,drawing.y+100);await page.mouse.down();await page.mouse.move(drawing.x+180,drawing.y+30,{steps:12});await page.mouse.move(drawing.x+120,drawing.y+130,{steps:12});await page.mouse.move(drawing.x+300,drawing.y+100,{steps:12});await page.mouse.up();await page.locator('#save-signature').click();check(await page.locator('.signature-item').count()===2,'Рисование подписи мышью работает');
    await page.locator('#duplicate-placement').click();check(await page.locator('.placed-signature').count()===2,'Копирование размещённой подписи');
    const beforeDrag=await page.locator('.placed-signature.selected').boundingBox(),layer=await page.locator('#overlay').boundingBox();await page.mouse.move(beforeDrag.x+beforeDrag.width/2,beforeDrag.y+beforeDrag.height/2);await page.mouse.down();await page.mouse.move(beforeDrag.x+beforeDrag.width/2+layer.width*0.07,beforeDrag.y+beforeDrag.height/2+layer.height*0.02,{steps:5});await page.mouse.up();const afterDrag=await page.locator('.placed-signature.selected').boundingBox();check(afterDrag.x>beforeDrag.x+layer.width*0.05,'Перетаскивание изменяет координаты');
    const handle=await page.locator('.resize-handle').boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+40,handle.y+handle.height/2+15,{steps:5});await page.mouse.up();check((await page.locator('.placed-signature.selected').boundingBox()).width>afterDrag.width+20,'Угловой маркер изменяет размер');
    await page.locator('#signature-angle').fill('40');await page.locator('#signature-angle').dispatchEvent('change');check((await page.locator('.placed-signature.selected').getAttribute('style')).includes('rotate(40deg)'),'Поворот выбранной подписи');
    await page.locator('#remove-placement').click();check(await page.locator('.placed-signature').count()===1,'Удаление выбранной подписи');
    await page.locator('#documents-input').setInputFiles(await upload('overflow.docx'));await page.locator('.document-item button').filter({hasText:'overflow.docx'}).click();await page.waitForFunction(()=>!document.getElementById('documents-input').disabled,{},{timeout:35_000});
    check((await page.locator('#status').textContent()).includes('не укладывается')&&await page.locator('#place-signature').isDisabled(),'Переполнение страницы DOCX обнаружено и постановка блокируется');
    await page.locator('#forget-signatures').click();check(await page.evaluate(()=>localStorage.length)===0,'Сохранённые подписи удаляются');
    const reload=await context.newPage();await reload.goto(URL);await reload.waitForFunction(()=>document.getElementById('zoom-fit').textContent==='100%');check(await reload.locator('.document-item').count()===0&&await reload.locator('.signature-item').count()===0,'Новая вкладка не восстанавливает документы и удалённые подписи');await reload.close();
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);await page.screenshot({path:path.join(QA,'mobile.png'),fullPage:true});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'На телефоне нет горизонтального скролла страницы');
    const post=await context.request.post(URL,{data:'synthetic-no-document'});check(post.status()===405,'PHP отказывает в POST-загрузке');
    check(requests.every(r=>r.url.startsWith(URL)||r.url.startsWith('data:')||r.url.startsWith('blob:')),'Нет запросов на внешние домены');
    check(requests.every(r=>r.method==='GET'&&!r.body),'Браузер не отправляет документы или подписи');
    check(errors.length===0,'Нет необработанных ошибок JavaScript: '+errors.join(' | '));
    await fs.writeFile(path.join(QA,'results.json'),JSON.stringify({checks,errors,pdfBounds:pixelBounds,requests:requests.map(({url,method})=>({url,method}))},null,2));
    console.log('TOTAL',checks);
  } finally {
    console.log('FINAL STATUS',await page.locator('#status').textContent().catch(()=>''),'JS ERRORS',errors);
    await page.screenshot({path:path.join(QA,'latest-state.png'),fullPage:true}).catch(()=>{});
    await context.close();await browser.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

