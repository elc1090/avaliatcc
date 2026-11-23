// Administrative actions for the spreadsheet-bound Avalia TG menu.
function selectedBancas_() {
  const ss = admin_();
  const sheet = ss.getActiveSheet();
  const range = sheet.getActiveRange();
  if (sheet.getName() !== SESSION_SHEET || !range || range.getLastRow() < 2) {
    throw new Error('Selecione uma ou mais linhas na aba Bancas.');
  }
  const first = Math.max(2, range.getRow());
  const count = Math.min(sheet.getLastRow(), range.getLastRow()) - first + 1;
  if (count < 1) throw new Error('Nenhuma banca selecionada.');
  const data = sheet.getRange(first, 1, count, SESSION_COL.length);
  const display = data.getDisplayValues();
  return data.getValues().map((row, index) => sessionData_(row, display[index]));
}

function matchingBanca_(row, banca) {
  return text_(row[C.TCC_ID]) === banca.tccId && text_(row[C['Período']]) === banca.term;
}

function singleEmail_(value) {
  const email = text_(value);
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) {
    throw new Error('Informe um único endereço de e-mail válido.');
  }
  return email;
}

function openInvitationManager() {
  selectedBancas_();
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutputFromFile('Invitations').setWidth(740).setHeight(600),
    'Gerenciar convites'
  );
}

function invitationStage_(stage) {
  if (!['ALL', 'CC-PREVIA', 'CC-FINAL'].includes(stage)) throw new Error('Etapa inválida.');
  const bancas = selectedBancas_();
  if (stage !== 'ALL' && bancas.some(banca => banca.mode !== 'CC-SEPARADAS')) {
    throw new Error('A seleção por etapa exige bancas na modalidade CC-SEPARADAS.');
  }
  return bancas;
}

function generateInvitationLinks(stage) {
  invitationStage_(stage);
  return issueFromSessions_(stage, true);
}

function invitationPreview_(stage) {
  const bancas = invitationStage_(stage);
  const messages = [];
  const minutes = [];
  for (const row of rows_(sheet_())) {
    const banca = bancas.find(candidate => matchingBanca_(row, candidate));
    if (!banca || row[C.Status] !== STATUS.PENDING || expired_(row) || !row[C.Convite]) continue;
    const meta = JSON.parse(row[C['Dados fixos']]);
    if (!EVALUATION_FORMS.includes(meta.form)) {
      const minutesForm = banca.mode === 'SI-FINAL' ? 'SI-ATA' : 'CC-ATA';
      if (stage !== 'CC-PREVIA' && meta.form === minutesForm &&
          banca.examiners[0].email.toLowerCase() === text_(meta.email).toLowerCase()) {
        minutes.push(meta.studentName + ': ' + row[C.Convite]);
      }
      continue;
    }
    const forms = banca.mode === 'CC-SEPARADAS' ? ['CC-PREVIA', 'CC-FINAL'] : [banca.mode];
    if (!forms.includes(meta.form) || (stage !== 'ALL' && meta.form !== stage) ||
        !banca.examiners.some(examiner => examiner.email.toLowerCase() === text_(meta.email).toLowerCase())) continue;
    const stored = PROPS.getProperty('INVITATION_EMAIL_' + row[C['ID convite']]) || '';
    const address = text_(meta.email);
    let state = stored || 'PENDENTE';
    try { singleEmail_(address); } catch (error) { state = 'E-MAIL INVÁLIDO'; }
    const dates = meta.form === 'CC-INTEGRADA'
      ? 'Andamento: ' + meta.previaDate + ' às ' + meta.previaTime + '\nDefesa: ' + meta.date + ' às ' + meta.time
      : 'Data: ' + meta.date + ' às ' + meta.time;
    messages.push({
      id: row[C['ID convite']],
      recipient: address,
      subject: FORMS[meta.form].label + ' — ' + meta.studentName,
      body: 'Olá, ' + meta.professorName + ',\n\n' +
        'Segue o link para a ficha de avaliação do trabalho de ' + meta.studentName +
        (meta.title ? ' (“' + meta.title + '”)' : '') + '.\n\n' + dates +
        (meta.form !== 'CC-PREVIA' && meta.location ? '\nLocal ou plataforma: ' + meta.location : '') +
        '\n\nFicha de avaliação: ' + row[C.Convite],
      state
    });
  }
  return {messages, minutes, revision: hash_(JSON.stringify(messages))};
}

