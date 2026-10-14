/* Изолированный просмотр: текст документа не получает доступ к основному интерфейсу. */
(() => {
  const container=document.getElementById('document'),styles=document.getElementById('styles');
  let token='',pages=[],metadata=[],busy=false,shown=0,shownWidth=600;
  const send=message=>parent.postMessage({...message,token},'*');
  const show=(index,width)=>{
    if (!pages[index]) return;
    shown=index;shownWidth=width;
    const scale=width/(metadata[index].width/0.75);
    pages.forEach((page,i)=>{page.hidden=i!==index;page.style.transform=`scale(${scale})`;});
    container.style.height=`${metadata[index].height/0.75*scale}px`;
  };
  window.addEventListener('message',async event=>{
    if (event.source!==parent||!event.data||typeof event.data.type!=='string') return;
    const message=event.data;
    if (message.type==='ping') { parent.postMessage({type:'ready'},'*');return; }
    if (message.type==='show'&&message.token===token&&!busy) {show(message.page,message.width);return;}
    if (message.type==='raster'&&message.token===token&&!busy) {
      busy=true;const previous=shown,previousWidth=shownWidth;
      let canvas;
      try {
        const meta=metadata[message.page],page=pages[message.page];
        if (!meta||meta.overflow) throw new Error('Страница Word не укладывается в предпросмотр.');
        const width=meta.width/0.75,height=meta.height/0.75,scale=message.scale;
        if (!Number.isFinite(scale)||scale<=0||scale>4||width*height*scale*scale>5_000_000) throw new Error('Превышен размер картинки страницы.');
        show(message.page,width);
        await document.fonts.ready;
        await Promise.all([...page.querySelectorAll('img')].map(image=>image.decode()));
        // CSS шрифтов уже извлечён из DOCX и содержит data URL: сетевой загрузки нет.
        const fontEmbedCSS=[...styles.querySelectorAll('style')].map(style=>style.textContent).join('\n')||'/* Системные шрифты */';
        canvas=await htmlToImage.toCanvas(page,{pixelRatio:scale,width,height,backgroundColor:'#ffffff',fontEmbedCSS,style:{transform:'none',position:'relative',left:'0',top:'0'}});
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if (!blob) throw new Error('Не удалось создать картинку страницы Word.');
        const bytes=await blob.arrayBuffer();
        parent.postMessage({type:'raster-result',token,requestId:message.requestId,bytes},'*',[bytes]);
      } catch(error) {send({type:'raster-error',requestId:message.requestId,message:'Не удалось преобразовать страницу Word: '+(error.message||'ошибка рисования')});}
      finally {if (canvas) {canvas.width=1;canvas.height=1;}show(previous,previousWidth);busy=false;}
      return;
    }
    if (message.type!=='load'||busy||typeof message.token!=='string'||!(message.bytes instanceof ArrayBuffer)) return;
    busy=true;token=message.token;
    try {
      container.replaceChildren();styles.replaceChildren();
      await docx.renderAsync(message.bytes,container,styles,{className:'ssdocx',inWrapper:false,breakPages:true,ignoreLastRenderedPageBreak:false,useBase64URL:true,renderAltChunks:false,renderChanges:false,experimental:false});
      await document.fonts.ready;
      pages=[...container.querySelectorAll('section.ssdocx')];
      if (!pages.length||pages.length>100) throw new Error('Не удалось выделить страницы DOCX или их больше 100.');
      const occurrences=new Map();
      for (const page of pages) for (const bookmark of page.querySelectorAll('[id]')) if (bookmark.id.startsWith(message.prefix)) occurrences.set(bookmark.id,(occurrences.get(bookmark.id)||0)+1);
      metadata=pages.map(page=>{
        const bounds=page.getBoundingClientRect(),declared=parseFloat(getComputedStyle(page).minHeight)||bounds.height;
        const anchors=[];
        for (const marker of page.querySelectorAll('[id]')) {
          if (!marker.id.startsWith(message.prefix)||occurrences.get(marker.id)!==1) continue;
          const paragraph=marker.closest('p');
          if (!paragraph||paragraph.closest('header,footer')) continue;
          const index=Number(marker.id.slice(message.prefix.length));
          if (Number.isInteger(index)) anchors.push({index,y:(paragraph.getBoundingClientRect().top-bounds.top)/bounds.height});
        }
        return {width:bounds.width*0.75,height:declared*0.75,anchors,overflow:bounds.height>declared+3||page.scrollHeight>declared+3};
      });
      send({type:'loaded',pages:metadata});show(0,message.width);
    } catch(error) { send({type:'error',message:error.message||'Ошибка просмотра Word.'}); }
    finally {busy=false;}
  });
  parent.postMessage({type:'ready'},'*');
})();
