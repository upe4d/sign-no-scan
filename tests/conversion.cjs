/* Проверяется результат конвертации, включая пиксели, размеры и смешанный пакет. */
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const dep=name=>require(process.env.SIGN_RUNTIME_MODULES?path.join(process.env.SIGN_RUNTIME_MODULES,name):name);
const {chromium}=dep('playwright'),{PDFDocument}=dep('pdf-lib'),JSZip=dep('jszip'),{PNG}=dep('pngjs');
const QA=path.resolve(process.env.SIGN_QA_DIR||path.join(__dirname,'../../output/signature-studio-qa'));
const URL=process.env.SIGN_TEST_URL||'http://127.0.0.1:8787';let count=0;
function check(value,message) {assert.ok(value,message);count++;console.log('PASS',message);}
function pixels(bytes) {
  const image=PNG.sync.read(bytes);let blue=0,dark=0,minX=image.width,maxX=0,minY=image.height,maxY=0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++) {const i=(y*image.width+x)*4,r=image.data[i],g=image.data[i+1],b=image.data[i+2];if(r<180&&g<180&&b<180)dark++;if(b>r+50&&b>g+40&&r<100){blue++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
  return {width:image.width,height:image.height,blue,dark,x:(minX+maxX)/2/image.width,y:(minY+maxY)/2/image.height};
}
async function main() {
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1600}}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method(),body:r.postData()}));page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text().slice(0,350));});
 const upload=async(name,source=name)=>({name,mimeType:name.endsWith('.pdf')?'application/pdf':name.endsWith('.png')?'image/png':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:await fs.readFile(path.join(QA,source))});
 const ready=()=>page.waitForFunction(()=>!document.getElementById('documents-input').disabled,{},{timeout:65_000});
 const save=async(format,name,all=false)=>{
   await ready();await page.locator('#export-format').selectOption(format);
   const [download]=await Promise.all([page.waitForEvent('download',{timeout:65_000}),page.locator(all?'#download-all':'#download-current').click()]);
   await download.saveAs(path.join(QA,name));await ready();return fs.readFile(path.join(QA,name));
 };
 const choose=async name=>{await page.locator('.document-item button').filter({hasText:name}).first().click();await ready();};
 const place=async()=>{await page.locator('#signature-width').fill('35');await page.locator('#signature-angle').fill('17');await page.locator('#place-signature').click();const b=await page.locator('#overlay').boundingBox();await page.mouse.click(b.x+b.width*.4,b.y+b.height*.65);assert.ok((await page.locator('#status').textContent()).includes('Подпись добавлена'),'Не удалось поставить подпись');};
 try {
  await page.goto(URL);await page.waitForFunction(()=>document.getElementById('zoom-fit').textContent==='100%');
  await page.locator('#documents-input').setInputFiles(await upload('fixture.docx'));await ready();await page.waitForFunction(()=>document.getElementById('page-total').textContent==='/ 2');
  await page.locator('#signature-input').setInputFiles(await upload('signature-photo.png'));await page.waitForFunction(()=>!document.getElementById('save-signature').disabled);await page.locator('#save-signature').click();
  await page.locator('#next-page').click();await ready();await place();
  const pngZip=await JSZip.loadAsync(await save('png','word-pages.zip')),pngNames=Object.keys(pngZip.files).filter(n=>n.endsWith('.png'));
  check(pngNames.length===2,'DOCX → PNG: обе страницы в ZIP');
  for (let i=0;i<2;i++) {const p=pixels(await pngZip.file(pngNames[i]).async('nodebuffer'));check(p.width===1240&&p.height===1753&&p.dark>2000,'DOCX → PNG: размеры A4 и текст страницы '+(i+1));if(i===1)check(p.blue>200&&Math.abs(p.x-.4)<.055&&Math.abs(p.y-.65)<.035,'DOCX → PNG: подпись и поворот на второй странице');}
  check(await page.locator('#page-number').inputValue()==='2'&&await page.locator('.placed-signature.selected').count()===1,'Экспорт сохраняет текущую страницу и выделение');
  const wordJpg=await JSZip.loadAsync(await save('jpg','word-jpg.zip')),jpgNames=Object.keys(wordJpg.files).filter(n=>n.endsWith('.jpg'));
  check(jpgNames.length===2,'DOCX → JPG: две картинки в архиве');
  const jpegPixels=async bytes=>page.evaluate(async base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),image=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'})),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();const p=ctx.getImageData(0,0,canvas.width,canvas.height).data;let blue=0;for(let i=0;i<p.length;i+=4)if(p[i]<120&&p[i+2]>p[i]+50&&p[i+2]>p[i+1]+40)blue++;return {width:canvas.width,height:canvas.height,blue,white:p[0]>250&&p[1]>250&&p[2]>250};},bytes.toString('base64'));
  const jp=await jpegPixels(await wordJpg.file(jpgNames[1]).async('nodebuffer'));check(jp.width===1240&&jp.height===1753&&jp.blue>200&&jp.white,'JPG: правильные размеры, синие чернила, белый фон');
  const wordPdf=await PDFDocument.load(await save('pdf','word-raster.pdf'));
  check(wordPdf.getPageCount()===2&&Math.abs(wordPdf.getPage(0).getWidth()-595.3)<1,'DOCX → PDF: страницы и физический размер A4');
  await page.locator('#documents-input').setInputFiles(await upload('rotation.pdf'));await choose('rotation.pdf');
  for(let i=0;i<4;i++){if(i){await page.locator('#next-page').click();await ready();}await place();}
  const pdfZip=await JSZip.loadAsync(await save('png','pdf-pages.zip')),pdfNames=Object.keys(pdfZip.files).filter(n=>n.endsWith('.png'));
  check(pdfNames.length===4,'PDF → PNG: все четыре страницы');
  for(let i=0;i<4;i++){const p=pixels(await pdfZip.file(pdfNames[i]).async('nodebuffer'));check(p.width===(i%2?1104:750)&&p.height===(i%2?750:1104)&&p.blue>200&&Math.abs(p.x-.4)<.055&&Math.abs(p.y-.65)<.035,'PDF → PNG: CropBox, поворот и подпись '+i*90+'°');}
  const pdfJpg=await JSZip.loadAsync(await save('jpg','pdf-jpg.zip'));check(Object.keys(pdfJpg.files).filter(n=>n.endsWith('.jpg')).length===4,'PDF → JPG: четыре страницы');
  const rotatedJpg=await jpegPixels(await pdfJpg.file(Object.keys(pdfJpg.files).find(n=>n.endsWith('002.jpg'))).async('nodebuffer'));check(rotatedJpg.width===1104&&rotatedJpg.height===750&&rotatedJpg.blue>200,'PDF → JPG: повёрнутая страница и подпись');
  const imageDocx=await JSZip.loadAsync(await save('docx','pdf-image.docx'));
  check(Object.keys(imageDocx.files).filter(n=>/^word\/media\/.*\.png$/.test(n)).length===4,'PDF → Word: четыре страницы-картинки');
  const xml=await imageDocx.file('word/document.xml').async('string');check((xml.match(/<w:sectPr>/g)||[]).length===4&&!xml.includes('<w:t>'),'PDF → Word: отдельные размеры страниц, текст не выдаётся за редактируемый');
  for(let i=0;i<4;i++)check(pixels(await imageDocx.file(`word/media/page-${i+1}.png`).async('nodebuffer')).blue>200,'PDF → Word: подпись включена в картинку '+(i+1));
  await page.locator('#documents-input').setInputFiles(await upload('copy.docx','fixture.docx'));await choose('copy.docx');await place();
  await choose('fixture.docx');await page.locator('#next-page').click();await ready();
  const batch=await JSZip.loadAsync(await save('png','converted-batch.zip',true));
  const batchNames=Object.keys(batch.files).filter(n=>n.endsWith('.png'));check(batchNames.length===8,'Пакет PNG: PDF и два Word, все страницы');
  const copy=batchNames.find(n=>n.startsWith('copy')&&n.includes('001')),original=batchNames.find(n=>n.startsWith('fixture')&&n.includes('001'));
  check(pixels(await batch.file(copy).async('nodebuffer')).blue>200&&pixels(await batch.file(original).async('nodebuffer')).blue===0,'Пакет не смешивает страницы разных DOCX');
  check(await page.locator('#active-name').textContent()==='fixture.docx'&&await page.locator('#page-number').inputValue()==='2'&&await page.locator('.placed-signature').count()===1,'Предпросмотр активного DOCX восстановлен после пакета');
  const frame=page.frames().find(f=>f.url().endsWith('/docx-frame.html'));check((await frame.locator('section.ssdocx:visible').textContent()).includes('Вторая страница'),'После пакета виден текст нужной страницы');
  const single=await PDFDocument.create();single.addPage([400,600]);await page.locator('#documents-input').setInputFiles({name:'single.pdf',mimeType:'application/pdf',buffer:Buffer.from(await single.save())});await choose('single.pdf');await place();const one=await save('png','single-page.png');check(pixels(one).blue>200,'Одностраничный PNG скачивается без архива');
  const singleJpg=await save('jpg','single-page.jpg');check(singleJpg[0]===255&&singleJpg[1]===216&&(await jpegPixels(singleJpg)).blue>200,'Одностраничный JPG скачивается без архива');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Выбор формата помещается на телефоне');await page.screenshot({path:path.join(QA,'conversion-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1050});await choose('fixture.docx');await page.locator('#export-format').selectOption('pdf');await page.screenshot({path:path.join(QA,'conversion-desktop.png'),fullPage:true});
  check(requests.every(r=>r.url.startsWith(URL)||r.url.startsWith('data:')||r.url.startsWith('blob:'))&&requests.every(r=>r.method==='GET'&&!r.body),'Конвертация не передаёт файлы на сервер и не обращается вовне');check(errors.length===0,'Нет необработанных ошибок JavaScript');
  await fs.writeFile(path.join(QA,'conversion-results.json'),JSON.stringify({checks:count,errors,requests},null,2));console.log('TOTAL',count);
 } finally {console.log('FINAL STATUS',await page.locator('#status').textContent().catch(()=>''));await page.screenshot({path:path.join(QA,'conversion-latest.png'),fullPage:true}).catch(()=>{});await context.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
