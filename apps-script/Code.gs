/** Avalia TG — spreadsheet-bound collection service. Deploy as owner. */
const SHEET = 'Convites';
const SESSION_SHEET = 'Bancas';
const SESSION_COL = ['TCC_ID','Período','Modalidade','Estudante','Título do trabalho','Curso','Semestre','Data andamento','Hora andamento','Data defesa','Hora defesa','Formato defesa','Sala ou plataforma','Prazo versão final','Avaliador 1','E-mail 1','Avaliador 2','E-mail 2','Avaliador 3','E-mail 3','Avaliador 4','E-mail 4','Avaliador 5','E-mail 5','Validade (dias)','Resultado'];
const MODES = ['CC-INTEGRADA','CC-SEPARADAS','SI-FINAL'];
const EVALUATION_FORMS = ['CC-PREVIA','CC-FINAL','CC-INTEGRADA','SI-FINAL'];
const COL = ['TCC_ID','Período','Formulário','Estudante','Avaliador','E-mail','Semestre','Data','Horário','Validade (dias)','Status','Convite','Recebido em','PDF','ID convite','Hash token','Expira em','ID arquivo','ID pasta','Dados fixos','SHA256 PDF','Recibo','Emitido em','Nota andamento','Nota defesa','Nota avaliador'];
const C = Object.fromEntries(COL.map((v,i)=>[v,i]));
const FORMS = {
  'CC-PREVIA': {template:'FormCCPrevia', label:'CC · Avaliação de andamento'},
  'CC-FINAL': {template:'FormCCFinal', label:'CC · Avaliação de defesa'},
  'CC-INTEGRADA': {template:null, label:'CC · Avaliação integrada'},
  'SI-FINAL': {template:'FormSIFinal', label:'SI · Avaliação de defesa'},
  'CC-ATA': {template:null, label:'CC · Ata de defesa'},
  'SI-ATA': {template:null, label:'SI · Ata de defesa'}
};
const PATHS = {'CC-PREVIA':'avaliatg-previa-cc/','CC-FINAL':'avaliatg-final-cc/','CC-INTEGRADA':'avaliatg-integrada-cc/','SI-FINAL':'avaliatg-final-si/','CC-ATA':'ata/?curso=Ci%C3%AAncia+da+Computa%C3%A7%C3%A3o','SI-ATA':'ata/?curso=Sistemas+de+Informa%C3%A7%C3%A3o'};
const MAX_BYTES = 5 * 1024 * 1024;
const PROPS = PropertiesService.getScriptProperties();
const STATUS = {PENDING:'PENDENTE', RECEIVED:'RECEBIDO', REVOKED:'REVOGADO'};

function onOpen() {
  const menu=SpreadsheetApp.getUi().createMenu('Avalia TG')
    .addItem('1. Configurar planilha e pasta', 'configureWorkflow')
    .addItem('RECRIAR Bancas e Convites (APAGA TESTES)', 'resetWorkflowV5')
    .addItem('Atualizar resumo das notas', 'refreshGrades')
    .addItem('2. Gerar convites das bancas selecionadas', 'issueFromSessions')
    .addItem('Gerar somente andamento (CC separadas)', 'issueProgressOnly')
    .addItem('Gerar somente defesa (CC separadas)', 'issueDefenseOnly')
    .addItem('Gerar convites nas linhas selecionadas (manual)', 'issueSelected')
    .addItem('Revogar convites selecionados', 'revokeSelected')
    .addItem('Migrar links pendentes para GitHub Pages', 'migrateInvitationLinks')
    .addItem('Reconciliar recebimentos', 'reconcileSubmissions');
  if(typeof draftForSecretary==='function')menu.addSeparator().addItem('Criar rascunho para secretaria (TCC e formulário)', 'draftForSecretary');
  menu.addToUi();
}

