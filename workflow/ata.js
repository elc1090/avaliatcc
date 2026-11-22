/* v5: text-first ata; native PDF document, never a full-page raster template. */
(() => {
 'use strict';
 const form=document.querySelector('#ataForm');if(!form)return;
 const $=id=>document.getElementById(id), config=window.AVALIA_CONFIG||{};
 const query=new URLSearchParams(location.search), token=new URLSearchParams(location.hash.slice(1)).get('t')||query.get('t');
 const managed=Boolean(token);let valid=false,sent=false,busy=false,blob=null,revision=0,renderedAt=-1,blobUrl='',gradePrefill=null,formChangedSinceText=false;
 const fields=['title','studentName','course','date','time','defenseMode','location','outcome','deadline'];
 const text=id=>String($(id).value||'').trim();
 function status(msg,err=false){$('ataStatus').textContent=msg;$('ataStatus').dataset.error=String(err);}
 function pad(n){return String(n).padStart(2,'0');}
 function isoDate(value){const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value));return match?`${match[3]}-${match[2]}-${match[1]}`:String(value||'');}
 function longDate(value){const m=/^(\d{4})-(\d\d)-(\d\d)$/.exec(value);if(!m)return '[data]';const [,y,mo,d]=m;const months=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];return `${Number(d)} de ${months[Number(mo)-1]} de ${y}`;}
 function setExaminers(list){const target=$('examiners');target.replaceChildren();for(const person of list)addExaminer(person.name||person);}
 function addExaminer(name=''){
  const target = $('examiners');
  const n = target.children.length;
  if(n>=10)return;
  const row=document.createElement('div');row.className='examiner-row';
  const label=document.createElement('label');label.textContent=n?'Membro examinador '+(n+1):'Avaliador 1 · orientador(a) e presidente';
  const input=document.createElement('input');input.className='examiner-name';input.required=true;input.value=name;input.placeholder='Nome completo';label.append(input);row.append(label);
  if(n){const remove=document.createElement('button');remove.type='button';remove.className='quiet';remove.textContent='Remover';remove.onclick=()=>{row.remove();relabel();invalidate();};row.append(remove);}
  target.append(row);invalidate();
 }
 function relabel(){[...document.querySelectorAll('.examiner-row label')].forEach((l,i)=>l.firstChild.textContent=i?'Membro examinador '+(i+1):'Avaliador 1 · orientador(a) e presidente');}
 function examiners(){return [...document.querySelectorAll('.examiner-name')].map(el=>el.value.trim()).filter(Boolean);}
 function invalidate(){revision++;blob=null;renderedAt=-1;if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl='';$('pdfViewer').hidden=true;}
 function available(){return !busy&&!sent;}
 async function api(action,data){if(!config.managedEndpoint)throw Error('Serviço não configurado.');
  const c=new AbortController(), timer=setTimeout(()=>c.abort(),action==='validate'?20000:110000);
  try{const res=await fetch(config.managedEndpoint,{method:'POST',credentials:'omit',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({action,...data}),signal:c.signal});if(!res.ok)throw Error('HTTP '+res.status);return await res.json();}finally{clearTimeout(timer);}
 }
 async function load(){
  for(const id of fields)if(query.has(id))$(id).value=query.get(id);
 if(query.has('curso'))$('course').value=query.get('curso');
  if(!managed){if(!examiners().length)setExaminers([{name:''},{name:''},{name:''}]);return;}
  $('sendAta').hidden=false;window.AvaliaDialog.progress('Carregando ata','Consultando as informações do convite…');
  try{
   const res=await api('validate',{token,form:text('course')==='Sistemas de Informação'?'SI-ATA':'CC-ATA'});
   if(res.status==='already_received'){sent=true;status('Esta ata já foi recebida. Recibo: '+res.receipt);return;}
   if(res.status!=='valid')throw Error(res.message||'Convite indisponível.');
   valid=true;
   const map={studentName:res.studentName,course:res.course,title:res.title,time:res.time,defenseMode:res.defenseMode,location:res.location};
   for(const [id,value] of Object.entries(map))if(value)$(id).value=value;
   for(const [id,value] of [['date',res.date],['deadline',res.deadline]])if(value)$(id).value=isoDate(value);
   setExaminers(res.examiners?.length?res.examiners:[{name:res.professorName}]);
   if(typeof res.grade==='number'&&res.gradeComplete)gradePrefill=res.grade;
   $('sendAta').disabled=false;
   status(gradePrefill===null?'Convite válido. A nota ainda não está consolidada; edite o texto para informá-la.':'Convite válido. Nota consolidada disponível para inclusão no texto.');
  }catch(e){status('Não foi possível carregar o convite: '+e.message,true);}
  finally{window.AvaliaDialog.close();}
 }
 function formatGrade(g){return Number(g).toFixed(2).replace('.',',');}
 function narrative(){
  if(!form.checkValidity()){form.reportValidity();throw Error('Preencha os dados do formulário.');}
  const d=text('date'),hour=text('time').replace(/:00$/,'h').replace(':','h'),place=text('defenseMode')==='Videoconferência'?`por videoconferência, na plataforma ${text('location')}`:`presencialmente, na sala ${text('location')}`;
  const grade=gradePrefill===null?'[informar nota]':formatGrade(gradePrefill);
  const outcome=text('outcome');
  const paragraphs=[`Em ${longDate(d)}, às ${hour}, ${place}, realizou-se a defesa do Trabalho de Conclusão de Curso intitulado “${text('title')}”, de autoria de ${text('studentName')}, acadêmico(a) do curso de ${text('course')} da UFSM.`,
   `A banca examinadora foi composta pelo(a) presidente da banca, orientador(a) do trabalho, e pelos membros examinadores listados ao final desta ata. Concluídos os trabalhos de apresentação e arguição, o(a) acadêmico(a) foi considerado(a) ${outcome} pela banca examinadora, com nota final ${grade}, de acordo com as fichas de avaliação encaminhadas pelos membros da banca ao(à) orientador(a).`];
  if(outcome==='aprovado(a)')paragraphs.push(`Foi concedido ao(à) acadêmico(a) prazo até ${text('deadline')?longDate(text('deadline')):'[data final prevista no calendário]'} para realizar as alterações sugeridas pela banca e entregar a versão definitiva do trabalho.`);
  paragraphs.push('E, para constar, foi lavrada a presente ata, que será assinada pelo(a) orientador(a) e pelo(a) acadêmico(a) no sistema PEN-SIE.');
  return paragraphs.join('\n\n');
 }
 function generateText(){try{if($('narrative').value.trim()){
   window.AvaliaDialog.confirm('Substituir texto editado?','A geração substituirá as alterações feitas manualmente no texto da ata.','Substituir texto','Manter edição').then(ok=>{if(ok){$('narrative').value=narrative();formChangedSinceText=false;invalidate();}});
  }else{$('narrative').value=narrative();formChangedSinceText=false;invalidate();status('Texto gerado. Revise e edite livremente.');}}
  catch(e){status(e.message,true);}}
 async function checkFreshText(){return !formChangedSinceText||await window.AvaliaDialog.confirm('Dados alterados após gerar o texto','Algum campo do formulário foi modificado depois da última geração do texto. Verifique se a redação ainda corresponde aos dados. Deseja continuar?', 'Continuar com texto revisado', 'Voltar e revisar');}
 function pdfDefinition(){
  if(!form.checkValidity()){form.reportValidity();throw Error('Preencha os dados para gerar o PDF.');}
  const body=$('narrative').value.trim();if(!body)throw Error('Gere ou escreva o texto da ata antes de continuar.');
  const names=examiners();if(!names.length)throw Error('Informe a banca examinadora.');
  const paras=body.split(/\n\s*\n/).map(p=>{
    const content=p.trim().split(/(“[^”]+”)/g).filter(Boolean).map(t=>t.startsWith('“')&&t.endsWith('”')?{text:t,italics:true}:{text:t});
    return {text:content,margin:[0,0,0,12],alignment:'justify'};
  });
  const members=names.map((name,i)=>({text:(i===0?'Presidente da banca e orientador(a): ':'Membro examinador: ')+name,margin:[0,0,0,6]}));
  return {pageSize:'A4',pageMargins:[60,66,60,60],defaultStyle:{font:'Roboto',fontSize:11.5,lineHeight:1.35,color:'#1b2632'},
    content:[{columns:[{width:'*',stack:[{text:'UNIVERSIDADE FEDERAL DE SANTA MARIA',fontSize:10,bold:true,color:'#164b70'},{text:'UFSM · Trabalho de Conclusão de Curso',fontSize:9,color:'#62727c'}]}],margin:[0,0,0,20]},
    {text:'ATA DE DEFESA DE TRABALHO DE CONCLUSÃO DE CURSO',fontSize:13,bold:true,alignment:'center',margin:[0,0,0,24]},
    ...paras,{text:'BANCA EXAMINADORA',fontSize:10,bold:true,margin:[0,16,0,12]},...members,
    {text:'Santa Maria, RS, '+longDate(text('date'))+'.',alignment:'right',margin:[0,24,0,0]}],
    info:{title:'Ata de defesa de TCC',author:'Universidade Federal de Santa Maria'}};
 }
 async function makeBlob(){if(blob&&renderedAt===revision)return blob;const definition=pdfDefinition();
  blob=await new Promise((resolve,reject)=>{try{window.pdfMake.createPdf(definition).getBlob(resolve);}catch(e){reject(e);}});
  if(blob.size>5*1024*1024)throw Error('PDF acima de 5 MB.');renderedAt=revision;return blob;
 }
 function downloadPdf(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 function fileName(){return 'ata-'+(text('course')==='Sistemas de Informação'?'si':'cc')+'-'+text('studentName').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()+'.pdf';}
 async function checkPlaceholders(){const s=$('narrative').value;return !/\[(?:informar nota|data final prevista no calendário|[^\]]+)\]/.test(s)||await window.AvaliaDialog.confirm('Texto incompleto','O texto ainda contém marcadores entre colchetes. Deseja continuar mesmo assim?','Continuar com marcadores','Revisar texto');}
 async function previewPdf(kind){if(!available()||!(await checkFreshText())||!(await checkPlaceholders()))return;
  try{window.AvaliaDialog.progress('Preparando documento','Gerando PDF…');const pdf=await makeBlob();window.AvaliaDialog.close();
   if(kind==='download')downloadPdf(pdf,fileName());else{if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl=URL.createObjectURL(pdf);$('pdfViewer').src=blobUrl;$('pdfViewer').hidden=false;}
   status('Documento pronto. Você pode baixar o PDF mesmo que a prévia não apareça neste navegador.');
  }catch(e){window.AvaliaDialog.result('Não foi possível gerar o PDF',e.message,false);status(e.message,true);}
 }
 async function submit(){if(!managed||!valid||!available()||!(await checkFreshText())||!(await checkPlaceholders()))return;
  busy=true;$('sendAta').disabled=true;window.AvaliaDialog.progress('Enviando ata','Gerando documento e enviando ao Drive. Não feche a página…');
  try{const pdf=await makeBlob();const pdf64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(pdf);});
   window.AvaliaDialog.update('Aguardando confirmação de recebimento pelo Drive…');
   const res=await api('submit',{token,form:text('course')==='Sistemas de Informação'?'SI-ATA':'CC-ATA',pdf:pdf64});
   if(!['received','already_received'].includes(res?.status))throw Error(res?.message||'Recebimento não confirmado.');
   sent=true;status('Ata recebida no Drive. O documento deverá ser assinado posteriormente no PEN-SIE. Recibo: '+res.receipt);
   window.AvaliaDialog.result('Ata recebida','PDF armazenado no Drive. Encaminhe-o para assinatura no PEN-SIE. Recibo: '+res.receipt);$('sendAta').textContent='Ata recebida';
  }catch(e){status('O recebimento não foi confirmado: '+e.message,true);window.AvaliaDialog.result('Recebimento não confirmado','Você pode tentar novamente. O envio não será duplicado se o Drive já tiver recebido o PDF. '+e.message,false);}
  finally{busy=false;$('sendAta').disabled=sent||!valid;}
 }
 $('addExaminer').addEventListener('click',()=>addExaminer(''));
 $('generateText').addEventListener('click',generateText);
 $('preview').addEventListener('click',()=>previewPdf('preview'));
 $('download').addEventListener('click',()=>previewPdf('download'));
 $('sendAta').addEventListener('click',submit);
 form.addEventListener('input',e=>{if(e.target.id!=='narrative'&&$('narrative').value.trim())formChangedSinceText=true;invalidate();});form.addEventListener('change',e=>{if(e.target.id!=='narrative'&&$('narrative').value.trim())formChangedSinceText=true;invalidate();});
 for(const id of fields)if(query.has(id))$(id).value=query.get(id);
 if(query.has('curso'))$('course').value=query.get('curso');
 if(query.has('examiners'))try{setExaminers(JSON.parse(query.get('examiners')));}catch{}
 if(!managed&&!examiners().length)setExaminers(['','','']);
 load();
})();
