/* Avalia TG v4 · Ata. Original wording adapted from AndreaInfUFSM/andreainfufsm.github.io, avaliatcc/atacc and atasi. */
(() => {
  'use strict';
  const form = document.querySelector('#ataForm');
  const status = document.querySelector('#status');
  const viewer = document.querySelector('#pdfViewer');
  const canvasStates = new Map();
  const token = new URLSearchParams(location.hash.slice(1)).get('t') || new URLSearchParams(location.search).get('t');
  const config = window.AVALIA_CONFIG || {};
  const managed = !!token;
  let invitationValid = false, sent = false, pending = false;
  const courseForm = () => text('curso')==='Ciência da Computação'?'CC-ATA':'SI-ATA';
  async function api(action,payload) {
    if(!config.managedEndpoint)throw Error('O endereço do serviço não foi configurado.');
    const result=await fetch(config.managedEndpoint,{method:'POST',credentials:'omit',redirect:'follow',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({action,...payload})});
    if(!result.ok)throw Error('Serviço indisponível (HTTP '+result.status+').');
    return await result.json();
  }
  function busy(on){pending=on;const btn=document.querySelector('#sendAta');if(btn)btn.disabled=on||sent||!invitationValid;}
  async function validateToken(){
    if(!managed)return;
    const btn=document.querySelector('#sendAta');btn.hidden=false;btn.disabled=true;
    setStatus('Conferindo convite...');
    try{
      const expected=courseForm();const reply=await api('validate',{token,form:expected});
      if(reply.status==='already_received'){sent=true;setStatus('Esta ata já foi recebida. Recibo: '+reply.receipt);return;}
      if(reply.status!=='valid')throw Error(reply.message||'Convite não disponível para esta ata.');
      invitationValid=true;
      const data={nomeAluno:reply.studentName, data:reply.date, hora:reply.time};
      for(const [key,value] of Object.entries(data)){
        if(!value)continue;
        if(key==='data'){const match=String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(match)$(key).value=`${match[3]}-${match[2]}-${match[1]}`;}
        else $(key).value=value;
      }
      // The invitation's evaluator may be one of the committee members.
      if(reply.professorName && !text('nomeAvaliador1'))$('nomeAvaliador1').value=reply.professorName;
      $('curso').disabled=true;
      btn.disabled=false;
      setStatus('Convite válido. As quatro assinaturas são recomendadas; a falta de alguma exige confirmação antes do envio.');
    }catch(err){setStatus('Não foi possível validar o convite: '+err.message,true);}
  }
  let previewUrl = '';
  const templateURL = 'https://andreainfufsm.github.io/avaliatcc/atacc/aaa.png';
  const fields = ['tituloTrabalho','nomeAluno','nomeProfessor','nomeAvaliador1','nomeAvaliador2','curso','notaFinal','data','hora','sala','dataFim'];
  const $ = (name) => form.elements.namedItem(name);
  const setStatus = (message,error=false) => { status.textContent=message;status.dataset.error=String(error); };
  const text = (name) => String($(name)?.value || '').trim();
  const dateLong = (iso) => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!parts) throw Error('Informe uma data válida.');
    const [year,month,day] = parts.slice(1).map(Number);
    const d = new Date(Date.UTC(year,month-1,day));
    if(d.getUTCFullYear()!==year || d.getUTCMonth()+1!==month || d.getUTCDate()!==day) throw Error('Informe uma data válida.');
    const months=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    return `${day} de ${months[month-1]} de ${year}`;
  };
  function grade() {
    const raw=text('notaFinal').replace(',','.');
    if(!raw) return '';
    if(!/^\d{1,2}(\.\d{1,2})?$/.test(raw))throw Error('A nota final deve ser um número de 0 a 10 (até duas casas decimais).');
    const num=Number(raw);
    if(num<0||num>10)throw Error('A nota final deve estar entre 0 e 10.');
    return num.toFixed(2).replace('.',',');
  }
  function updateCourse() {
    const hint=$('notaFinal').nextElementSibling;
    const cc=text('curso')==='Ciência da Computação';
    $('notaFinal').required=!cc;
    hint.textContent=cc?'Para CC, a nota pode permanecer em branco, conforme a ata anterior.':'Para SI, informe a nota final antes de gerar o documento.';
  }
  function loadParams() {
    const params=new URLSearchParams(location.search);
    for(const key of fields){if(params.has(key))$(key).value=params.get(key);}
    updateCourse();
  }
  function getData(){
    if(!form.checkValidity()){form.reportValidity();throw Error('Preencha os campos obrigatórios antes de gerar o PDF.');}
    const d=Object.fromEntries(fields.map(key=>[key,text(key)]));
    d.notaFinal=grade();
    d.dataLong=dateLong(d.data);d.fimLong=dateLong(d.dataFim);
    return d;
  }
  function initSignature(box) {
    const canvas=box.querySelector('canvas'), ctx=canvas.getContext('2d'), upload=box.querySelector('input[type=file]'), hint=box.querySelector('.sign-hint');
    const state={canvas,ctx,data:null,active:false,strokes:0,source:'draw'};
    const resize=()=>{ // Preserve drawings across resize; the canvas uses a fixed drawing resolution.
      const ratio=window.devicePixelRatio||1;
      const old=state.strokes?canvas.toDataURL('image/png'):null;
      canvas.width=Math.max(320,Math.round(canvas.clientWidth*ratio)); canvas.height=Math.round(canvas.clientHeight*ratio);
      ctx.strokeStyle='#182238';ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=Math.max(2,2*ratio);
      if(old){const image=new Image();image.onload=()=>ctx.drawImage(image,0,0,canvas.width,canvas.height);image.src=old;}
    };
    resize();
    window.addEventListener('resize',()=>{ if(state.source!=='file') resize(); });
    function point(ev){const r=canvas.getBoundingClientRect();return {x:(ev.clientX-r.left)*canvas.width/r.width,y:(ev.clientY-r.top)*canvas.height/r.height};}
    canvas.addEventListener('pointerdown',ev=>{ev.preventDefault();canvas.setPointerCapture(ev.pointerId);const p=point(ev);state.active=true;state.source='draw';state.data=null;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+.05,p.y+.05);ctx.stroke();state.strokes++;hint.textContent='Assinatura desenhada';});
    canvas.addEventListener('pointermove',ev=>{if(!state.active)return;ev.preventDefault();const p=point(ev);ctx.lineTo(p.x,p.y);ctx.stroke();});
    const stop=()=>{state.active=false;ctx.beginPath();};
    canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('lostpointercapture',stop);
    upload.addEventListener('change',()=>{
      const file=upload.files?.[0];if(!file)return;
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2_000_000){setStatus('Selecione uma imagem PNG, JPG ou WEBP de até 2 MB.',true);upload.value='';return;}
      const reader=new FileReader();reader.onload=()=>{
        const img=new Image();img.onload=()=>{
          ctx.clearRect(0,0,canvas.width,canvas.height);
          const scale=Math.min(canvas.width/img.width,canvas.height/img.height);
          ctx.drawImage(img,(canvas.width-img.width*scale)/2,(canvas.height-img.height*scale)/2,img.width*scale,img.height*scale);
          state.data=canvas.toDataURL('image/png');state.source='file';state.strokes=1;hint.textContent=file.name;setStatus('');
        };img.onerror=()=>setStatus('Não foi possível carregar a assinatura.',true);img.src=reader.result;
      };reader.readAsDataURL(file);
    });
    box.querySelector('.clear').addEventListener('click',()=>{ctx.clearRect(0,0,canvas.width,canvas.height);state.data=null;state.strokes=0;state.source='draw';upload.value='';hint.textContent='Sem assinatura';});
    canvasStates.set(box.dataset.role,state);
  }
  function signature(role){const state=canvasStates.get(role);return state?.strokes ? (state.source==='file'?state.data:state.canvas.toDataURL('image/png')) : null;}
  const roles={orientador:'Orientador(a)',avaliador1:'Avaliador(a) 1',avaliador2:'Avaliador(a) 2',estudante:'Estudante'};
  function confirmMissingSignatures(){
    const missing=Object.keys(roles).filter(role=>!signature(role));
    if(!missing.length)return true;
    return window.confirm('ASSINATURAS AUSENTES\n\nAs assinaturas são importantes e normalmente exigidas para a documentação oficial.\n\nFaltam: '+missing.map(role=>roles[role]).join(', ')+'.\n\nDeseja continuar e gerar/enviar a ata SEM essas assinaturas? Ela poderá precisar ser assinada posteriormente.\n\nCancelar = voltar ao formulário.\nOK = continuar sem essas assinaturas.');
  }

  function getText(d){
    const cc=d.curso==='Ciência da Computação';
    const score=cc ? `O(a) acadêmico(a) recebeu a nota final ${d.notaFinal || '_____'}, calculada posteriormente após conferência das fichas de avaliação.` : `O(a) acadêmico(a) recebeu a nota final ${d.notaFinal}.`;
    return `Aos ${d.dataLong}, às ${d.hora}, na sala ${d.sala}, realizou-se o Exame da Defesa do Trabalho de Conclusão de Curso intitulado: ${d.tituloTrabalho}, de autoria de ${d.nomeAluno}, acadêmico(a) do Curso de Graduação em ${d.curso} da UFSM.\n\nA Banca Examinadora esteve constituída por ${d.nomeProfessor}, professor(a) orientador(a) do Trabalho de Conclusão de Curso, e por ${d.nomeAvaliador1} e ${d.nomeAvaliador2}, membros avaliadores. ${score} Foi concedido até a data de ${d.fimLong} para o(a) acadêmico(a) realizar as alterações sugeridas pela Banca Examinadora e entregar o trabalho em sua redação definitiva. E, para constar, foi lavrada a presente Ata, que será assinada pelos membros da Banca Examinadora e pelo(a) acadêmico(a).`;
  }
  let backgroundPromise;
  async function getBackground(){
    if(!backgroundPromise)backgroundPromise=(async()=>{
      try{const response=await fetch(templateURL,{credentials:'omit',mode:'cors'});if(!response.ok)throw Error('HTTP '+response.status);
        const blob=await response.blob();return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
      }catch(err){console.warn('Background unavailable',err);return null;}
    })();
    return backgroundPromise;
  }
  async function renderPDF(d){
    if(!window.jspdf?.jsPDF)throw Error('Biblioteca PDF não carregada. Verifique a conexão à internet.');
    const doc=new window.jspdf.jsPDF({unit:'mm',format:'a4'});
    const backdrop=await getBackground();
    if(backdrop){doc.addImage(backdrop,'PNG',0,0,210,297);}
    else { // A readable fallback when the historic background cannot be fetched.
      doc.setFont('times','bold');doc.setFontSize(11);doc.text('UNIVERSIDADE FEDERAL DE SANTA MARIA',105,28,{align:'center'});
      doc.setFontSize(13);doc.text('ATA DE APRESENTAÇÃO DE TRABALHO DE CONCLUSÃO DE CURSO',105,42,{align:'center',maxWidth:175});
      doc.setDrawColor(80);doc.line(20,48,190,48);
    }
    const body=getText(d);
    // The historic template dedicates y=90..185 to the body; shrink font if necessary.
    let font=11.5,lines;
    do{doc.setFont('times','normal');doc.setFontSize(font);doc.setLineHeightFactor(1.35);lines=doc.splitTextToSize(body,169);if(lines.length*font*0.3528*1.35<=91)break;font-=.5;}while(font>=8.5);
    if(lines.length*font*0.3528*1.35>91)throw Error('O texto ficou longo demais para uma página. Reduza o título ou o local e tente novamente.');
    doc.text(lines,20,90);
    doc.setFontSize(11.5);doc.setFont('times','normal');doc.text(`Santa Maria, RS, ${d.dataLong}.`,114,191);
    const positions=[['orientador',30,207],['avaliador1',30,232],['avaliador2',121,207],['estudante',121,232]];
    for(const [role,x,y] of positions){const src=signature(role);if(src)doc.addImage(src,'PNG',x,y,48,18);}
    return doc;
  }
  async function act(kind){
    try{
      const d=getData();if(kind==='download'&&!confirmMissingSignatures())return;
      setStatus('Preparando PDF...');const pdf=await renderPDF(d);
      const filename=`ata-${d.curso==='Ciência da Computação'?'cc':'si'}-${d.nomeAluno.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()}.pdf`;
      if(kind==='download'){pdf.save(filename);setStatus('PDF gerado. Confira o arquivo antes de encaminhá-lo.');return;}
      if(previewUrl)URL.revokeObjectURL(previewUrl);
      previewUrl=URL.createObjectURL(pdf.output('blob'));viewer.src=previewUrl;viewer.hidden=false;setStatus('Prévia gerada. Confira o documento antes de baixar.');viewer.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(err){setStatus(err.message||'Não foi possível gerar o PDF.',true);}
  }
  async function submitAta(){
    if(!managed||!invitationValid||sent||pending)return;
    try{getData();}catch(err){setStatus(err.message,true);return;}
    if(!confirmMissingSignatures())return;
    busy(true);
    try{
      const data=getData();const doc=await renderPDF(data);
      const raw=doc.output('datauristring').split(',')[1];
      if(!raw || raw.length>Math.ceil(5*1024*1024*4/3))throw Error('PDF acima do limite de 5 MB.');
      const res=await api('submit',{token,form:courseForm(),pdf:raw});
      if(!['received','already_received'].includes(res.status))throw Error(res.message||'Envio não confirmado.');
      sent=true;setStatus('Ata recebida no Drive. Recibo: '+res.receipt);
      const btn=document.querySelector('#sendAta');btn.textContent='Ata recebida';
    }catch(err){setStatus('Não foi possível confirmar o envio. O convite continua válido até a confirmação. '+err.message,true);}
    finally{busy(false);}
  }
  $('curso').addEventListener('change',updateCourse);
  document.querySelectorAll('.sign-box').forEach(initSignature);
  document.querySelector('#preview').addEventListener('click',()=>act('preview'));
  document.querySelector('#download').addEventListener('click',()=>act('download'));
  document.querySelector('#sendAta').addEventListener('click',submitAta);
  document.querySelector('#copyLink').addEventListener('click',async()=>{
    try{
      const url=new URL(location.href);url.hash='';url.search='';
      for(const key of fields){const val=text(key);if(val)url.searchParams.set(key,val);}
      await navigator.clipboard.writeText(url.href);setStatus('Link copiado. Ele contém os dados do trabalho, mas não as assinaturas.');
    }catch(err){setStatus('Não foi possível copiar automaticamente. Use um navegador com acesso à área de transferência.',true);}
  });
  form.addEventListener('reset',()=>{setTimeout(()=>{document.querySelectorAll('.sign-box .clear').forEach(b=>b.click());viewer.hidden=true;viewer.removeAttribute('src');if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';setStatus('');updateCourse();},0);});
  loadParams();
  validateToken();
  window.addEventListener('pagehide',()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);});
})();
