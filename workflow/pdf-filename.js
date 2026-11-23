/* Keep the filename convention in sync with apps-script/Code.gs. */
window.AvaliaPdfFilename = function pdfFilename({term, date, period, form, studentName, professorName}, part) {
  const clean = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const termMatch = /^(\d{4})-([12])$/.exec(term);
  const isoDate = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  const brDate = /^\d{2}\/(\d{2})\/(\d{4})$/.exec(date);
  const year = termMatch?.[1] || isoDate?.[1] || brDate?.[2];
  const month = isoDate?.[2] || brDate?.[1];
  const semester = termMatch?.[2] || period || (month && (Number(month) <= 6 ? '1' : '2'));
  const academicTerm = year && /^[12]$/.test(semester)
    ? year + (String(semester) === '1' ? 'a' : 'b')
    : 'Periodo-Indefinido';
  const [course, kind] = form.split('-');
  const ata = kind === 'ATA';
  const label = ata ? 'AtaDefesa' : (kind === 'PREVIA' || part === 'previa' ? 'FichaAndamento' : 'FichaDefesa');
  const filename = [academicTerm, course, clean(studentName) || 'Estudante', label];
  if (!ata) {
    const firstName = clean(String(professorName || '').trim()
      .replace(/^(?:(?:prof(?:a|essor(?:a)?)?|dr(?:a)?)[.ªº]?[\s-]+)+/i, '')
      .split(/\s+/)[0]);
    filename.push('Prof', firstName || 'Avaliador');
  }
  return filename.join('-') + '.pdf';
};