function previewInvitationEmails(stage) {
  return invitationPreview_(stage);
}

function sendInvitationEmails(stage, revision, test) {
  admin_();
  if (typeof test !== 'boolean') throw new Error('Modo de envio inválido.');
  return withLock_(() => {
    const preview = invitationPreview_(stage);
    if (preview.revision !== revision) throw new Error('Os convites mudaram. Atualize a prévia.');
    const pending = preview.messages.filter(message => message.state === 'PENDENTE');
    const batch = test ? preview.messages : pending;
    if (!batch.length) throw new Error('Nenhum convite disponível para este envio.');
    const testEmail = test ? singleEmail_(PROPS.getProperty('TEST_EMAIL') || Session.getActiveUser().getEmail()) : '';
    if (MailApp.getRemainingDailyQuota() < batch.length) throw new Error('Cota diária insuficiente para este lote.');
    const results = [];
    for (const message of batch) {
      const key = 'INVITATION_EMAIL_' + message.id;
      if (!test) PROPS.setProperty(key, 'ENVIO A CONFERIR');
      try {
        MailApp.sendEmail(
          test ? testEmail : singleEmail_(message.recipient),
          (test ? '[TESTE] ' : '') + message.subject,
          (test ? 'Destinatário previsto: ' + message.recipient + '\n\n' : '') + message.body
        );
      } catch (error) {
        results.push(message.recipient + (test ? ' — falha no teste' : ' — envio a conferir'));
        continue;
      }
      if (!test) PROPS.setProperty(key, 'ENVIADO');
      results.push(message.recipient + (test ? ' — teste enviado para ' + testEmail : ' — enviado'));
    }
    return results.join('\n');
  });
}

// Called only after the existing receipt code confirms the Drive file(s).
function shareReceivedEvaluation_(row, files) {
  if (!EVALUATION_FORMS.includes(row[C['Formulário']])) return;
  const pending = Object.fromEntries(files.map(file => ['SHARE_PENDING_' + file.id, row[C['ID convite']]]));
  try {
    PROPS.setProperties(pending);
  } catch (error) {
    console.warn('Falha ao registrar compartilhamentos pendentes: ' + error.message);
  }
  for (const file of files) {
    try {
      const key = 'SHARE_PENDING_' + file.id;
      grantEvaluationViewer_(file.id, JSON.parse(row[C['Dados fixos']]).email);
      PROPS.deleteProperty(key);
    } catch (error) {
      console.warn('Compartilhamento pendente para o arquivo ' + file.id + ': ' + error.message);
    }
  }
}

function grantEvaluationViewer_(id, address) {
  const email = singleEmail_(address);
  let token;
  do {
    const response = Drive.Permissions.list(id, {
      supportsAllDrives: true,
      fields: 'nextPageToken,permissions(type,emailAddress)',
      ...(token ? {pageToken: token} : {})
    });
    if ((response.permissions || []).some(permission => permission.type === 'user' &&
        text_(permission.emailAddress).toLowerCase() === email.toLowerCase())) return;
    token = response.nextPageToken;
  } while (token);
  Drive.Permissions.create({type: 'user', role: 'reader', emailAddress: email}, id,
    {supportsAllDrives: true, sendNotificationEmail: true});
}

