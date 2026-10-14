import {$,LIMITS,STORAGE_KEY,uuid,clamp,clone,mmToPt,ptToMm,status,fileLabel,downloadBlob,pngInfo,keepWithinPage,userMessage} from './core.js';
import {openPdf,renderPdf} from './pdf.js';
import {openDocx} from './docx.js';
import {convertDocument,signedName,EXPORT_LIMITS} from './conversion.js';
import {initSignatureEditor} from './signatures.js';

const state={documents:[],signatures:[],activeId:null,signatureId:null,selectedId:null,page:0,zoom:1,busy:false,placing:false,remember:false};
const doc=()=>state.documents.find(x=>x.id===state.activeId);
const signature=()=>state.signatures.find(x=>x.id===state.signatureId);
const selected=()=>doc()?.placements.find(x=>x.id===state.selectedId);
const icon=name=>{const i=document.createElement('i');i.dataset.lucide=name;return i;};
const icons=()=>window.lucide?.createIcons();
let frameReady=false,frameLoad=null,frameToken='',frameDocumentId=null,frameRaster=null,resizeTimer=null,gesture=null;

function remember() {
  try {
    if (state.remember) localStorage.setItem(STORAGE_KEY,JSON.stringify({remember:true,signatures:state.signatures.map(({id,data,width,height})=>({id,data,width,height}))}));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    state.remember=false;$('remember-signatures').checked=false;
    status('Браузер не разрешил сохранить подписи. Они доступны до закрытия страницы.','error');
  }
}
function restore() {
  try {
    const text=localStorage.getItem(STORAGE_KEY);if (!text) return;
    if (text.length>12_000_000) throw new Error('Размер сохранённых данных превышен.');
    const saved=JSON.parse(text);
    if (!saved.remember||!Array.isArray(saved.signatures)||saved.signatures.length>LIMITS.signatures) throw new Error('Неверные сохранённые данные.');
    state.signatures=saved.signatures.map(item=>{
      if (!Number.isInteger(item.width)||!Number.isInteger(item.height)||item.width<1||item.height<1||item.width>1600||item.height>1600||typeof item.id!=='string') throw new Error('Неверная подпись.');
      return {id:item.id,data:pngInfo(item.data),width:item.width,height:item.height};
    });
    state.remember=true;state.signatureId=state.signatures[0]?.id||null;$('remember-signatures').checked=true;
  } catch {state.signatures=[];state.remember=false;try {localStorage.removeItem(STORAGE_KEY);} catch { /* Хранилище может быть отключено. */ }}
}
function renderSignatures() {
  const list=$('signature-list');list.replaceChildren();
  state.signatures.forEach((item,index)=>{
    const box=document.createElement('div');box.className='signature-item'+(item.id===state.signatureId?' active':'');
    box.tabIndex=0;box.setAttribute('role','button');box.setAttribute('aria-label',`Выбрать подпись ${index+1}`);box.setAttribute('aria-pressed',String(item.id===state.signatureId));
    const image=document.createElement('img');image.src=item.data;image.alt=`Подпись ${index+1}`;box.append(image);
    const remove=document.createElement('button');remove.className='signature-delete';remove.textContent='×';remove.setAttribute('aria-label',`Удалить подпись ${index+1}`);remove.disabled=state.busy;
    remove.onclick=event=>{event.stopPropagation();if (state.busy) return;state.signatures=state.signatures.filter(x=>x.id!==item.id);if (state.signatureId===item.id) state.signatureId=state.signatures[0]?.id||null;remember();renderSignatures();update();};
    const choose=()=>{if (state.busy) return;state.signatureId=item.id;renderSignatures();update();};
    box.onclick=choose;box.onkeydown=event=>{if (event.key==='Enter'||event.key===' ') {event.preventDefault();choose();}};box.append(remove);list.append(box);
  });
}
function renderDocuments() {
  $('document-count').textContent=`${state.documents.length} / ${LIMITS.files}`;
  const list=$('document-list');list.replaceChildren();
  state.documents.forEach(item=>{
    const row=document.createElement('div');row.className='document-item'+(item.id===state.activeId?' active':'');
    const button=document.createElement('button');button.disabled=state.busy;button.append(icon(item.kind==='pdf'?'file-text':'file-type-2'));
    const label=document.createElement('span');label.className='file-label';const title=document.createElement('strong');title.textContent=item.name;title.title=item.name;
    const details=document.createElement('small');details.textContent=item.error?'Не удалось открыть':`${item.kind.toUpperCase()} · ${fileLabel(item.bytes.byteLength)} · подписей: ${item.placements.length}`;label.append(title,details);button.append(label);button.onclick=()=>selectDocument(item.id);
    const remove=document.createElement('button');remove.className='icon-button';remove.append(icon('x'));remove.title='Убрать документ';remove.setAttribute('aria-label',`Убрать ${item.name}`);remove.disabled=state.busy;remove.onclick=()=>removeDocument(item.id);
    row.append(button,remove);list.append(row);
  });icons();
}
function update() {
  const current=doc(),ready=current?.pages?.length&&!current.error,sel=selected(),meta=current?.pages?.[state.page];
  const canPlace=ready&&signature()&&!state.busy&&!(current.kind==='docx'&&(meta.overflow||!meta.anchors.length));
  $('place-signature').disabled=!canPlace;$('place-signature').classList.toggle('active',state.placing);$('place-signature').title=state.placing?'Нажмите на место подписи на странице':'';
  $('overlay').classList.toggle('placing',state.placing);
  $('download-current').disabled=state.busy||!current?.placements.length||!ready;
  $('download-all').disabled=state.busy||!state.documents.some(x=>x.placements.length);
  $('export-format').disabled=state.busy;
  const format=$('export-format').value;
  $('export-notice').hidden=!current||format==='original'||format===current.kind;
  $('export-notice').textContent=format==='docx'?'PDF → Word: каждая страница станет картинкой с подписью. Текст этих страниц не редактируется.':['png','jpg'].includes(format)?'PNG / JPG: все страницы с подписями. Несколько страниц скачиваются ZIP-архивом. До 150 dpi.':'Word → PDF: страницы сохраняются картинками, как в предпросмотре. Текст в таком PDF не выделяется.';
  $('previous-page').disabled=state.busy||!ready||state.page===0;$('next-page').disabled=state.busy||!ready||state.page>=current.pages.length-1;
  $('page-number').disabled=state.busy||!ready;$('page-number').value=String(state.page+1);$('page-number').max=String(current?.pages?.length||1);
  $('page-total').textContent=`/ ${current?.pages?.length||0}`;$('placement-count').textContent=`Подписей: ${current?.placements.length||0}`;
  $('duplicate-placement').disabled=state.busy||!sel;$('remove-placement').disabled=state.busy||!sel;
  $('signature-width').disabled=state.busy;$('signature-angle').disabled=state.busy;
  $('undo').disabled=state.busy||!current||current.historyIndex===0;$('redo').disabled=state.busy||!current||current.historyIndex>=current.history.length-1;
  $('documents-input').disabled=state.busy;$('upload-signature').disabled=state.busy||state.signatures.length>=LIMITS.signatures;$('draw-signature').disabled=$('upload-signature').disabled;
  $('remember-signatures').disabled=state.busy;$('forget-signatures').disabled=state.busy;
  $('reset').disabled=state.busy;$('active-name').textContent=current?.name||'Добавьте первый документ';
  $('active-details').textContent=current?`${current.kind.toUpperCase()} · ${fileLabel(current.bytes.byteLength)} · обрабатывается на устройстве`:'Работа в браузере · PDF / DOCX';
  $('word-notice').hidden=current?.kind!=='docx';$('zoom-fit').textContent=`${Math.round(state.zoom*100)}%`;
  if (sel&&meta) {$('signature-width').value=String(Math.round(ptToMm(sel.width*meta.width)));$('signature-angle').value=String(Math.round(sel.angle));}
}
function busy(value) {state.busy=value;renderDocuments();renderSignatures();update();}
function commit() {
  const current=doc();if (!current) return;
  const snapshot=clone(current.placements);
  if (JSON.stringify(snapshot)===JSON.stringify(current.history[current.historyIndex])) return;
  current.history=current.history.slice(0,current.historyIndex+1);current.history.push(snapshot);
  if (current.history.length>40) current.history.shift();
  current.historyIndex=current.history.length-1;renderDocuments();update();
}
function redraw() {
  const current=doc(),layer=$('overlay');layer.replaceChildren();if (!current?.pages) return;
  current.placements.filter(x=>x.page===state.page).forEach(item=>{
    const box=document.createElement('div');box.className='placed-signature'+(item.id===state.selectedId?' selected':'');box.dataset.placement=item.id;
    box.style.left=`${item.x*100}%`;box.style.top=`${item.y*100}%`;box.style.width=`${item.width*100}%`;box.style.height=`${item.height*100}%`;box.style.transform=`rotate(${item.angle}deg)`;
    box.tabIndex=0;box.setAttribute('role','button');box.setAttribute('aria-label','Выбрать размещённую подпись. Стрелки перемещают; Delete удаляет.');
    const image=document.createElement('img');image.src=current.assets[item.signatureId].data;image.alt='Подпись';image.draggable=false;box.append(image);
    if (item.id===state.selectedId) {const handle=document.createElement('span');handle.className='resize-handle';handle.dataset.resize='true';handle.title='Изменить размер';box.append(handle);}
    layer.append(box);
  });update();
}
function sizePaper() {
  const current=doc(),meta=current?.pages?.[state.page];if (!meta) return;
  const width=Math.max(120,Math.min($('viewer').clientWidth-40,meta.width/0.75)*state.zoom);
  $('paper').style.width=`${width}px`;$('paper').style.height=`${width*meta.height/meta.width}px`;
  if (current.kind==='docx') $('docx-frame').contentWindow.postMessage({type:'show',token:frameToken,page:state.page,width},'*');
  return width;
}
async function renderPage() {
  const current=doc();if (!current?.pages?.length||current.error) {$('paper').hidden=true;$('empty-state').hidden=false;update();return;}
  $('empty-state').hidden=true;$('paper').hidden=false;
  $('pdf-canvas').hidden=current.kind!=='pdf';$('docx-frame').hidden=current.kind!=='docx';
  const width=sizePaper();if (current.kind==='pdf') await renderPdf(current.pdf,state.page,$('pdf-canvas'),width);
  state.placing=false;state.selectedId=null;redraw();
}
function loadFrame(current) {
  return new Promise((resolve,reject)=>{
    frameToken=uuid();frameDocumentId=null;
    const timeout=setTimeout(()=>{frameLoad=null;reject(new Error('Word не успел открыть документ. Попробуйте более простой DOCX или PDF.'));},30_000);
    frameLoad={token:frameToken,resolve:pages=>{clearTimeout(timeout);frameLoad=null;frameDocumentId=current.id;resolve(pages);},reject:error=>{clearTimeout(timeout);frameLoad=null;reject(error);},start:()=>{
      $('docx-frame').contentWindow.postMessage({type:'load',token:frameToken,bytes:current.preview.slice(0),prefix:current.prefix,width:Math.max(120,$('viewer').clientWidth-40)},'*');
    }};
    if (frameReady) frameLoad.start();else $('docx-frame').contentWindow.postMessage({type:'ping'},'*');
  });
}
function rasterWord(page,scale) {
  return new Promise((resolve,reject)=>{
    const requestId=uuid(),token=frameToken;
    const timeout=setTimeout(()=>{frameRaster=null;reject(new Error('Преобразование Word заняло слишком много времени. Обновите страницу и попробуйте более простой документ.'));},60_000);
    frameRaster={requestId,token,resolve:bytes=>{clearTimeout(timeout);frameRaster=null;resolve(bytes);},reject:error=>{clearTimeout(timeout);frameRaster=null;reject(error);}};
    $('docx-frame').contentWindow.postMessage({type:'raster',token,requestId,page,scale},'*');
  });
}
window.addEventListener('message',event=>{
  if (event.source!==$('docx-frame').contentWindow||!event.data) return;
  const message=event.data;
  if (frameRaster&&message.token===frameRaster.token&&message.requestId===frameRaster.requestId) {
    if (message.type==='raster-error') frameRaster.reject(new Error(String(message.message||'Ошибка преобразования Word.')));
    else if (message.type==='raster-result') {
      if (!(message.bytes instanceof ArrayBuffer)||message.bytes.byteLength>EXPORT_LIMITS.bytes) frameRaster.reject(new Error('Некорректная картинка страницы Word.'));
      else frameRaster.resolve(message.bytes);
    }
    return;
  }
  if (message.type==='ready') {if (!frameReady) {frameReady=true;frameLoad?.start();}return;}
  if (!frameLoad||message.token!==frameLoad.token) return;
  if (message.type==='error') {frameLoad.reject(new Error(String(message.message||'Ошибка просмотра Word.')));return;}
  if (message.type==='loaded') {
    if (!Array.isArray(message.pages)||!message.pages.length||message.pages.length>LIMITS.pages||message.pages.some(p=>!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<10||p.height<10||!Array.isArray(p.anchors))) {frameLoad.reject(new Error('Некорректные размеры страниц Word.'));return;}
    frameLoad.resolve(message.pages);
  }
});
async function selectDocument(id) {
  if (state.busy) return;
  const current=state.documents.find(x=>x.id===id);if (!current) return;
  state.activeId=id;state.page=0;state.zoom=1;state.selectedId=null;state.placing=false;busy(true);status('Открываю документ…');
  try {
    current.error=null;
    if (current.kind==='pdf'&&!current.pdf) Object.assign(current,await openPdf(current.bytes));
    if (current.kind==='docx') {
      if (!current.preview) Object.assign(current,await openDocx(current.bytes));
      $('paper').hidden=false;$('docx-frame').hidden=false;$('pdf-canvas').hidden=true;
      current.pages=await loadFrame(current);
    }
    await renderPage();
    const overflow=current.pages.some(p=>p.overflow);
    status(overflow?'DOCX не укладывается в страницы при просмотре. Для размещения сохраните исходный файл как PDF.':'Документ открыт. Выберите подпись и укажите место.',overflow?'error':'info');
  } catch(error) {current.error=userMessage(error,'Не удалось открыть документ. Проверьте, что файл не повреждён и не защищён паролем.');current.pages=null;$('paper').hidden=true;$('empty-state').hidden=false;status(current.error,'error');}
  finally {busy(false);}
}
async function addDocuments(files) {
  if (state.busy) return;
  busy(true);const failures=[];
  try {
    for (const file of files) {
      try {
        if (state.documents.length>=LIMITS.files) throw new Error('Одновременно можно добавить до 8 документов.');
        const kind=file.name.split('.').pop().toLowerCase();if (!['pdf','docx'].includes(kind)) throw new Error('Поддерживаются PDF и Word (.docx).');
        if (!file.size||file.size>LIMITS.fileBytes) throw new Error('Размер документа должен быть от 1 байта до 30 МБ.');
        if (state.documents.reduce((sum,x)=>sum+x.bytes.byteLength,0)+file.size>LIMITS.totalBytes) throw new Error('Общий размер документов превышает 100 МБ.');
        const bytes=new Uint8Array(await file.arrayBuffer());
        if (kind==='pdf'&&!new TextDecoder().decode(bytes.slice(0,1024)).includes('%PDF-')) throw new Error('Файл не содержит заголовок PDF.');
        if (kind==='docx'&&(bytes[0]!==80||bytes[1]!==75)) throw new Error('Файл не является DOCX.');
        state.documents.push({id:uuid(),name:file.name,kind,bytes,pages:null,placements:[],assets:{},history:[[]],historyIndex:0,error:null});
      } catch(error) {failures.push(`${file.name}: ${userMessage(error,'Не удалось прочитать файл.')}`);}
    }
  } finally {busy(false);}
  if (!state.activeId&&state.documents.length) await selectDocument(state.documents[0].id);
  if (failures.length) status(failures.join(' · '),'error');
}
async function removeDocument(id) {
  if (state.busy) return;
  const removed=state.documents.find(x=>x.id===id);state.documents=state.documents.filter(x=>x.id!==id);
  busy(true);try {await removed?.pdf?.destroy();} finally {busy(false);}
  if (state.activeId===id) {state.activeId=null;state.selectedId=null;state.placing=false;if (state.documents.length) await selectDocument(state.documents[0].id);else {$('paper').hidden=true;$('empty-state').hidden=false;redraw();}}
  renderDocuments();update();
}
function placeAt(x,y) {
  const current=doc(),asset=signature(),page=current?.pages?.[state.page];if (!current||!asset||!page||state.busy) return;
  if (current.placements.length>=LIMITS.placements) {status('В одном документе можно разместить до 200 подписей.','error');return;}
  let millimeters=Number($('signature-width').value),angle=Number($('signature-angle').value);if (!Number.isFinite(millimeters)||!Number.isFinite(angle)) {status('Укажите числовые ширину и поворот.','error');return;}
  millimeters=clamp(millimeters,5,180);angle=clamp(angle,-180,180);
  const width=mmToPt(millimeters)/page.width,height=mmToPt(millimeters)*asset.height/asset.width/page.height;
  const item=keepWithinPage({id:uuid(),page:state.page,signatureId:asset.id,x:x-width/2,y:y-height/2,width,height,angle},page);
  current.assets[asset.id]=asset;current.placements.push(item);state.selectedId=item.id;state.placing=false;commit();redraw();status('Подпись добавлена. Перетащите её или измените размер.');
}
$('overlay').addEventListener('pointerdown',event=>{
  if (state.busy||!doc()?.pages) return;
  const bounds=$('overlay').getBoundingClientRect(),point={x:(event.clientX-bounds.left)/bounds.width,y:(event.clientY-bounds.top)/bounds.height};
  const box=event.target.closest('[data-placement]');
  if (state.placing) {event.preventDefault();placeAt(point.x,point.y);return;}
  if (!box) {state.selectedId=null;redraw();return;}
  event.preventDefault();state.selectedId=box.dataset.placement;
  const item=selected();gesture={pointer:event.pointerId,item,start:point,before:clone(item),resize:Boolean(event.target.closest('[data-resize]')),bounds};
  $('overlay').setPointerCapture(event.pointerId);redraw();
});
$('overlay').addEventListener('pointermove',event=>{
  if (!gesture||event.pointerId!==gesture.pointer) return;
  event.preventDefault();const g=gesture,dx=(event.clientX-g.bounds.left)/g.bounds.width-g.start.x,dy=(event.clientY-g.bounds.top)/g.bounds.height-g.start.y,page=doc().pages[state.page];
  if (g.resize) {
    const angle=g.before.angle*Math.PI/180,along=dx*page.width*Math.cos(angle)+dy*page.height*Math.sin(angle);
    const ratio=clamp(1+along/(g.before.width*page.width),mmToPt(5)/(g.before.width*page.width),mmToPt(180)/(g.before.width*page.width));
    const width=g.before.width*ratio,height=g.before.height*ratio;
    g.item.x=g.before.x+(g.before.width-width)/2;g.item.y=g.before.y+(g.before.height-height)/2;g.item.width=width;g.item.height=height;
  } else {g.item.x=g.before.x+dx;g.item.y=g.before.y+dy;}
  keepWithinPage(g.item,page);redraw();
});
function endGesture(event) {if (!gesture||event.pointerId!==gesture.pointer) return;gesture=null;commit();redraw();}
$('overlay').addEventListener('pointerup',endGesture);$('overlay').addEventListener('pointercancel',endGesture);
function removePlacement() {const current=doc();if (!selected()||state.busy) return;current.placements=current.placements.filter(x=>x.id!==state.selectedId);state.selectedId=null;commit();redraw();}
$('remove-placement').onclick=removePlacement;
$('duplicate-placement').onclick=()=>{const current=doc(),sel=selected();if (!sel||state.busy) return;if (current.placements.length>=LIMITS.placements) {status('Достигнут лимит подписей.','error');return;}const item=keepWithinPage({...sel,id:uuid(),x:sel.x+0.02,y:sel.y+0.02},current.pages[state.page]);current.placements.push(item);state.selectedId=item.id;commit();redraw();};
for (const id of ['signature-width','signature-angle']) $(id).onchange=()=>{
  const item=selected(),page=doc()?.pages?.[state.page];if (!item||!page||state.busy) return;
  const value=Number($(id).value);if (!Number.isFinite(value)) {update();return;}
  if (id==='signature-angle') item.angle=clamp(value,-180,180);
  else {const newWidth=mmToPt(clamp(value,5,180))/page.width,ratio=newWidth/item.width;item.x+=(item.width-newWidth)/2;item.y+=(item.height-item.height*ratio)/2;item.width=newWidth;item.height*=ratio;}
  keepWithinPage(item,page);commit();redraw();
};
function historyStep(delta) {const current=doc();if (!current||state.busy) return;const index=current.historyIndex+delta;if (index<0||index>=current.history.length) return;current.historyIndex=index;current.placements=clone(current.history[index]);state.selectedId=null;redraw();renderDocuments();}
$('undo').onclick=()=>historyStep(-1);$('redo').onclick=()=>historyStep(1);
document.addEventListener('keydown',event=>{
  if (state.busy||document.querySelector('dialog[open]')||event.target.closest('input,textarea,select')) return;
  if (event.key==='Escape') {state.placing=false;state.selectedId=null;redraw();return;}
  if ((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z') {event.preventDefault();historyStep(event.shiftKey?1:-1);return;}
  if (event.key==='Delete'||event.key==='Backspace') {if (selected()) {event.preventDefault();removePlacement();}return;}
  const item=selected(),directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},direction=directions[event.key];
  if (item&&direction) {event.preventDefault();const page=doc().pages[state.page],step=event.shiftKey?5:1;item.x+=mmToPt(direction[0]*step)/page.width;item.y+=mmToPt(direction[1]*step)/page.height;keepWithinPage(item,page);commit();redraw();}
});
async function changePage(index) {const current=doc();if (state.busy||!current?.pages) return;state.page=clamp(index,0,current.pages.length-1);busy(true);try {await renderPage();status(`Страница ${state.page+1} из ${current.pages.length}`);} catch(error) {status(error.message,'error');}finally {busy(false);}}
$('previous-page').onclick=()=>changePage(state.page-1);$('next-page').onclick=()=>changePage(state.page+1);$('page-number').onchange=()=>{const n=Number($('page-number').value);changePage(Number.isFinite(n)?Math.trunc(n)-1:state.page);};
async function zoom(value) {if (state.busy) return;state.zoom=clamp(value,0.5,2);update();if (!doc()?.pages) return;busy(true);try {const width=sizePaper();if (doc().kind==='pdf') await renderPdf(doc().pdf,state.page,$('pdf-canvas'),width);}catch(error){status(error.message,'error');}finally {busy(false);}}
$('zoom-in').onclick=()=>zoom(state.zoom+0.1);$('zoom-out').onclick=()=>zoom(state.zoom-0.1);$('zoom-fit').onclick=()=>zoom(1);
$('place-signature').onclick=()=>{if ($('place-signature').disabled) return;state.placing=!state.placing;state.selectedId=null;redraw();status(state.placing?'Нажмите на нужное место на странице.':'Размещение отменено.');};
function hydrated(current) {return {...current,placements:current.placements.map(item=>({...item,data:current.assets[item.signatureId].data}))};}
async function exportDocument(current,format) {
  if (current.kind==='docx'&&!['original','docx'].includes(format)&&frameDocumentId!==current.id) current.pages=await loadFrame(current);
  return convertDocument(hydrated(current),format,rasterWord,(page,total)=>status(`${current.name}: страница ${page} / ${total}…`));
}
async function exportFiles(all=false) {
  if (state.busy) return;const files=all?state.documents.filter(x=>x.placements.length):[doc()];if (!files.length||files.some(x=>!x?.placements.length)) return;
  const format=$('export-format').value,active=doc(),page=state.page,selection=state.selectedId;
  busy(true);status('Готовлю файлы для скачивания…');
  try {
    const results=[];let totalBytes=0;
    for (const current of files) for (const result of await exportDocument(current,format)) {
      totalBytes+=result.blob.size;if (totalBytes>EXPORT_LIMITS.bytes) throw new Error('Архив превышает 150 МБ. Скачивайте документы по одному.');results.push(result);
    }
    if (!all&&results.length===1) downloadBlob(results[0].blob,results[0].name);
    else {
      const zip=new JSZip(),used=new Set();
      for (const result of results) {let name=result.name,suffix=2;while (used.has(name)) name=result.name.replace(/\.(\w+)$/,` (${suffix++}).$1`);used.add(name);zip.file(name,result.blob);}
      downloadBlob(await zip.generateAsync({type:'blob',compression:'DEFLATE'}),all?'Документы с подписью.zip':signedName(files[0].name,'zip'));
    }
    status('Готово. Файлы переданы браузеру для скачивания.');
  } catch(error) {status(userMessage(error,'Не удалось сохранить документы. Попробуйте открыть файл заново.'),'error');}
  finally {
    try {
      if (active?.kind==='docx'&&frameDocumentId!==active.id) active.pages=await loadFrame(active);
      state.page=page;sizePaper();state.selectedId=selection;redraw();
    } catch(error) {status(userMessage(error,'Не удалось восстановить предпросмотр. Откройте документ заново.'),'error');}
    busy(false);
  }
}
$('export-format').onchange=update;
$('download-current').onclick=()=>exportFiles();$('download-all').onclick=()=>exportFiles(true);
$('documents-input').onchange=event=>{const files=[...event.target.files];event.target.value='';addDocuments(files);};
const drop=$('drop-zone');drop.onkeydown=event=>{if (event.key==='Enter'||event.key===' ') {event.preventDefault();if (!state.busy) $('documents-input').click();}};
for (const name of ['dragenter','dragover']) drop.addEventListener(name,event=>{event.preventDefault();if (!state.busy) drop.classList.add('dragging');});
for (const name of ['dragleave','drop']) drop.addEventListener(name,event=>{event.preventDefault();drop.classList.remove('dragging');});drop.addEventListener('drop',event=>addDocuments([...event.dataTransfer.files]));
window.addEventListener('dragover',event=>event.preventDefault());window.addEventListener('drop',event=>event.preventDefault());
$('remember-signatures').onchange=()=>{state.remember=$('remember-signatures').checked;remember();status(state.remember?'Подписи сохранены только в этом браузере.':'Сохранение отключено. Подписи останутся до закрытия страницы.');};
$('forget-signatures').onclick=()=>{if (state.busy) return;state.remember=false;state.signatures=[];state.signatureId=null;$('remember-signatures').checked=false;remember();renderSignatures();update();status('Сохранённые подписи удалены. Подписи в открытых документах можно убрать отдельно.');};
initSignatureEditor(asset=>{if (state.signatures.length>=LIMITS.signatures) {status('Можно хранить до 8 подписей. Удалите лишнюю.','error');return;}pngInfo(asset.data);const item={...asset,id:uuid()};state.signatures.push(item);state.signatureId=item.id;remember();renderSignatures();update();status('Подпись готова. Теперь разместите её в документе.');},()=>state.busy);
$('reset').onclick=()=>{if (!state.busy) $('confirm-dialog').showModal();};$('cancel-reset').onclick=()=>$('confirm-dialog').close();
$('confirm-reset').onclick=async()=>{$('confirm-dialog').close();if (state.busy) return;busy(true);try {for (const current of state.documents) await current.pdf?.destroy();state.documents=[];state.activeId=null;state.selectedId=null;state.placing=false;state.page=0;state.zoom=1;$('paper').hidden=true;$('empty-state').hidden=false;redraw();status('Текущая работа очищена.');}finally {busy(false);}};
new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if (!state.busy&&doc()?.pages) zoom(state.zoom);},200);}).observe($('viewer'));
window.addEventListener('beforeunload',event=>{if (state.documents.some(x=>x.placements.length)) {event.preventDefault();event.returnValue='';}});
restore();renderSignatures();renderDocuments();update();icons();
