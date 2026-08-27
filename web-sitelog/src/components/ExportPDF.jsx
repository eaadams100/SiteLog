/**
 * components/ExportPDF.jsx
 *
 * Generates and downloads a PDF report entirely client-side from data
 * already loaded in the dashboard (the currently filtered `logs` and
 * computed `stats`) — no backend round trip. Uses jsPDF + jspdf-autotable
 * v5's current API: `import { autoTable } from 'jspdf-autotable'` called
 * as `autoTable(doc, {...})`, NOT the older `doc.autoTable({...})`
 * plugin-attachment style, which breaks under Vite/ESM without extra
 * config (see package.json's pinned v5, not the commonly-copy-pasted v3
 * examples still floating around online).
 */

import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

const BRAND_BLUE = [29, 78, 216]; // #1D4ED8 — same blue used across mobile app and dashboard UI

function formatDate(isoDate) {
  if (!isoDate) return '—';
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatWorkers(workers) {
  if (!Array.isArray(workers) || workers.length === 0) return '—';
  return workers.map((w) => `${w.count} ${w.trade}`).join(', ');
}

function formatMaterials(materials) {
  if (!Array.isArray(materials) || materials.length === 0) return '—';
  return materials.map((m) => `${m.quantity} ${m.unit} ${m.name}`).join(', ');
}

function formatIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return 'None';
  return issues.map((i) => `${i.flagged ? '⚠ ' : ''}${i.description}`).join('; ');
}

function generatePDF({ project, startDate, endDate, logs, stats }) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // --- Header ---
  doc.setFontSize(18);
  doc.setTextColor(...BRAND_BLUE);
  doc.text('SiteLog Daily Report', 14, 18);

  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  doc.text(`Project: ${project?.name ?? 'Unknown'}${project?.location ? ` — ${project.location}` : ''}`, 14, 26);
  doc.text(
    `Date range: ${startDate ? formatDate(startDate) : 'All'} – ${endDate ? formatDate(endDate) : 'All'}`,
    14,
    32
  );
  doc.text(`Generated: ${new Date().toLocaleString('en-US')}`, 14, 38);

  // --- Summary stats ---
  doc.setFontSize(10);
  const statsLine = `Total logs: ${stats.totalLogs}   |   Total workers: ${stats.totalWorkers}   |   Flagged issues: ${stats.flaggedIssues}   |   Days logged: ${stats.uniqueDays}`;
  doc.text(statsLine, 14, 46);

  // --- Table ---
  const hasFlaggedIssue = logs.map((log) => (log.issues ?? []).some((i) => i.flagged));

  autoTable(doc, {
    startY: 52,
    head: [['Date', 'Weather', 'Workers', 'Materials', 'Issues']],
    body: logs.map((log) => [
      formatDate(log.log_date),
      log.weather?.condition ? `${log.weather.condition}${log.weather.temp != null ? `, ${log.weather.temp}°` : ''}` : '—',
      formatWorkers(log.workers),
      formatMaterials(log.materials),
      formatIssues(log.issues),
    ]),
    headStyles: { fillColor: BRAND_BLUE, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 4: { cellWidth: 70 } },
    didParseCell(data) {
      // Column index 4 is Issues — color it red for any row with a
      // flagged issue, per the spec's "special formatting" requirement.
      if (data.section === 'body' && data.column.index === 4 && hasFlaggedIssue[data.row.index]) {
        data.cell.styles.textColor = [185, 28, 28];
        data.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage() {
      // Footer, drawn on every page.
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `SiteLog — Page ${doc.internal.getCurrentPageInfo().pageNumber} of ${pageCount}`,
        pageWidth - 14,
        doc.internal.pageSize.getHeight() - 8,
        { align: 'right' }
      );
    },
  });

  const filenameSafeProject = (project?.name ?? 'project').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  doc.save(`sitelog-${filenameSafeProject}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export default function ExportPDF({ project, startDate, endDate, logs, stats, disabled }) {
  return (
    <button
      type="button"
      className="button button--primary"
      onClick={() => generatePDF({ project, startDate, endDate, logs, stats })}
      disabled={disabled || logs.length === 0}
      title={logs.length === 0 ? 'No logs to export' : 'Download PDF report'}
    >
      Export PDF
    </button>
  );
}