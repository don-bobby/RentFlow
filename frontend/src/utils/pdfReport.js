// Builds a clean, paginated PDF from a report's own data (title, summary
// figures, table) instead of printing a screenshot of the page.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// jsPDF's built-in fonts only cover Latin-1 + a few typographic marks, so
// emoji / icons in cell text are dropped rather than printed as garbage.
const clean = (v) => String(v ?? '—')
  .replace(/[^\x20-\x7E -ÿ–—‘’“”•…]/g, '')
  .replace(/\s+/g, ' ')
  .trim() || '—';

const PRIMARY = [91, 33, 182];
const MUTED   = [110, 110, 120];

export function exportReportPdf({ title, columns, rows, summary, periodLabel, filename, orgName = 'RentFlow', generatedBy }) {
  const landscape = columns.length > 6;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 36;

  // Header band
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, W, 64, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text(clean(title), M, 34);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(clean(periodLabel || ''), M, 50);
  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.text(orgName, W - M, 34, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}${generatedBy ? ` by ${clean(generatedBy)}` : ''}`, W - M, 50, { align: 'right' });

  let y = 84;

  // Summary tiles
  if (summary && summary.length) {
    const cols = Math.min(summary.length, 4);
    const gap = 10;
    const tileW = (W - 2 * M - gap * (cols - 1)) / cols;
    summary.forEach((s, i) => {
      const row = Math.floor(i / cols), col = i % cols;
      const x = M + col * (tileW + gap), ty = y + row * 52;
      doc.setDrawColor(220, 220, 228); doc.setFillColor(248, 248, 252);
      doc.roundedRect(x, ty, tileW, 44, 5, 5, 'FD');
      doc.setTextColor(...MUTED); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      doc.text(clean(s.label), x + 10, ty + 16);
      doc.setTextColor(30, 30, 40); doc.setFontSize(13); doc.setFont('helvetica', 'bold');
      doc.text(clean(s.value), x + 10, ty + 34);
    });
    y += Math.ceil(summary.length / cols) * 52 + 8;
  }

  const numeric = (c) => /\((KES|%)\)|amount|balance|score|days|months|requests|completed|total|cost|rent/i.test(c);
  autoTable(doc, {
    startY: y,
    head: [columns.map(clean)],
    body: rows.map(r => columns.map(c => clean(r[c]))),
    margin: { left: M, right: M, bottom: 40 },
    styles: { font: 'helvetica', fontSize: landscape ? 8 : 9, cellPadding: 4, overflow: 'linebreak', textColor: [30, 30, 40] },
    headStyles: { fillColor: PRIMARY, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 247, 251] },
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, { halign: numeric(c) ? 'right' : 'left' }])),
    didDrawPage: () => {
      const H = doc.internal.pageSize.getHeight();
      doc.setFontSize(8); doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal');
      doc.text(`${orgName} - ${clean(title)}`, M, H - 18);
    },
  });

  // Page numbers (needs the final page count)
  const pages = doc.getNumberOfPages();
  const H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 18, { align: 'right' });
  }
  if (!rows.length) {
    doc.setPage(pages); doc.setFontSize(10); doc.setTextColor(...MUTED);
    doc.text('No data for the selected filters.', M, y + 40);
  }

  doc.save(`${filename || 'report'}_${new Date().toISOString().split('T')[0]}.pdf`);
}