function retryEvaluationSharing() {
  admin_();
  const summary = withLock_(() => {
    const rows = rows_(sheet_());
    let complete = 0;
    let pending = 0;
    for (const [key, invitation] of Object.entries(PROPS.getProperties())) {
      if (!key.startsWith('SHARE_PENDING_')) continue;
      try {
        const row = rows.find(candidate => candidate[C['ID convite']] === invitation);
        const id = key.slice('SHARE_PENDING_'.length);
        if (!row || row[C.Status] !== STATUS.RECEIVED || !EVALUATION_FORMS.includes(row[C['Formulário']])) {
          throw new Error('Avaliação recebida não localizada.');
        }
        const ids = row[C['Formulário']] === 'CC-INTEGRADA'
          ? Object.values(integratedIds_(row)) : [row[C['ID arquivo']]];
        if (!ids.includes(id)) throw new Error('Arquivo não pertence ao convite.');
        assertFile_(fileById_(id), row);
        grantEvaluationViewer_(id, JSON.parse(row[C['Dados fixos']]).email);
        PROPS.deleteProperty(key);
        complete++;
      } catch (error) {
        pending++;
        console.warn(error.message);
      }
    }
    return complete + ' compartilhamento(s) concluído(s), ' + pending + ' pendente(s).';
  });
  SpreadsheetApp.getUi().alert(summary);
}

function secretaryPackage_() {
  const bancas = selectedBancas_();
  if (bancas.length !== 1) throw new Error('Selecione uma única banca.');
  const banca = bancas[0];
  const recipient = singleEmail_(PROPS.getProperty('SECRETARY_EMAIL_' + (banca.mode === 'SI-FINAL' ? 'SI' : 'CC')) ||
    PROPS.getProperty('SECRETARY_EMAIL'));
  const rows = rows_(sheet_()).filter(row => matchingBanca_(row, banca) && row[C.Status] === STATUS.RECEIVED);
  const types = banca.mode === 'CC-SEPARADAS' ? ['CC-PREVIA', 'CC-FINAL'] : [banca.mode];
  const expected = banca.examiners.flatMap(examiner => types.map(form => ({form, examiner})));
  expected.push({form: banca.mode === 'SI-FINAL' ? 'SI-ATA' : 'CC-ATA'});
  const files = [];
  const missing = [];
  for (const {form, examiner} of expected) {
    const label = FORMS[form].label + (examiner ? ' — ' + examiner.name : '');
    const matching = rows.filter(row => row[C['Formulário']] === form && (!examiner ||
      text_(JSON.parse(row[C['Dados fixos']]).email).toLowerCase() === examiner.email.toLowerCase()));
    const row = matching.sort((a, b) => Number(b[C['Recebido em']]) - Number(a[C['Recebido em']]))[0];
    try {
      if (!row) throw new Error('Recebimento não localizado.');
      const parts = form === 'CC-INTEGRADA' ? Object.values(integratedFiles_(row)) : [fileById_(row[C['ID arquivo']])];
      for (const file of parts) assertFile_(file, row);
      files.push(...parts.map(file => ({id: file.id, name: file.name})));
    } catch (error) {
      missing.push(label + ' (' + error.message + ')');
    }
  }
  return {banca, recipient, files, missing};
}

function prepareSecretaryEmail() {
  admin_();
  const ui = SpreadsheetApp.getUi();
  const item = secretaryPackage_();
  const details = 'Destinatário: ' + item.recipient + '\n\n' +
    'Anexos:\n' + (item.files.map(file => file.name).join('\n') || 'Nenhum') +
    (item.missing.length ? '\n\nPendências:\n' + item.missing.join('\n') : '');
  if (item.missing.length) {
    ui.alert('Documentos de ' + item.banca.studentName, details, ui.ButtonSet.OK);
    return;
  }
  if (ui.alert('Criar rascunho para ' + item.banca.studentName + '?', details, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const current = secretaryPackage_();
  if (JSON.stringify(current) !== JSON.stringify(item)) throw new Error('Os documentos mudaram. Revise novamente.');
  const attachments = current.files.map(file => DriveApp.getFileById(file.id).getBlob().setName(file.name));
  if (attachments.reduce((sum, blob) => sum + blob.getBytes().length, 0) > 25 * 1024 * 1024) {
    throw new Error('Os PDFs excedem o limite de 25 MB de anexos.');
  }
  const {banca} = current;
  GmailApp.createDraft(current.recipient, 'Documentos de TCC — ' + banca.studentName,
    'Prezada Secretaria,\n\nEncaminho, em anexo, a ata e as fichas de avaliação do TCC de ' +
    banca.studentName + ', do curso de ' + banca.course + '.\n\nAtenciosamente,', {attachments});
  ui.alert('Rascunho criado no Gmail com ' + attachments.length + ' anexo(s).');
}