// All menu actions verify the owner explicitly. Public web app executes as owner,
// so checking only getEffectiveUser() would authorize anonymous visitors!
function admin_() {
  const active = Session.getActiveUser().getEmail();
  const effective = Session.getEffectiveUser().getEmail();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bound = PROPS.getProperty('SPREADSHEET_ID');
  if (!active || !effective || active.toLowerCase() !== effective.toLowerCase() || !ss || (bound && ss.getId() !== bound)) {
    throw new Error('Ação restrita ao proprietário na planilha vinculada.');
  }
  return ss;
}
/** Destructive setup is NEVER invoked implicitly by configuration. */
function resetWorkflowV5(){
  const ss=admin_(),ui=SpreadsheetApp.getUi();
  const yes=ui.alert('RECRIAR DADOS DE TESTE',
    'Esta operação APAGA todas as linhas de Bancas, Convites e Notas, inclusive convites ainda válidos. Os PDFs existentes no Drive NÃO serão excluídos. Continuar?',
    ui.ButtonSet.YES_NO);
  if(yes!==ui.Button.YES)return;
  const check=ui.prompt('Confirmação', 'Digite RECRIAR para confirmar a exclusão das abas:',ui.ButtonSet.OK_CANCEL);
  if(check.getSelectedButton()!==ui.Button.OK||check.getResponseText()!=='RECRIAR')return;
  const tmp=ss.insertSheet('_v5_reset_temporario');
  try{for(const name of [SHEET,SESSION_SHEET,'Notas']){const sh=ss.getSheetByName(name);if(sh)ss.deleteSheet(sh);}
    configureWorkflow();
  }finally{ss.deleteSheet(tmp);}
}
function configureWorkflow() {
  const ss = admin_(); const ui = SpreadsheetApp.getUi();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) sh = ss.insertSheet(SHEET);
  if(sh.getMaxColumns()<COL.length)sh.insertColumnsAfter(sh.getMaxColumns(),COL.length-sh.getMaxColumns());
  if (sh.getLastRow() && JSON.stringify(sh.getRange(1,1,1,COL.length).getValues()[0]) !== JSON.stringify(COL)) {
    throw new Error('A aba Convites já existe com outro cabeçalho. Renomeie-a antes de configurar.');
  }
  sh.getRange(1,1,1,COL.length).setValues([COL]).setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.getRange('A:A').setNumberFormat('@'); sh.getRange('B:B').setNumberFormat('@');
  sh.getRange('H:H').setNumberFormat('dd/mm/yyyy'); sh.getRange('I:I').setNumberFormat('hh:mm');
  sh.getRange('M:M').setNumberFormat('dd/mm/yyyy hh:mm:ss'); sh.getRange('Q:Q').setNumberFormat('dd/mm/yyyy hh:mm:ss');
  sh.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(Object.keys(FORMS),true).setAllowInvalid(false).build());
  sh.getRange('G2:G').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['1','2'],true).setAllowInvalid(false).build());
  sh.setColumnWidth(4,240); sh.setColumnWidth(5,240); sh.setColumnWidth(6,220); sh.setColumnWidth(12,280); sh.setColumnWidth(14,240);
  sh.hideColumns(15,9);sh.showColumns(17);
  sh.getRange(1,COL.length-2,1,3).setBackground('#087e8b').setFontColor('white');
  const grades=ss.getSheetByName('Notas')||ss.insertSheet('Notas');
  const gh=['TCC_ID','Período','Estudante','Curso','Avaliadores esperados','Notas completas','Média final','Situação'];
  grades.getRange(1,1,1,gh.length).setValues([gh]).setFontWeight('bold').setBackground('#087e8b').setFontColor('white');grades.setFrozenRows(1);grades.setColumnWidths(1,8,165);
  const statusRange=sh.getRange('K2:K');
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(STATUS.RECEIVED).setBackground('#e1f2e6').setFontColor('#236a39').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(STATUS.PENDING).setBackground('#fff1d4').setFontColor('#875a0a').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(STATUS.REVOKED).setBackground('#eceff1').setFontColor('#546e7a').setRanges([statusRange]).build()
  ]);
  configureSessions_(ss);
  PROPS.setProperty('SPREADSHEET_ID',ss.getId());
  let rootId = PROPS.getProperty('ROOT_FOLDER_ID');
  if (!rootId) {
    rootId = DriveApp.createFolder('Avalia TG — documentos recebidos').getId();
    PROPS.setProperty('ROOT_FOLDER_ID',rootId);
  }
  ui.alert('Configuração concluída. A pasta privada foi criada no seu Drive. Implante o web app, preencha uma linha por banca na aba Bancas e use Gerar convites das bancas selecionadas.');
}
function configureSessions_(ss) {
  let sh=ss.getSheetByName(SESSION_SHEET);if(!sh)sh=ss.insertSheet(SESSION_SHEET);
  if(sh.getMaxColumns()<SESSION_COL.length)sh.insertColumnsAfter(sh.getMaxColumns(),SESSION_COL.length-sh.getMaxColumns());
  if(sh.getLastRow()&&JSON.stringify(sh.getRange(1,1,1,SESSION_COL.length).getValues()[0])!==JSON.stringify(SESSION_COL))throw new Error('A aba Bancas já existe com outro cabeçalho. Renomeie-a antes de configurar.');
  sh.getRange(1,1,1,SESSION_COL.length).setValues([SESSION_COL]).setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');sh.setFrozenRows(1);
  sh.getRange('A:B').setNumberFormat('@');sh.getRange('F:F').setNumberFormat('dd/mm/yyyy');sh.getRange('G:G').setNumberFormat('hh:mm');
  sh.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(MODES,true).setAllowInvalid(false).build());
  sh.getRange('G2:G').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['1','2'],true).setAllowInvalid(false).build());
  sh.getRange('L2:L').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Presencial','Videoconferência'],true).setAllowInvalid(false).build());
  for(const col of [8,10,14])sh.getRange(2,col,sh.getMaxRows()-1,1).setNumberFormat('dd/mm/yyyy');
  for(const col of [9,11])sh.getRange(2,col,sh.getMaxRows()-1,1).setNumberFormat('hh:mm');
  [4,5,6,13,15,17,19,21,23].forEach(n=>sh.setColumnWidth(n,230));sh.setColumnWidth(26,350);
}
function sheet_() {
  const id=PROPS.getProperty('SPREADSHEET_ID'); if(!id) throw new Error('Serviço ainda não configurado.');
  const sh=SpreadsheetApp.openById(id).getSheetByName(SHEET);
  if(!sh || JSON.stringify(sh.getRange(1,1,1,COL.length).getValues()[0])!==JSON.stringify(COL)) throw new Error('Cabeçalho da planilha inválido.');
  return sh;
}
function rows_(sh) { return sh.getLastRow()<2 ? [] : sh.getRange(2,1,sh.getLastRow()-1,COL.length).getValues(); }
function put_(sh,n,row) { sh.getRange(n,1,1,COL.length).setValues([row]); SpreadsheetApp.flush(); }
function hash_(data) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,data).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join(''); }
function token_() { return (Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,'').toLowerCase(); }
function validToken_(t) { return typeof t==='string' && /^[a-f0-9]{64}$/.test(t); }
function safeName_(s) { return String(s).normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\s+/g,' ').trim().slice(0,100) || 'sem-nome'; }
function text_(v) { return String(v==null?'':v).trim(); }
function metadata_(row,display) {
  const m={tccId:text_(row[C.TCC_ID]),term:text_(row[C['Período']]),form:text_(row[C['Formulário']]),studentName:text_(row[C.Estudante]),professorName:text_(row[C.Avaliador]),email:text_(row[C['E-mail']]),period:text_(row[C.Semestre]),date:text_(display[C.Data]),time:text_(display[C['Horário']])};
  if(!m.tccId||!m.term||!Object.prototype.hasOwnProperty.call(FORMS,m.form)||!m.studentName||!m.professorName||!['1','2'].includes(m.period)||!/^\d{2}\/\d{2}\/\d{4}$/.test(m.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time)) throw new Error('Preencha TCC_ID, período, formulário, estudante, avaliador, semestre, data (dd/mm/aaaa) e horário (hh:mm).');
  if(!/^\d{4}-[12]$/.test(m.term) || m.term.slice(-1)!==m.period) throw new Error('Período deve ser AAAA-1 ou AAAA-2 e corresponder ao semestre.');
  if(m.date.slice(-4)!==m.term.slice(0,4)) throw new Error('Ano da data deve corresponder ao período.');
  const [d,mo,y]=m.date.split('/').map(Number), date=new Date(Date.UTC(y,mo-1,d));
  if(date.getUTCDate()!==d||date.getUTCMonth()!==mo-1||date.getUTCFullYear()!==y) throw new Error('Data inexistente.');
  if(m.studentName.length>180||m.professorName.length>180||m.tccId.length>80) throw new Error('Identificação demasiado longa.');
  return m;
}
function getFolder_(parent,name) {
  const it=parent.getFoldersByName(name); if(it.hasNext()) {const f=it.next();if(it.hasNext()) throw new Error('Pastas duplicadas: '+name);return f;} return parent.createFolder(name);
}
function withLock_(fn) { const lock=LockService.getScriptLock(); lock.waitLock(25000); try{return fn();}finally{lock.releaseLock();} }
function selected_(ss) {
  const sh=ss.getActiveSheet(); if(sh.getName()!==SHEET) throw new Error('Selecione linhas na aba Convites.');
  const range=sh.getActiveRange(); if(!range||range.getLastRow()<2) throw new Error('Selecione uma ou mais linhas de dados.');
  return {sh,first:Math.max(2,range.getRow()),last:Math.min(sh.getLastRow(),range.getLastRow())};
}
function issueSelected() {
  const ss=admin_();const {sh,first,last}=selected_(ss);
  const url=deploymentUrl_();
  const results=withLock_(()=>issueRows_(sh,Array.from({length:Math.max(0,last-first+1)},(_,i)=>first+i),url));
  SpreadsheetApp.getUi().alert(results.join('\n')||'Nenhuma linha selecionada.');
}
function deploymentUrl_(){
  const url=PROPS.getProperty('PUBLIC_BASE_URL');
  if(!url||!/^https:\/\/[^?#\s]+\/$/.test(url))throw new Error('Configure PUBLIC_BASE_URL nas propriedades do script (URL GitHub Pages com barra final).');
  return url;
}
function migrateInvitationLinks(){
  admin_();const base=deploymentUrl_(),sh=sheet_();let count=0;
  withLock_(()=>rows_(sh).forEach((r,i)=>{
    if(r[C.Status]!==STATUS.PENDING)return;
    const t=String(r[C.Convite]).match(/(?:[?#&])t=([a-f0-9]{64})(?:$|&)/)?.[1];
    if(!t||hash_(t)!==r[C['Hash token']])return;
    const m=JSON.parse(r[C['Dados fixos']]);if(!PATHS[m.form])return;
    r[C.Convite]=base+PATHS[m.form]+'#t='+t;put_(sh,i+2,r);count++;
  }));SpreadsheetApp.getUi().alert(count+' link(s) atualizado(s).');
}
function issueRows_(sh,indices,url,metadataOverrides={}) {
    const notes=[]; const root=DriveApp.getFolderById(PROPS.getProperty('ROOT_FOLDER_ID'));
    for(const n of indices) {
      try {
        const range=sh.getRange(n,1,1,COL.length), row=range.getValues()[0];
        if(row[C.Status]||row[C['ID convite']]) throw new Error('Já existe convite nesta linha. Para correção, crie nova linha; nunca reative token.');
        const m=metadataOverrides[n]||metadata_(row,range.getDisplayValues()[0]);
        let days=row[C['Validade (dias)']]===''?14:Number(row[C['Validade (dias)']]);
        if(!Number.isInteger(days)||days<1||days>90) throw new Error('Validade entre 1 e 90 dias.');
        const previous=rows_(sh).filter(r=>r[C['Dados fixos']]).map(r=>JSON.parse(r[C['Dados fixos']]));
        if(previous.some(p=>p.tccId===m.tccId&&p.term===m.term&&p.studentName!==m.studentName)) throw new Error('TCC_ID já associado a outro estudante neste período.');
        const activeDuplicate=rows_(sh).some(r=>{if(!r[C['Dados fixos']]||r[C.Status]===STATUS.REVOKED)return false; const p=JSON.parse(r[C['Dados fixos']]); return p.tccId===m.tccId&&p.term===m.term&&p.form===m.form&&p.professorName.toLowerCase()===m.professorName.toLowerCase()&&r[C.Status]===STATUS.PENDING;});
        if(activeDuplicate) throw new Error('Já há convite pendente para este avaliador e formulário. Revogue-o antes.');
        const folder=getFolder_(getFolder_(root,safeName_(m.term)),safeName_(m.tccId)+' - '+safeName_(m.studentName));
        const t=token_(), invitationId=Utilities.getUuid(), fileIds=Drive.Files.generateIds({count:m.form==='CC-INTEGRADA'?2:1,space:'drive'}).ids;
        if(fileIds.length!==(m.form==='CC-INTEGRADA'?2:1))throw new Error('Não foi possível reservar os arquivos no Drive.');
        const fileId=m.form==='CC-INTEGRADA'?JSON.stringify({previa:fileIds[0],final:fileIds[1]}):fileIds[0];
        const receipt=invitationId;
        row[C['Validade (dias)']]=days;row[C.Status]=STATUS.PENDING;row[C.Convite]=url+PATHS[m.form]+(PATHS[m.form].includes('?')?'#t=':'#t=')+t;
        row[C['ID convite']]=invitationId;row[C['Hash token']]=hash_(t);row[C['Expira em']]=new Date(Date.now()+days*86400000);row[C['ID arquivo']]=fileId;row[C['ID pasta']]=folder.getId();row[C['Dados fixos']]=JSON.stringify(m);row[C.Recibo]=receipt;row[C['Emitido em']]=new Date();
        put_(sh,n,row);notes.push('Linha '+n+': convite criado.');
      }catch(e){ notes.push('Linha '+n+': '+e.message); }
    }return notes;
}
/** One Bancas row describes a defense and all members. Avaliador 1 is the supervisor. */
function sessionData_(raw,display){
  const v=(i)=>text_(raw[i]),d=(i)=>text_(display[i]);
  const examiners=[];
  for(let i=14;i<24;i+=2){if(v(i))examiners.push({name:v(i),email:v(i+1)});else if(v(i+1))throw Error('E-mail sem avaliador '+(1+(i-14)/2)+'.');}
  if(examiners.length<1)throw Error('Preencha Avaliador 1 (orientador).');
  if(examiners.some(e=>!e.email||!/^\S+@\S+\.\S+$/.test(e.email)))throw Error('Informe o e-mail de cada avaliador.');
  if(new Set(examiners.map(e=>e.email.toLowerCase())).size!==examiners.length)throw Error('E-mails repetidos entre avaliadores.');
  const mode=v(2);
  if(!MODES.includes(mode))throw Error('Modalidade de avaliação inválida.');
  const course=mode==='SI-FINAL'?'Sistemas de Informação':'Ciência da Computação';
  if(v(5)&&v(5)!==course)throw Error('Curso não corresponde à modalidade.');
  const result={tccId:v(0),term:v(1),mode,studentName:v(3),title:v(4),course,
    period:v(6),previaDate:d(7),previaTime:d(8),date:d(9),time:d(10),
    defenseMode:v(11)||'Presencial',location:v(12),deadline:d(13),examiners};
  if(!result.title||!result.date||!result.time||!result.location)throw Error('Informe título, data, hora e local/plataforma da defesa.');
  if(mode!=='SI-FINAL'&&(!result.previaDate||!result.previaTime))throw Error('Informe data e hora do andamento.');
  if(!result.tccId||!result.term||!result.studentName||!result.period)throw Error('Complete TCC_ID, período, estudante e semestre.');
  if(!/^([0-2]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/.test(result.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(result.time))throw Error('Data ou hora da defesa inválida.');
  if(!/^\d{4}-[12]$/.test(result.term)||result.term.slice(-1)!==result.period)throw Error('Período inválido.');
  return result;
}
function issueProgressOnly(){issueFromSessions_('CC-PREVIA');}
function issueDefenseOnly(){issueFromSessions_('CC-FINAL');}
function issueFromSessions(){issueFromSessions_('ALL');}
function issueFromSessions_(selectionType){
  const ss=admin_(),src=ss.getActiveSheet();if(src.getName()!==SESSION_SHEET)throw Error('Selecione linhas na aba Bancas.');
  const sel=src.getActiveRange();if(!sel||sel.getLastRow()<2)throw Error('Selecione bancas.');
  const sh=sheet_(),base=deploymentUrl_(),notes=[];
  withLock_(()=>{
    for(let n=Math.max(2,sel.getRow());n<=Math.min(src.getLastRow(),sel.getLastRow());n++){
      try{
        const range=src.getRange(n,1,1,SESSION_COL.length),raw=range.getValues()[0],display=range.getDisplayValues()[0],b=sessionData_(raw,display);
        const types=b.mode==='CC-SEPARADAS'?['CC-PREVIA','CC-FINAL']: [b.mode];
        if(selectionType!=='ALL'){if(b.mode!=='CC-SEPARADAS')throw Error('A emissão por etapa aplica-se apenas a CC-SEPARADAS.');
          types.splice(0,types.length,selectionType);}
        const candidates=[];
        for(const [i,examiner] of b.examiners.entries())for(const type of types)candidates.push({type,examiner,index:i});
        if(selectionType!=='CC-PREVIA')candidates.push({type:b.course==='Sistemas de Informação'?'SI-ATA':'CC-ATA',examiner:b.examiners[0],index:0});
        const lines=[];
        for(const c of candidates){
          const same=rows_(sh).some(r=>{
            if(!r[C['Dados fixos']])return false;
            const m=JSON.parse(r[C['Dados fixos']]);return m.tccId===b.tccId&&m.term===b.term&&m.form===c.type&&m.email.toLowerCase()===c.examiner.email.toLowerCase()&&r[C.Status]!==STATUS.REVOKED;
          });if(same)continue;
          const row=Array(COL.length).fill('');
          row[C.TCC_ID]=b.tccId;row[C['Período']]=b.term;row[C['Formulário']]=c.type;row[C.Estudante]=b.studentName;
          row[C.Avaliador]=c.examiner.name;row[C['E-mail']]=c.examiner.email;row[C.Semestre]=b.period;
          row[C.Data]=c.type==='CC-PREVIA'?raw[7]:raw[9];row[C['Horário']]=c.type==='CC-PREVIA'?raw[8]:raw[10];row[C['Validade (dias)']]=raw[24];
          const rowNumber=sh.getLastRow()+1;if(rowNumber>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),100);
          put_(sh,rowNumber,row);
          const dt=row.slice();dt[C.Data]=c.type==='CC-PREVIA'?b.previaDate:b.date;dt[C['Horário']]=c.type==='CC-PREVIA'?b.previaTime:b.time;
          const m=metadata_(row,dt);
          Object.assign(m,{title:b.title,course:b.course,previaDate:b.previaDate,previaTime:b.previaTime,
            date:c.type==='CC-PREVIA'?b.previaDate:b.date,time:c.type==='CC-PREVIA'?b.previaTime:b.time,defenseMode:b.defenseMode,location:b.location,deadline:b.deadline,
            examiners:b.examiners,examinerIndex:c.index,mode:b.mode});
          lines.push({n:rowNumber,m});
        }
        // Issue inside the same lock using metadata prepared from Bancas.
        notes.push(...issueRows_(sh,lines.map(x=>x.n),base, Object.fromEntries(lines.map(x=>[x.n,x.m]))));
        src.getRange(n,SESSION_COL.length).setValue(lines.length+' convite(s) gerado(s)');
      }catch(e){notes.push('Banca '+n+': '+e.message);src.getRange(n,SESSION_COL.length).setValue('Erro: '+e.message);}
    }
  });ss.setActiveSheet(sh);SpreadsheetApp.getUi().alert(notes.join('\n')||'Nenhum convite novo.');
}
function lookup_(sh,t) {
  if(!validToken_(t)) return null; const h=hash_(t), rows=rows_(sh);
  const i=rows.findIndex(r=>r[C['Hash token']]===h); return i<0?null:{n:i+2,row:rows[i]};
}
function expired_(r) { return !(r[C['Expira em']] instanceof Date)||r[C['Expira em']].getTime()<=Date.now(); }
function fileById_(id) {
  try {return Drive.Files.get(id,{fields:'id,name,trashed,parents,appProperties,webViewLink',supportsAllDrives:true});}
  catch(e){if(/(?:\b404\b|file not found|notFound)/i.test(String(e)))return null;throw e;}
}
function assertFile_(file,row) {
  if(!file||file.trashed||!(file.parents||[]).includes(row[C['ID pasta']])||file.appProperties?.invitation!==row[C['ID convite']]||!/^[a-f0-9]{64}$/.test(file.appProperties?.sha256||'')) throw new Error('Arquivo reservado inconsistente. Contate a orientação.');
}
function markReceived_(sh,n,row,file) {
  assertFile_(file,row);
  row[C.Status]=STATUS.RECEIVED;row[C.Convite]='';row[C['Recebido em']]=new Date();
  row[C.PDF]=file.webViewLink||'https://drive.google.com/open?id='+file.id;row[C['SHA256 PDF']]=file.appProperties.sha256;
  const g=file.appProperties.grade;if(g!==undefined&&g!==''){
    if(row[C['Formulário']]==='CC-PREVIA')row[C['Nota andamento']]=Number(g);
    else if(row[C['Formulário']]==='CC-FINAL'||row[C['Formulário']]==='SI-FINAL')row[C['Nota defesa']]=Number(g);
    if(row[C['Formulário']]==='SI-FINAL')row[C['Nota avaliador']]=Number(g);
  }put_(sh,n,row);try{refreshGrades_();}catch(e){console.warn("Resumo de notas não atualizado: "+e.message);}
}
function json_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function doGet(){return json_({status:'ok',service:'Avalia TG',version:'5'});}
function validateInvitation_(t,form){
  const match=lookup_(sheet_(),t);
  if(!match||match.row[C.Status]===STATUS.REVOKED)return {status:'invalid',message:'Convite inválido ou revogado.'};
  const r=match.row;
  if(r[C.Status]===STATUS.RECEIVED)return {status:'already_received',receipt:r[C.Recibo]};
  if(r[C.Status]!==STATUS.PENDING||expired_(r))return {status:'expired',message:'Convite expirado ou indisponível.'};
  const m=JSON.parse(r[C['Dados fixos']]);
  if(form!==m.form)return {status:'wrong_form',message:'Este convite pertence a outro formulário.'};
  const summary=['CC-ATA','SI-ATA'].includes(m.form)?gradeSummary_(m.tccId,m.term):null;
  return {status:'valid',form:m.form,studentName:m.studentName,professorName:m.professorName,period:m.period,date:m.date,time:m.time,previaDate:m.previaDate||'',previaTime:m.previaTime||'',title:m.title||'',course:m.course||'',defenseMode:m.defenseMode||'',location:m.location||'',deadline:m.deadline||'',examiners:m.examiners||[],grade:summary?.complete?summary.grade:null,gradeComplete:!!summary?.complete};
}
function doPost(e){
  try{
    const body=e?.postData?.contents||'';
    if(body.length>Math.ceil(MAX_BYTES*4/3)+4096)return json_({status:'error',message:'Solicitação muito grande.'});
    const p=JSON.parse(body);
    if(p.action==='validate')return json_(validateInvitation_(p.token,p.form));
    if(p.action==='submit')return json_(p.form==='CC-INTEGRADA'?submitIntegrated(p):submitEvaluation(p));
    return json_({status:'error',message:'Operação inválida.'});
  }catch(err){return json_({status:'error',message:'Operação não confirmada. Confira o convite e tente novamente.'});}
}

/** Only externally callable mutation. The form and recipient derive solely from the token. */
function submitEvaluation(payload) {
  if(!payload||!validToken_(payload.token)||typeof payload.pdf!=='string') throw new Error('Solicitação inválida.');
  if(payload.pdf.length>Math.ceil(MAX_BYTES*4/3)+8||payload.pdf.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(payload.pdf)) throw new Error('PDF inválido ou acima de 5 MB.');
  const bytes=Utilities.base64Decode(payload.pdf);
  if(bytes.length<8||bytes.length>MAX_BYTES||String.fromCharCode(...bytes.slice(0,5))!=='%PDF-') throw new Error('Arquivo não é um PDF válido.');
  const digest=hash_(bytes);
  return withLock_(()=>{
    const sh=sheet_(), match=lookup_(sh,payload.token); if(!match) throw new Error('Convite inválido.');
    const {row,n}=match;
    if(payload.form!==JSON.parse(row[C['Dados fixos']]).form||payload.form==='CC-INTEGRADA')throw new Error('Formulário incompatível.');
    if(row[C.Status]===STATUS.RECEIVED) return {status:'already_received',receipt:row[C.Recibo]};
    if(row[C.Status]!==STATUS.PENDING) throw new Error('Convite revogado ou indisponível.');
    // A pre-generated Drive file ID is reserved at issuance. A retry after a
    // timeout cannot create a second file even if Sheets was not yet updated.
    let file=fileById_(row[C['ID arquivo']]);
    if(file){markReceived_(sh,n,row,file);return {status:'already_received',receipt:row[C.Recibo]};}
    if(expired_(row)) throw new Error('Convite expirado. Solicite novo link.');
    const m=JSON.parse(row[C['Dados fixos']]);
    const submittedGrade=EVALUATION_FORMS.includes(m.form)?parseGrade_(payload.grade):null;
    const name=safeName_(m.form)+' - '+safeName_(m.professorName)+' - '+row[C['ID convite']].slice(0,8)+'.pdf';
    const blob=Utilities.newBlob(bytes,'application/pdf',name);
    try {
      file=Drive.Files.create({id:row[C['ID arquivo']],name,mimeType:'application/pdf',parents:[row[C['ID pasta']]],appProperties:{invitation:row[C['ID convite']],sha256:digest,...(submittedGrade===null?{}:{grade:String(submittedGrade)})}},blob,{fields:'id,name,trashed,parents,appProperties,webViewLink',supportsAllDrives:true});
    }catch(err){file=fileById_(row[C['ID arquivo']]);if(!file)throw new Error('Envio não confirmado. Tente novamente.');}
    markReceived_(sh,n,row,file);
    return {status:file.appProperties.sha256===digest?'received':'already_received',receipt:row[C.Recibo]};
  });
}
/** CC integrada: reserve TWO Drive IDs in the existing 'ID arquivo' cell.
 *  Each request uploads only one PDF (Apps Script body-size ceiling).
 *  The invitation is RECEBIDO only after both immutable IDs exist.
 */
function integratedIds_(row) {
  const ids=JSON.parse(row[C['ID arquivo']]);
  if(!ids||typeof ids.previa!=='string'||typeof ids.final!=='string'||ids.previa===ids.final)throw new Error('Reserva integrada inválida.');
  return ids;
}
function integratedFiles_(row) {
  const ids=integratedIds_(row);
  const files={previa:fileById_(ids.previa),final:fileById_(ids.final)};
  for(const type of ['previa','final'])if(files[type]){
    assertFile_(files[type],row);
    if(files[type].appProperties.part!==type)throw new Error('Tipo de arquivo reservado inconsistente.');
  }
  return files;
}
function markIntegratedReceived_(sh,n,row,files) {
  if(!files.previa||!files.final)return false;
  for(const part of ['previa','final']){
    assertFile_(files[part],row);
    if(files[part].appProperties.part!==part)throw new Error('Arquivo integrado inconsistente.');
  }
  row[C.Status]=STATUS.RECEIVED;row[C.Convite]='';row[C['Recebido em']]=new Date();
  row[C.PDF]=['previa','final'].map(part=>files[part].webViewLink||'https://drive.google.com/open?id='+files[part].id).join('\n');
  row[C['SHA256 PDF']]=JSON.stringify({previa:files.previa.appProperties.sha256,final:files.final.appProperties.sha256});
  row[C['Nota andamento']]=Number(files.previa.appProperties.grade);row[C['Nota defesa']]=Number(files.final.appProperties.grade);
  row[C['Nota avaliador']]=Math.round((.3*Number(row[C['Nota andamento']])+.7*Number(row[C['Nota defesa']]))*100)/100;
  put_(sh,n,row);try{refreshGrades_();}catch(e){console.warn("Resumo de notas não atualizado: "+e.message);}return true;
}
function submitIntegrated(payload) {
  if(!payload||!validToken_(payload.token)||!['previa','final'].includes(payload.part)||typeof payload.pdf!=='string')throw new Error('Solicitação inválida.');
  if(payload.pdf.length>Math.ceil(MAX_BYTES*4/3)+8||payload.pdf.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(payload.pdf))throw new Error('PDF inválido ou acima de 5 MB.');
  const bytes=Utilities.base64Decode(payload.pdf);
  if(bytes.length<8||bytes.length>MAX_BYTES||String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')throw new Error('Arquivo não é um PDF válido.');
  const digest=hash_(bytes);
  return withLock_(()=>{
    const sh=sheet_(),match=lookup_(sh,payload.token);if(!match)throw new Error('Convite inválido.');
    const {n,row}=match,m=JSON.parse(row[C['Dados fixos']]);
    if(m.form!=='CC-INTEGRADA'||payload.form!==m.form)throw new Error('Formulário incompatível.');
    if(row[C.Status]===STATUS.RECEIVED)return {status:'already_received',receipt:row[C.Recibo]};
    if(row[C.Status]!==STATUS.PENDING)throw new Error('Convite revogado ou indisponível.');
    const files=integratedFiles_(row);
    if(files.previa&&files.final){markIntegratedReceived_(sh,n,row,files);return {status:'already_received',receipt:row[C.Recibo]};}
    if(files[payload.part])return {status:'part_received',part:payload.part,receipt:row[C.Recibo]};
    if(expired_(row))throw new Error('Convite expirado. Solicite novo link.');
    const ids=integratedIds_(row), part=payload.part;
    parseGrade_(payload.grade);
    const name='CC-'+(part==='previa'?'ANDAMENTO':'DEFESA')+' - '+safeName_(m.professorName)+' - '+row[C['ID convite']].slice(0,8)+'.pdf';
    const blob=Utilities.newBlob(bytes,'application/pdf',name);
    let file;
    try{file=Drive.Files.create({id:ids[part],name,mimeType:'application/pdf',parents:[row[C['ID pasta']]],appProperties:{invitation:row[C['ID convite']],part,sha256:digest,grade:String(parseGrade_(payload.grade))}},blob,{fields:'id,name,trashed,parents,appProperties,webViewLink',supportsAllDrives:true});}
    catch(err){file=fileById_(ids[part]);if(!file)throw new Error('Envio não confirmado. Tente novamente.');}
    assertFile_(file,row);if(file.appProperties.part!==part)throw new Error('Arquivo reservado inconsistente.');
    files[part]=file;
    if(markIntegratedReceived_(sh,n,row,files))return {status:'received',receipt:row[C.Recibo]};
    return {status:'part_received',part,receipt:row[C.Recibo]};
  });
}
function revokeSelected() {
  const ss=admin_(),{sh,first,last}=selected_(ss);
  withLock_(()=>{for(let n=first;n<=last;n++){const r=sh.getRange(n,1,1,COL.length).getValues()[0];if(r[C.Status]!==STATUS.PENDING)continue;if(JSON.parse(r[C['Dados fixos']]).form==='CC-INTEGRADA'){
    const fs=integratedFiles_(r);if(markIntegratedReceived_(sh,n,r,fs))continue;
    if(fs.previa||fs.final)throw new Error('Convite integrado com envio parcial; complete o recebimento antes de revogar.');
  }else{const f=fileById_(r[C['ID arquivo']]);if(f){markReceived_(sh,n,r,f);continue;}}
  r[C.Status]=STATUS.REVOKED;r[C.Convite]='';put_(sh,n,r);}});
  SpreadsheetApp.getUi().alert('Convites pendentes selecionados revogados. Recebimentos existentes foram preservados.');
}
function reconcileSubmissions() {
  admin_();const sh=sheet_();let count=0;
  withLock_(()=>rows_(sh).forEach((r,i)=>{if(r[C.Status]!==STATUS.PENDING)return;if(JSON.parse(r[C['Dados fixos']]).form==='CC-INTEGRADA'){if(markIntegratedReceived_(sh,i+2,r,integratedFiles_(r)))count++;}
  else{const f=fileById_(r[C['ID arquivo']]);if(f){markReceived_(sh,i+2,r,f);count++;}}}));
  SpreadsheetApp.getUi().alert(count+' recebimento(s) reconciliado(s).');
}

function parseGrade_(g){
  if(typeof g!=='number'||!Number.isFinite(g)||g<0||g>10||Math.round(g*1000)!==g*1000)throw Error('Nota de avaliação inválida.');
  return Math.round(g*1000)/1000;
}
/** Only accepted PDFs contribute to the average, never unconfirmed uploads. */
function gradeSummary_(id,term){
  const ss=SpreadsheetApp.openById(PROPS.getProperty('SPREADSHEET_ID'));
  const bsh=ss.getSheetByName(SESSION_SHEET);
  if(!bsh||bsh.getLastRow()<2)return {complete:false,grade:null,received:0,expected:0};
  const bancas=bsh.getRange(2,1,bsh.getLastRow()-1,SESSION_COL.length).getValues();
  const b=bancas.find(r=>text_(r[0])===id&&text_(r[1])===term);
  if(!b)return {complete:false,grade:null,received:0,expected:0};
  const ex=[];for(let i=14;i<24;i+=2)if(text_(b[i]))ex.push(text_(b[i+1]).toLowerCase());
  const existing=rows_(sheet_());let grades=[];
  for(const email of ex){
    const matches=existing.filter(r=>r[C.TCC_ID]===id&&r[C['Período']]===term&&text_(r[C['E-mail']]).toLowerCase()===email&&r[C.Status]===STATUS.RECEIVED);
    let g=null;
    if(text_(b[2])==='CC-INTEGRADA')g=matches.find(r=>r[C['Formulário']]==='CC-INTEGRADA')?.[C['Nota avaliador']];
    else if(text_(b[2])==='CC-SEPARADAS'){
      const a=matches.find(r=>r[C['Formulário']]==='CC-PREVIA')?.[C['Nota andamento']];
      const d=matches.find(r=>r[C['Formulário']]==='CC-FINAL')?.[C['Nota defesa']];
      if(a!==undefined&&a!==''&&d!==undefined&&d!=='')g=.3*Number(a)+.7*Number(d);
    }else g=matches.find(r=>r[C['Formulário']]==='SI-FINAL')?.[C['Nota avaliador']];
    if(g!==null&&g!==undefined&&g!==''&&Number.isFinite(Number(g)))grades.push(Number(g));
  }
  const complete=grades.length===ex.length&&ex.length>0;
  return {complete,grade:complete?Math.round(grades.reduce((a,b)=>a+b,0)/grades.length*100)/100:null,received:grades.length,expected:ex.length};
}
function refreshGrades(){admin_();refreshGrades_();SpreadsheetApp.getUi().alert('Resumo das notas atualizado.');}
function refreshGrades_(){
  const ss=SpreadsheetApp.openById(PROPS.getProperty('SPREADSHEET_ID'));
  const out=ss.getSheetByName('Notas');const b=ss.getSheetByName(SESSION_SHEET);
  if(!out||!b)return;
  if(out.getLastRow()>1)out.getRange(2,1,out.getLastRow()-1,8).clearContent();
  if(b.getLastRow()<2)return;
  const data=b.getRange(2,1,b.getLastRow()-1,SESSION_COL.length).getValues();
  const rows=data.filter(r=>r[0]&&r[1]).map(r=>{
    const g=gradeSummary_(text_(r[0]),text_(r[1]));
    return [r[0],r[1],r[3],r[5]|| (r[2]==='SI-FINAL'?'Sistemas de Informação':'Ciência da Computação'),g.expected,g.received,g.complete?g.grade:'',g.complete?'COMPLETO':'PENDENTE'];
  });
  if(rows.length)out.getRange(2,1,rows.length,8).setValues(rows);
}
