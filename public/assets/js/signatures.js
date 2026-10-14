import {$,LIMITS,clamp,status,userMessage} from './core.js';

function trimmedCanvas(source) {
  const context=source.getContext('2d',{willReadFrequently:true}),pixels=context.getImageData(0,0,source.width,source.height);
  let left=source.width,top=source.height,right=-1,bottom=-1,count=0;
  for (let y=0;y<source.height;y++) for (let x=0;x<source.width;x++) {
    if (pixels.data[(y*source.width+x)*4+3]>40) {left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);count++;}
  }
  if (count<25||right-left<8||bottom-top<2) return null;
  const padding=5,output=document.createElement('canvas');
  left=Math.max(0,left-padding);top=Math.max(0,top-padding);right=Math.min(source.width-1,right+padding);bottom=Math.min(source.height-1,bottom+padding);
  output.width=right-left+1;output.height=bottom-top+1;
  output.getContext('2d').drawImage(source,left,top,output.width,output.height,0,0,output.width,output.height);
  return output;
}

export function initSignatureEditor(onSave,isBusy=()=>false) {
  let mode='photo',source=null,crop=null,prepared=null,drag=null,drawing=false,dirty=false,timer=null;
  const photo=$('photo-canvas'),draw=$('draw-canvas'),preview=$('signature-preview');
  function refreshPreview() {
    clearTimeout(timer);
    const output=document.createElement('canvas');
    if (mode==='draw') {output.width=draw.width;output.height=draw.height;output.getContext('2d').drawImage(draw,0,0);}
    else {
      if (!source) return;
      const area=crop||{x:0,y:0,width:source.width,height:source.height};
      output.width=Math.max(1,Math.round(area.width));output.height=Math.max(1,Math.round(area.height));
      const context=output.getContext('2d',{willReadFrequently:true});
      context.drawImage(source,area.x,area.y,area.width,area.height,0,0,output.width,output.height);
      const pixels=context.getImageData(0,0,output.width,output.height),threshold=Number($('background-threshold').value);
      for (let i=0;i<pixels.data.length;i+=4) {
        const r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2],max=Math.max(r,g,b),min=Math.min(r,g,b);
        const color=clamp((max-min-22)/40,0,1)*clamp((248-max)/25,0,1);
        const dark=clamp((threshold-max)/45,0,1);
        pixels.data[i+3]=Math.round(pixels.data[i+3]*Math.max(color,dark));
      }
      context.putImageData(pixels,0,0);
    }
    prepared=trimmedCanvas(output);
    preview.hidden=!prepared;
    if (prepared) preview.src=prepared.toDataURL('image/png'); else preview.removeAttribute('src');
    $('save-signature').disabled=!prepared;
    $('signature-error').textContent=prepared?'':'Подпись пока не видна. Нарисуйте её или измените выделение и удаление фона.';
  }
  function setMode(value) {
    mode=value;prepared=null;crop=null;drag=null;source=null;dirty=false;
    $('signature-error').textContent='';$('crop-box').hidden=true;preview.hidden=true;preview.removeAttribute('src');
    $('photo-tools').hidden=value!=='photo';$('draw-tools').hidden=value!=='draw';
    $('signature-dialog-title').textContent=value==='photo'?'Подпись из фотографии':'Нарисовать подпись';
    $('signature-dialog').showModal();
  }
  const close=()=>{$('signature-dialog').close();clearTimeout(timer);source=null;prepared=null;drag=null;drawing=false;};
  $('close-dialog').onclick=close;$('cancel-signature').onclick=close;
  $('signature-dialog').addEventListener('close',()=>{source=null;prepared=null;drag=null;drawing=false;clearTimeout(timer);});
  $('upload-signature').onclick=()=>{if (!isBusy()) $('signature-input').click();};
  $('signature-input').onchange=async event=>{
    const file=event.target.files[0];event.target.value='';if (!file||isBusy()) return;
    try {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Загрузите фотографию JPG, PNG или WebP.');
      if (file.size>LIMITS.imageBytes) throw new Error('Фотография должна быть не больше 15 МБ.');
      const image=await createImageBitmap(file);
      try {
        if (image.width*image.height>LIMITS.imagePixels) throw new Error('Фотография слишком большая: поддерживается до 20 мегапикселей.');
        setMode('photo');$('background-threshold').value='150';
        const scale=Math.min(1,1600/Math.max(image.width,image.height));source=document.createElement('canvas');
        source.width=Math.round(image.width*scale);source.height=Math.round(image.height*scale);source.getContext('2d').drawImage(image,0,0,source.width,source.height);
        renderPhoto();refreshPreview();
      } finally {image.close();}
    } catch(error) {status(userMessage(error,'Не удалось прочитать фотографию. Выберите другой JPG, PNG или WebP.'),'error');}
  };
  function renderPhoto() {
    const maxWidth=Math.max(100,$('signature-dialog').clientWidth-48),scale=Math.min(maxWidth/source.width,300/source.height,1);
    photo.width=source.width;photo.height=source.height;photo.style.width=`${source.width*scale}px`;photo.style.height=`${source.height*scale}px`;
    photo.getContext('2d').drawImage(source,0,0);$('crop-box').hidden=true;
  }
  function point(event,canvas) {const rect=canvas.getBoundingClientRect();return {x:clamp((event.clientX-rect.left)/rect.width,0,1)*canvas.width,y:clamp((event.clientY-rect.top)/rect.height,0,1)*canvas.height};}
  photo.addEventListener('pointerdown',event=>{if (!source) return;event.preventDefault();drag=point(event,photo);photo.setPointerCapture(event.pointerId);});
  photo.addEventListener('pointermove',event=>{
    if (!drag) return;
    const end=point(event,photo);crop={x:Math.min(drag.x,end.x),y:Math.min(drag.y,end.y),width:Math.abs(end.x-drag.x),height:Math.abs(end.y-drag.y)};
    const box=$('crop-box'),canvasRect=photo.getBoundingClientRect(),areaRect=photo.parentElement.getBoundingClientRect();
    box.hidden=false;box.style.left=`${canvasRect.left-areaRect.left+crop.x/photo.width*canvasRect.width}px`;box.style.top=`${canvasRect.top-areaRect.top+crop.y/photo.height*canvasRect.height}px`;box.style.width=`${crop.width/photo.width*canvasRect.width}px`;box.style.height=`${crop.height/photo.height*canvasRect.height}px`;
  });
  const endCrop=()=>{if (!drag) return;drag=null;if (!crop||crop.width<10||crop.height<10) {crop=null;$('crop-box').hidden=true;}refreshPreview();};
  photo.addEventListener('pointerup',endCrop);photo.addEventListener('pointercancel',endCrop);
  $('reset-crop').onclick=()=>{crop=null;$('crop-box').hidden=true;refreshPreview();};
  $('background-threshold').oninput=()=>{clearTimeout(timer);timer=setTimeout(refreshPreview,80);};
  $('rotate-photo').onclick=()=>{if (!source) return;const next=document.createElement('canvas');next.width=source.height;next.height=source.width;const ctx=next.getContext('2d');ctx.translate(next.width,0);ctx.rotate(Math.PI/2);ctx.drawImage(source,0,0);source=next;crop=null;renderPhoto();refreshPreview();};
  $('draw-signature').onclick=()=>{if (isBusy()) return;setMode('draw');draw.getContext('2d').clearRect(0,0,draw.width,draw.height);refreshPreview();};
  draw.addEventListener('pointerdown',event=>{
    event.preventDefault();drawing=true;dirty=true;draw.setPointerCapture(event.pointerId);const p=point(event,draw),ctx=draw.getContext('2d');
    ctx.strokeStyle=$('ink-color').value;ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=Number($('ink-width').value)*draw.width/draw.clientWidth;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.arc(p.x,p.y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(p.x,p.y);
  });
  draw.addEventListener('pointermove',event=>{if (!drawing) return;event.preventDefault();const p=point(event,draw),ctx=draw.getContext('2d');ctx.lineTo(p.x,p.y);ctx.stroke();});
  const endDraw=()=>{if (!drawing) return;drawing=false;refreshPreview();};draw.addEventListener('pointerup',endDraw);draw.addEventListener('pointercancel',endDraw);
  $('clear-drawing').onclick=()=>{draw.getContext('2d').clearRect(0,0,draw.width,draw.height);dirty=false;refreshPreview();};
  $('save-signature').onclick=()=>{if (!prepared) return;try {const signature={data:prepared.toDataURL('image/png'),width:prepared.width,height:prepared.height};onSave(signature);close();}catch(error){$('signature-error').textContent=userMessage(error,'Подпись слишком большая. Выделите её меньшим прямоугольником.');}};
  return {close};
}
