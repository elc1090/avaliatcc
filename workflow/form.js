/* Shared controller. The original HTML, rubric labels, CSS and pdfMake
 * document definitions remain in their respective program folders. */
(() => {
  'use strict';
  const $id = id => document.getElementById(id);
  let boot = null;
  let managed = false;
  let invitation = false, integrated = false;
  const isPrevia = el => el.id.startsWith('previaRubric');
  const formCode = {'avaliatg-previa-cc':'CC-PREVIA','avaliatg-final-cc':'CC-FINAL','avaliatg-final-si':'SI-FINAL','avaliatg-integrada-cc':'CC-INTEGRADA'}[location.pathname.split('/').filter(Boolean).find(p=>p.startsWith('avaliatg-') && ['avaliatg-previa-cc','avaliatg-final-cc','avaliatg-final-si','avaliatg-integrada-cc'].includes(p))];
  const config = window.AVALIA_CONFIG || {};
  const metadata = ['studentName','professorName','period','date','time'];
  const maxPdf = 5 * 1024 * 1024;
  let form, sliders, status, review, frame, reviewDownload, sendBtn, primary, canvas, ctx, preview, signatureFile;
  let signatureType = '', signatureReady = false, signatureRead = 0, drawing = false, busy = false, consumed = false;
  let previousDisabled = new Map();
  let revision = 0, pdfBlob = null, pdfUrl = '', pdfName = '', integratedDocs = [], currentGrade=null; 
  const selected = new Set();

  // The original GeneratePDF.getData() uses a global signature object.
  // A transparent placeholder preserves the institutional PDF layout when the
  // evaluator explicitly chooses to proceed without a signature.
  const blankSignature = (()=>{const c=document.createElement('canvas');c.width=2;c.height=2;return c.toDataURL('image/png');})();
  function signed(){return (signatureType==='DRAW'&&hasInk())||(signatureType==='SELECT'&&signatureReady);}
  window.signature = {getSignatureImage: () => signed() ? (signatureType==='DRAW'?canvas.toDataURL('image/png'):preview.getAttribute('src')) : blankSignature};
  async function confirmUnsigned(){
    if(signed())return true;
    return await window.AvaliaDialog.confirm('Assinatura não informada',
      'A assinatura é importante para a documentação oficial. Deseja prosseguir sem assinar? O documento poderá precisar ser assinado posteriormente.',
      'Continuar sem assinatura','Voltar e assinar');
  }
  function text(id, value) { const el=$id(id); if(el) el.textContent=value; }
  function message(value, kind='info') { if(!status) return;status.textContent=value;status.dataset.kind=kind;const local=review?.querySelector('[data-status]');if(local){local.textContent=value;local.dataset.kind=kind;} }
  function error(id,value='') {text(id+'Error',value); const el=$id(id); if(el)el.setAttribute('aria-invalid',value?'true':'false');}
  function releasePdf() {
    if(pdfUrl)URL.revokeObjectURL(pdfUrl);pdfUrl='';pdfBlob=null;
    if(frame)frame.removeAttribute('src'); if(review)review.hidden=true; if(sendBtn)sendBtn.disabled=true;
  }
  function invalidate() { revision++; currentGrade=null; if(integrated){for(const doc of integratedDocs)if(doc.previewUrl)URL.revokeObjectURL(doc.previewUrl);integratedDocs=[];const panel=$id('integratedDownloads');if(panel){panel.hidden=true;panel.replaceChildren();}if(review)review.hidden=true;} if(!consumed&&pdfBlob){releasePdf();message('O formulário foi alterado. Gere um novo PDF para enviar.');} }
  function setBusy(value) {
    if(value && !busy){previousDisabled=new Map();form.querySelectorAll('input,button,textarea,select').forEach(el=>{previousDisabled.set(el,el.disabled);el.disabled=true;});}
    if(!value && busy){previousDisabled.forEach((was,el)=>{el.disabled=consumed&&el!==reviewDownload?true:was;});previousDisabled.clear();}
    busy=value; if(primary)primary.disabled=value||consumed;
    if(sendBtn)sendBtn.disabled=value||consumed||!(integrated?integratedDocs.length===2:pdfBlob);
    if(reviewDownload)reviewDownload.disabled=value;
    if(form)form.setAttribute('aria-busy',String(value));
  }
  function formatScore(x) {return Number(x).toFixed(1);}
  // Each rubric starts visually at 50%, but has no assigned grade until the
  // examiner deliberately interacts with the slider or an adjustment button.
  function updateTotal() {
    const score = group => group.reduce((sum,el)=>sum+(selected.has(el.id)?Math.round(Number(el.value)*10):0),0);
    const final=sliders.filter(el=>!isPrevia(el)), previa=sliders.filter(isPrevia);
    const finalScore=score(final),previaScore=score(previa);
    const count = group => group.filter(el=>selected.has(el.id)).length;
    const display = (group, points) => {
      const done=count(group);
      if(!done)return '—';
      return formatScore(points/10)+(done===group.length?'':` pontos atribuídos (${done}/${group.length})`);
    };
    text('finalValue',display(final,finalScore));
    if(integrated){
      text('previaValue',display(previa,previaScore));
      text('summaryPrevia',display(previa,previaScore));
      text('summaryFinal',display(final,finalScore));
      const complete= count(previa)===previa.length && count(final)===final.length;
      text('weightedValue',complete?((3*previaScore+7*finalScore)/100).toFixed(2):'—');
      text('weightedProgress',complete?'Avaliações completas.':'A nota final será exibida quando todos os critérios das duas avaliações estiverem preenchidos.');
    }
  }
  function choose(el) {
    if(consumed||busy)return;
    selected.add(el.id);
    const label=$id(el.id+'Value');
    if(label){label.textContent=formatScore(el.value);label.classList.add('rubric-assigned');}
    el.closest('.range-field')?.classList.remove('rubric-unanswered');
    el.setAttribute('aria-valuetext',formatScore(el.value)+' de '+formatScore(el.max));
    error(el.id);updateTotal();invalidate();
  }
  function midpoint(el){
    const min=Number(el.min)||0,max=Number(el.max)||10;
    const step=Number(el.step)||0.1;
    return Number((min+Math.round((max-min)/(2*step))*step).toFixed(4));
  }
  function resetRubric(el){
    el.value=String(midpoint(el));
    const label=$id(el.id+'Value');
    if(label){label.textContent='Não avaliado';label.classList.remove('rubric-assigned');}
    el.closest('.range-field')?.classList.add('rubric-unanswered');
    el.setAttribute('aria-valuetext','Não avaliado');
    error(el.id);
  }
  function installRubrics(){
    sliders.forEach(el=>{
      resetRubric(el);
      const wrapper=el.closest('.range-field');
      if(!wrapper)return;
      const adjustments=document.createElement('div');adjustments.className='rubric-adjust';
      const minus=document.createElement('button');minus.type='button';minus.className='rubric-step';minus.textContent='−';minus.setAttribute('aria-label','Diminuir nota em 0,1');
      const current=document.createElement('span');current.className='rubric-adjust-hint';current.textContent='Ajuste em passos de 0,1';
      const plus=document.createElement('button');plus.type='button';plus.className='rubric-step';plus.textContent='+';plus.setAttribute('aria-label','Aumentar nota em 0,1');
      for(const [button,direction] of [[minus,-1],[plus,1]])button.addEventListener('click',()=>{
        if(busy||consumed)return;
        const min=Math.round(Number(el.min)*10),max=Math.round(Number(el.max)*10);
        const next=Math.max(min,Math.min(max,Math.round(Number(el.value)*10)+direction));
        el.value=(next/10).toFixed(1);choose(el);
      });
      adjustments.append(minus,current,plus);
      const errorSpan=$id(el.id+'Error');
      if(errorSpan)errorSpan.before(adjustments);else wrapper.append(adjustments);
      el.addEventListener('input',()=>choose(el));
      el.addEventListener('change',()=>choose(el));
      // Clicking an unchanged midpoint is also a deliberate selection.
      el.addEventListener('pointerup',()=>choose(el));
      el.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();choose(el);}});
    });
    updateTotal();
  }
  function clearSignature() { ctx.clearRect(0,0,canvas.width,canvas.height);invalidate(); }
  function showType(type) {
    if(busy||consumed)return;
    signatureType=type; $id('signatureCanvasWrapper').style.display=type==='DRAW'?'block':'none';
    $id('signatureSelect').style.display=type==='SELECT'?'block':'none';
    error('signatureType');error('signatureCanvas');error('signatureField');invalidate();
  }
  window.showCanvas=()=>showType('DRAW');window.showSelect=()=>showType('SELECT');window.clearCanvas=clearSignature;
  function hasInk() {const d=ctx.getImageData(0,0,canvas.width,canvas.height).data;for(let i=3;i<d.length;i+=4)if(d[i])return true;return false;}
  function point(e) {const r=canvas.getBoundingClientRect(); return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
  function installSignature() {
    canvas=$id('signatureCanvas');ctx=canvas.getContext('2d');canvas.width=900;canvas.height=300;canvas.style.touchAction='none';
    preview=$id('signaturePreview');preview.alt='Prévia da assinatura';signatureFile=$id('signatureField');signatureFile.accept='image/png,image/jpeg,image/webp';
    let activePointer=null,last;
    canvas.addEventListener('pointerdown',e=>{if(busy||consumed||!e.isPrimary)return;e.preventDefault();activePointer=e.pointerId;canvas.setPointerCapture(e.pointerId);drawing=true;last=point(e);ctx.fillStyle='#000';ctx.beginPath();ctx.arc(last.x,last.y,2.3,0,2*Math.PI);ctx.fill();invalidate();error('signatureCanvas');});
    canvas.addEventListener('pointermove',e=>{if(!drawing||e.pointerId!==activePointer)return;e.preventDefault();const p=point(e);ctx.strokeStyle='#000';ctx.lineWidth=4.6;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p;});
    const stop=e=>{if(e.pointerId===activePointer){drawing=false;activePointer=null;}};
    ['pointerup','pointercancel','lostpointercapture'].forEach(n=>canvas.addEventListener(n,stop));
    form.querySelectorAll('input[name=signatureType]').forEach(el=>el.addEventListener('change',()=>showType(el.value)));
    signatureFile.addEventListener('change',async()=>{
      const seq=++signatureRead;signatureReady=false;preview.style.display='none';preview.removeAttribute('src');invalidate();error('signatureField');
      const file=signatureFile.files[0];if(!file)return;
      if(file.size>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type)){error('signatureField','Use PNG, JPEG ou WebP de até 10 MB.');signatureFile.value='';return;}
      const uri=URL.createObjectURL(file);
      try{const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=uri;});if(seq!==signatureRead)return;
        const scale=Math.min(1,1200/img.width,600/img.height);const tmp=document.createElement('canvas');tmp.width=Math.max(1,Math.round(img.width*scale));tmp.height=Math.max(1,Math.round(img.height*scale));tmp.getContext('2d').drawImage(img,0,0,tmp.width,tmp.height);
        preview.src=tmp.toDataURL('image/png');preview.style.display='inline-block';signatureReady=true;error('signatureField');invalidate();
      }catch(e){if(seq===signatureRead){signatureFile.value='';error('signatureField','Não foi possível ler a imagem.');}}
      finally{URL.revokeObjectURL(uri);}
    });
  }
  function populate(values,locked) {
    for(const name of metadata){const val=values[name];if(val==null||val==='')continue;
      if(name==='period'){form.querySelectorAll('input[name=period]').forEach(el=>{el.checked=el.value===String(val);if(locked)el.disabled=true;});}
      else{const el=$id(name);el.value=val;if(locked){el.readOnly=true;el.setAttribute('aria-readonly','true');}}
    }
    window.M?.updateTextFields();
  }
  function validDate(s){const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);if(!m)return false;const [d,mo,y]=m.slice(1).map(Number),v=new Date(Date.UTC(y,mo-1,d));return v.getUTCDate()===d&&v.getUTCMonth()===mo-1&&v.getUTCFullYear()===y;}
  function validate(target='both') {
    let first=null;const mark=(id,msg,el=$id(id))=>{error(id,msg);if(msg&&!first)first=el||form;};
    for(const name of ['studentName','professorName'])mark(name,$id(name).value.trim()?'':'Preencha este campo.');
    const period=form.querySelector('input[name=period]:checked');mark('period',period?'':'Selecione o semestre.',form.querySelector('input[name=period]'));
    if(!integrated||target!=='previa'){mark('date',validDate($id('date').value)?'':'Informe uma data válida (dd/mm/aaaa).');
    mark('time',/^([01]\d|2[0-3]):[0-5]\d$/.test($id('time').value)?'':'Informe um horário válido (hh:mm).');}
    if(integrated&&target!=='final'){mark('previaDate',validDate($id('previaDate').value)?'':'Informe uma data válida (dd/mm/aaaa).');mark('previaTime',/^([01]\d|2[0-3]):[0-5]\d$/.test($id('previaTime').value)?'':'Informe um horário válido (hh:mm).');}
    for(const el of sliders.filter(el=>!integrated||target==='both'||(target==='previa')===isPrevia(el)))mark(el.id,selected.has(el.id)&&Number.isFinite(Number(el.value))?'':'Selecione uma nota.');
    // Missing signatures are permitted only after explicit confirmation.
    // A selected but incomplete upload is also considered unsigned.
    error('signatureType');error('signatureCanvas');error('signatureField');
    if(first){message('Confira os campos indicados antes de gerar o PDF.','error');first.scrollIntoView({block:'center',behavior:'smooth'});first.focus?.({preventScroll:true});return false;}return true;
  }
  function filename(info, part){
    return window.AvaliaPdfFilename({...info, term:boot?.term, form:formCode},part);
  }
  function download(blob,name) { const uri=URL.createObjectURL(blob), a=document.createElement('a');a.href=uri;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(uri),30000); }
  async function standalone(blob,name){
    const file=new File([blob],name,{type:'application/pdf'});
    try{if(navigator.canShare?.({files:[file]})&&navigator.share){await navigator.share({title:'Ficha de avaliação de TG',files:[file]});return;}}catch(e){if(e.name==='AbortError')return;}
    download(blob,name);
  }
  function makeBlob(definition){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Tempo limite ao gerar PDF.')),30000);const done=b=>{clearTimeout(timer);resolve(b);};const fail=e=>{clearTimeout(timer);reject(e);};try{const result=pdfMake.createPdf(definition).getBlob(done);if(result&&typeof result.catch==='function')result.catch(fail);}catch(e){fail(e);}});}
  async function generate(e,target='both') {
    e.preventDefault();if(busy||consumed||!validate(target)||!(await confirmUnsigned()))return;
    if(managed&&integrated&&target!=='both'){message('Este convite exige as duas fichas. Use “Revisar as duas fichas”.','error');return;}
    releasePdf();for(const doc of integratedDocs)if(doc.previewUrl)URL.revokeObjectURL(doc.previewUrl);integratedDocs=[];setBusy(true);message('Gerando PDF…');const snapshot=revision;
    try {
      if(integrated){
        const types=target==='both'?['previa','final']:[target], docs=[];
        for(const type of types){const isP=type==='previa', group=sliders.filter(el=>isPrevia(el)===isP);
          const data={generalInformation:{studentName:$id('studentName').value,professorName:$id('professorName').value,period:form.querySelector('input[name=period]:checked').value,date:$id(isP?'previaDate':'date').value,time:$id(isP?'previaTime':'time').value},evaluation:{},signature:window.signature.getSignatureImage()};
          group.forEach((el,i)=>data.evaluation['presentationRubric'+(i+1)]=Number(el.value));data.evaluation.finalValue=group.reduce((sum,el)=>sum+Math.round(Number(el.value)*10),0)/10;
          const gen=isP?new GeneratePreviaPDF():new GeneratePDF();const blob=await makeBlob(gen.getDefinition(data));
          const name=filename(data.generalInformation,type);docs.push({blob,name,grade:data.evaluation.finalValue});}
        if(snapshot!==revision)return;
        const panel=$id('integratedDownloads');panel.replaceChildren();panel.hidden=false;
        for(const doc of docs){const link=document.createElement('button');link.type='button';link.className='btn-flat indigo-text';link.textContent='Baixar '+doc.name;link.addEventListener('click',()=>download(doc.blob,doc.name));panel.append(link);}
        if(managed){
          if(docs.some(doc=>doc.blob.size>maxPdf)){message('Uma das fichas excede 5 MB. Reduza a imagem da assinatura antes de enviar.','error');return;}
          integratedDocs=docs.map((doc,i)=>({...doc,part:['previa','final'][i]}));
          review.hidden=false;
          const previews=review.querySelector('[data-integrated-preview]');previews.replaceChildren();
          for(const doc of integratedDocs){const heading=document.createElement('h6');heading.textContent=doc.part==='previa'?'Ficha de andamento':'Ficha de defesa';
            const iframe=document.createElement('iframe');iframe.className='workflow-pdf';iframe.title='Prévia da '+heading.textContent;iframe.src=URL.createObjectURL(doc.blob);doc.previewUrl=iframe.src;const dl=document.createElement('button');dl.type='button';dl.className='btn-flat indigo-text';dl.textContent='Baixar PDF';dl.addEventListener('click',()=>download(doc.blob,doc.name));previews.append(heading,dl,iframe);}
          message('Duas fichas prontas. Confira os documentos e envie ambas.');review.scrollIntoView({block:'start',behavior:'smooth'});return;
        }
        if(docs.length===1)download(docs[0].blob,docs[0].name);
        else {for(const doc of docs)download(doc.blob,doc.name);}
        message(docs.length===2?'Duas fichas geradas. Se o navegador bloquear um download, use os botões em Resultado.':'Ficha gerada.');return;
      }
      const generator=new GeneratePDF();const data=generator.getData();
      const blob=await makeBlob(generator.getDefinition(data));
      if(snapshot!==revision){message('O formulário mudou. Gere o PDF novamente.','error');return;}
      const name=filename(data.generalInformation);
      if(!managed){await standalone(blob,name);message(invitation?'PDF gerado localmente. O envio direto não está disponível.':'PDF gerado.');return;}
      if(blob.size>maxPdf){download(blob,name);message('O PDF excede 5 MB e não pode ser enviado. Reduza a imagem da assinatura.','error');return;}
      pdfBlob=blob;pdfName=name;currentGrade=Number(data.evaluation.finalValue);pdfUrl=URL.createObjectURL(blob);frame.src=pdfUrl;review.hidden=false;message('PDF pronto. Confira os dados e envie a avaliação.');review.scrollIntoView({block:'start',behavior:'smooth'});
    }catch(err){console.error(err);message('Não foi possível gerar o PDF. Confira a assinatura e tente novamente.','error');}
    finally{setBusy(false);}
  }
  function toBase64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(new Error('Falha na leitura do PDF.'));r.readAsDataURL(blob);});}
  async function api(payload){
    if(!config.managedEndpoint)throw new Error('Serviço de envio não configurado.');
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),payload.action==='validate'?15000:90000);
    try{const response=await fetch(config.managedEndpoint,{method:'POST',credentials:'omit',redirect:'follow',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(payload),signal:controller.signal});
      if(!response.ok)throw new Error('HTTP '+response.status);return await response.json();
    }finally{clearTimeout(timer);}
  }
  function submitRemote(payload){return api({...payload,action:'submit',form:formCode});}
  async function send() {
    if(busy||consumed||!(integrated?integratedDocs.length===2:pdfBlob)||!(await confirmUnsigned()))return;
    setBusy(true);message(integrated?'Enviando as duas fichas…':'Enviando PDF…');window.AvaliaDialog.progress('Enviando ao Drive','Mantenha esta página aberta até a confirmação.');const blob=pdfBlob;
    if(integrated){
      try{
        let finalReceipt='';
        for(const doc of integratedDocs){
          message('Enviando ficha de '+(doc.part==='previa'?'andamento':'defesa')+'…');window.AvaliaDialog.update('Enviando ficha de '+(doc.part==='previa'?'andamento':'defesa')+'…');
          const response=await submitRemote({token:boot.token,part:doc.part,pdf:await toBase64(doc.blob),grade:doc.grade});
          if(!['part_received','received','already_received'].includes(response?.status))throw new Error(response?.message||'Resposta não confirmada.');
          finalReceipt=response.receipt;
          if(response.status==='already_received'){consumed=true;message('Convite já utilizado. Recibo: '+response.receipt,'success');window.AvaliaDialog.result('Convite já utilizado','Arquivos recebidos anteriormente. Recibo: '+response.receipt);return;}
          if(doc.part==='final'&&response.status!=='received')throw new Error('A conclusão dos dois arquivos não foi confirmada.');
        }
        consumed=true;sendBtn.textContent='Duas fichas recebidas';message('As duas avaliações foram recebidas. Recibo: '+finalReceipt,'success');window.AvaliaDialog.result('Duas fichas recebidas','Os dois PDFs foram armazenados no Drive. Recibo: '+finalReceipt);
      }catch(e){message('Envio não confirmado: '+(e?.message||'')+' Clique em “Enviar as duas fichas” novamente para retomar; arquivos já recebidos não serão duplicados.','error');window.AvaliaDialog.result('Recebimento não confirmado','Você pode tentar novamente. Os arquivos recebidos não serão duplicados. '+(e?.message||''),false);}
      finally{setBusy(false);}return;
    }
    try{const result=await submitRemote({token:boot.token,pdf:await toBase64(blob),grade:currentGrade});if(!['received','already_received'].includes(result?.status))throw new Error('Resposta não confirmada.');
      consumed=true;form.querySelectorAll('input,button,textarea').forEach(el=>{if(el!==reviewDownload)el.disabled=true;});
      window.AvaliaDialog.result('Avaliação recebida','O PDF foi armazenado no Drive. Recibo: '+result.receipt);if(sendBtn)sendBtn.textContent='Avaliação recebida';if(result.status==='already_received'&&reviewDownload)reviewDownload.textContent='Baixar PDF local (não enviado)';message((result.status==='received'?'Avaliação recebida com sucesso.':'Este convite já foi utilizado. A avaliação anteriormente recebida foi preservada.')+' Recibo: '+result.receipt,'success');
    }catch(e){message('O recebimento não foi confirmado. '+(e?.message||'')+' Você pode tentar novamente ou baixar uma cópia.','error');window.AvaliaDialog.result('Recebimento não confirmado','Você pode tentar novamente ou baixar uma cópia. '+(e?.message||''),false);}
    finally{setBusy(false);}
  }
  async function copyLink(){
    if(invitation)return;const url=new URL(location.href);url.search='';url.hash='';for(const name of metadata){const val=name==='period'?form.querySelector('input[name=period]:checked')?.value:$id(name).value;if(val)url.searchParams.set(name,val);}
    try{await navigator.clipboard.writeText(url.href);message('Link copiado para a área de transferência.');}catch(e){window.prompt('Copie o link:',url.href);}
  }
  window.copyLink=copyLink;
  function defaultReset(e){if(busy||consumed){e.preventDefault();return;}setTimeout(()=>{selected.clear();sliders.forEach(resetRubric);updateTotal();signatureRead++;signatureReady=false;signatureType='';clearSignature();preview.removeAttribute('src');preview.style.display='none';$id('signatureCanvasWrapper').style.display='none';$id('signatureSelect').style.display='none';form.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));form.querySelectorAll('[id$=Error]').forEach(el=>el.textContent='');releasePdf();if(managed)populate(boot,true);message(managed?'Preencha os critérios. A assinatura é recomendada; sua ausência exige confirmação.':invitation?'Envio direto indisponível. Gere e baixe o PDF para encaminhar à orientação.':'');M.updateTextFields();},0);}
  function installReview(){
    review=document.createElement('section');review.className='card card-panel workflow-review';review.hidden=true;
    review.innerHTML='<h5 class="bold">Conferir ficha de avaliação</h5><p>O PDF abaixo é o documento que será enviado. Se a prévia não aparecer no seu navegador, baixe uma cópia para conferir. O convite só permite um envio bem-sucedido.</p><div class="workflow-status" data-status role="status" aria-live="polite"></div><iframe title="Prévia do PDF" class="workflow-pdf"></iframe><div class="workflow-actions"><button type="button" class="btn-flat indigo-text" data-download>Baixar PDF</button><button type="button" class="btn indigo darken-4" data-send>Enviar avaliação</button></div>';
    if(integrated){review.querySelector('h5').textContent='Conferir as duas fichas';review.querySelector('p').textContent='Confira as fichas de andamento e defesa antes do envio. O convite será concluído somente após os dois PDFs serem recebidos.';
      review.querySelector('iframe').remove();const container=document.createElement('div');container.dataset.integratedPreview='';review.querySelector('.workflow-status').after(container);
      review.querySelector('[data-download]').remove();review.querySelector('[data-send]').textContent='Enviar as duas fichas';}
    const footer=$id('footer');if(footer)footer.after(review);else form.append(review);frame=review.querySelector('iframe');sendBtn=review.querySelector('[data-send]');reviewDownload=review.querySelector('[data-download]');sendBtn.addEventListener('click',send);if(reviewDownload)reviewDownload.addEventListener('click',()=>{if(pdfBlob)download(pdfBlob,pdfName);});
  }
  async function init(){
    form=$id('evaluationForm');if(!form)return;integrated=form.dataset.integrated==='true';
    const incoming=new URLSearchParams(location.search);const token=new URLSearchParams(location.hash.slice(1)).get('t')||incoming.get('t')||incoming.get('token');
    invitation=Boolean(token);
    sliders=Array.from(form.querySelectorAll('input[type=range]'));primary=form.querySelector('button[type=submit]');
    status=document.createElement('div');status.className='workflow-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');form.prepend(status);
    if(!window.M||!window.jQuery||!window.pdfMake||typeof GeneratePDF==='undefined'||(integrated&&typeof GeneratePreviaPDF==='undefined')){message('Não foi possível carregar as bibliotecas necessárias. Recarregue a página.','error');primary.disabled=true;return;}
    const jq=window.jQuery;
    if(invitation){
      message('Verificando convite…');window.AvaliaDialog.progress('Carregando convite','Consultando os dados da avaliação…');primary.disabled=true;
      try{const result=await api({action:'validate',token,form:formCode});
        if(result.status==='valid'){boot={...result,token};managed=true;}
        else if(['invalid','expired','already_received','wrong_form'].includes(result.status)){
          message(result.message||(result.status==='already_received'?'Avaliação já recebida. Recibo: '+result.receipt:'Convite indisponível.'),'error');
          window.AvaliaDialog.close();Array.from(form.children).forEach(el=>{if(el!==status)el.hidden=true;});return;
        }else throw new Error('Resposta não confirmada.');
      }catch(e){message('Não foi possível verificar o convite. Você pode preencher e baixar o PDF normalmente e encaminhá-lo à orientação. Para tentar o envio direto, recarregue a página.','error');}
    }
    if(invitation)window.AvaliaDialog.close();
    if(!managed){jq('.datepicker').datepicker({format:'dd/mm/yyyy',autoClose:true,i18n:{cancel:'Cancelar',clear:'Limpar',done:'Ok',months:['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],monthsShort:['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'],weekdays:['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'],weekdaysShort:['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'],weekdaysAbbrev:['D','S','T','Q','Q','S','S']}});jq('.timepicker').timepicker({twelveHour:false,autoClose:true,i18n:{cancel:'Cancelar',clear:'Limpar',done:'Ok'}});populate(Object.fromEntries(metadata.map(n=>[n,incoming.get(n)])),false);}
    else{populate(boot,true);if(integrated){if(boot.previaDate)$id('previaDate').value=boot.previaDate;if(boot.previaTime)$id('previaTime').value=boot.previaTime;}if(integrated){jq('.datepicker').datepicker({format:'dd/mm/yyyy',autoClose:true});jq('.timepicker').timepicker({twelveHour:false,autoClose:true});}primary.textContent=integrated?'Revisar as duas fichas':'Revisar PDF';form.querySelectorAll('button[onclick*="copyLink"]').forEach(el=>{el.hidden=true;el.style.display='none';});installReview();if(integrated)form.querySelectorAll('[data-generate]').forEach(el=>{el.hidden=true;el.style.display='none';});message(integrated?'Convite integrado · preencha as duas avaliações e revise os dois PDFs antes do envio.':'Convite individual · confira os dados e preencha a avaliação. O envio pode ser feito uma única vez.');}
    if(invitation)form.querySelectorAll('button[onclick*="copyLink"]').forEach(el=>el.style.display='none');
    installSignature();
    installRubrics();
    form.addEventListener('input',e=>{if(!sliders.includes(e.target)){invalidate();if(e.target.id)error(e.target.id);}});
    form.addEventListener('change',e=>{if(!sliders.includes(e.target))invalidate();});
    form.addEventListener('submit',e=>generate(e));form.querySelectorAll('[data-generate]').forEach(el=>el.addEventListener('click',e=>generate(e,el.dataset.generate)));form.addEventListener('reset',defaultReset);primary.disabled=false;
    if(!invitation){const nav=document.createElement('a');nav.className='workflow-back';nav.href='../index.html';nav.textContent='← Todos os formulários';form.parentElement.prepend(nav);}
  }
  document.addEventListener('DOMContentLoaded',init);
})();
