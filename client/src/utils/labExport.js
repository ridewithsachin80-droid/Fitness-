/**
 * labExport.js — download lab results as CSV, or as a printable PDF.
 *
 * ── Why print-to-PDF rather than a PDF library ──────────────────────────────
 *
 * jsPDF and friends add roughly a quarter of a megabyte to the bundle of an
 * app whose members are often on patchy mobile data. The browser already has
 * a competent PDF writer built in, and the app already uses this pattern for
 * the coach's Print Report, so behaviour stays consistent.
 *
 * The trade-off is one extra tap: the print dialog opens and the member picks
 * "Save as PDF" (or "Print to PDF" on desktop). Both Chrome on Android and
 * Safari on iOS offer it. Say the word and I'll swap in a real library if the
 * extra tap matters more than the payload.
 *
 * The CSV is a genuine one-click download — no dialog, no dependency.
 */

const esc = v => {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote anything containing a delimiter, quote or newline; double inner quotes
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const fmtDate = d => {
  if (!d) return '';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(dt.getTime()) ? String(d).slice(0, 10)
    : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const refText = (lo, hi) => {
  const l = Number.isFinite(parseFloat(lo)) ? parseFloat(lo) : null;
  const h = Number.isFinite(parseFloat(hi)) ? parseFloat(hi) : null;
  if (l != null && h != null) return `${l} - ${h}`;
  if (h != null) return `< ${h}`;
  if (l != null) return `> ${l}`;
  return '';
};

/** Trigger a real file download from an in-memory string. */
function download(filename, mime, text) {
  // A BOM makes Excel open UTF-8 correctly — without it, Indian lab names and
  // the µ in µg render as mojibake, which looks like corrupted data.
  const blob = new Blob([mime.startsWith('text/csv') ? '\uFEFF' + text : text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick; revoking immediately cancels the download in Safari
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = s => String(s || 'member').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const today = () => new Date().toISOString().slice(0, 10);

/**
 * One row per lab value, newest first.
 * @param labs  raw lab_values rows
 */
export function exportLabsCSV(labs = [], memberName = 'member') {
  const header = ['Test', 'Value', 'Unit', 'Reference range', 'Status', 'Test date', 'Lab', 'Entered by'];
  const rows = [...labs]
    .sort((a, b) => new Date(b.test_date) - new Date(a.test_date)
                 || String(a.test_name).localeCompare(String(b.test_name)))
    .map(l => [
      l.test_name, l.value, l.unit || '',
      refText(l.ref_min, l.ref_max),
      l.status || '', fmtDate(l.test_date),
      l.lab_name || '', l.entered_role || '',
    ]);

  const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  download(`${slug(memberName)}-lab-results-${today()}.csv`, 'text/csv;charset=utf-8', csv);
  return rows.length;
}

/** Interval comparisons with the diet and training context of each window. */
export function exportComparisonsCSV(comparisons = [], memberName = 'member') {
  const header = ['Test', 'From', 'To', 'Change', 'Direction', 'From state', 'To state',
                  'Interval (days)', 'From date', 'To date',
                  'Avg kcal', 'Avg protein (g)', 'Weight change (kg)',
                  'Training sessions', 'Cardio (min)', 'Days logged (%)'];
  const rows = comparisons.map(c => [
    c.test_name, c.from, c.to, c.change, c.direction,
    c.from_state || '', c.to_state || '', c.interval_days,
    fmtDate(c.from_date), fmtDate(c.to_date),
    c.context?.mean_kcal ?? '', c.context?.mean_protein ?? '',
    c.context?.weight_change ?? '', c.context?.training_sessions ?? '',
    c.context?.cardio_minutes ?? '', c.context?.coverage_pct ?? '',
  ]);
  const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  download(`${slug(memberName)}-lab-changes-${today()}.csv`, 'text/csv;charset=utf-8', csv);
  return rows.length;
}

const h = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Open a print-ready document. The member or coach saves it as PDF.
 * @param opts { labs, comparisons, insight, memberName }
 */
export function printLabReport({ labs = [], comparisons = [], insight = null, memberName = 'Member' }) {
  const byDate = new Map();
  for (const l of labs) {
    const d = String(l.test_date).slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(l);
  }
  const dates = [...byDate.keys()].sort().reverse();

  const panels = dates.map(d => `
    <h3>${h(fmtDate(d))}${byDate.get(d)[0]?.lab_name ? ` &middot; ${h(byDate.get(d)[0].lab_name)}` : ''}</h3>
    <table>
      <thead><tr><th>Test</th><th class="n">Result</th><th>Unit</th><th>Reference</th><th>Status</th></tr></thead>
      <tbody>
        ${byDate.get(d).map(l => `
          <tr class="${l.status === 'normal' ? '' : 'flag'}">
            <td>${h(l.test_name)}</td>
            <td class="n"><b>${h(l.value)}</b></td>
            <td>${h(l.unit || '')}</td>
            <td>${h(refText(l.ref_min, l.ref_max))}</td>
            <td>${h(l.status || '')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`).join('');

  const changes = comparisons.length ? `
    <h2>What changed between tests</h2>
    ${comparisons.map(c => `
      <div class="cmp">
        <p class="cmp-h"><b>${h(c.test_name)}</b> &mdash; ${h(c.from)} &rarr; ${h(c.to)}${c.unit ? ' ' + h(c.unit) : ''}
          <span class="dir">${h(c.direction)}</span></p>
        <p class="cmp-s">${c.interval_days} days${c.from_state && c.to_state && c.from_state !== c.to_state
          ? ` &middot; ${h(c.from_state)} &rarr; ${h(c.to_state)}` : ''}</p>
        <p class="cmp-c">During this interval:
          ${c.context?.mean_kcal ? `${c.context.mean_kcal} kcal/day average` : 'intake not logged'}${
            c.context?.mean_protein ? `, ${c.context.mean_protein}g protein` : ''}${
            c.context?.weight_change != null ? `, weight ${c.context.weight_change > 0 ? '+' : ''}${c.context.weight_change} kg` : ''}${
            c.context?.training_sessions ? `, ${c.context.training_sessions} training sessions` : ''}${
            c.context?.cardio_minutes ? `, ${c.context.cardio_minutes} min cardio` : ''}.
          ${c.context?.coverage_pct != null ? `Logged on ${c.context.coverage_pct}% of days.` : ''}</p>
      </div>`).join('')}
    <p class="caveat">Shows what changed alongside each result, not what caused it. Between two tests
      diet, supplements, training, weight, sleep, medication and the testing lab itself may all differ.</p>` : '';

  const analysis = insight?.generated ? `
    <h2>Nutritional guidance</h2>
    <p class="lead">${h(insight.summary || '')}</p>
    ${(insight.markers || []).map(m => `
      <div class="mk">
        <p class="mk-h">${h(m.test_name)}</p>
        <p class="mk-w">${h(m.what_it_is || '')}</p>
        <p>${h(m.diet_change || '')}</p>
        ${m.timeframe ? `<p class="mk-t">${h(m.timeframe)}</p>` : ''}
      </div>`).join('')}
    ${(insight.meal_ideas || []).length ? `
      <h3>Meal ideas</h3>
      ${insight.meal_ideas.map(m => `
        <div class="meal"><b>${h(m.meal)}</b> &mdash; ${h(m.idea)}
        ${m.why ? `<span class="why">${h(m.why)}</span>` : ''}</div>`).join('')}` : ''}
    ${(insight.raise_with_doctor || []).length ? `
      <p class="doc"><b>Raise with their doctor:</b> ${h(insight.raise_with_doctor.join(', '))}</p>` : ''}
    <p class="caveat">${h(insight.caveat || '')}</p>` : '';

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${h(memberName)} — lab results</title>
<style>
  @page { margin: 16mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c1b18; margin: 0; }
  header { border-bottom: 2px solid #C9A227; padding-bottom: 8px; margin-bottom: 16px; }
  h1 { font-size: 19pt; margin: 0 0 2px; }
  .sub { color: #6b6a64; font-size: 9.5pt; margin: 0; }
  h2 { font-size: 13pt; margin: 22px 0 8px; color: #8C6D37; border-bottom: 0.5pt solid #ddd; padding-bottom: 3px; }
  h3 { font-size: 11pt; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em;
       color: #6b6a64; border-bottom: 0.5pt solid #C9A227; padding: 4px 6px; }
  td { padding: 4px 6px; border-bottom: 0.3pt solid #eee; font-size: 10pt; }
  td.n, th.n { text-align: right; }
  tr.flag td { background: #fdf6e6; }
  .cmp, .mk { margin-bottom: 10px; padding-bottom: 8px; border-bottom: 0.3pt solid #eee; }
  .cmp-h { margin: 0; } .dir { color: #8C6D37; font-size: 9pt; margin-left: 6px; }
  .cmp-s, .mk-t { margin: 1px 0; font-size: 9pt; color: #6b6a64; }
  .cmp-c, .mk-w { margin: 3px 0; font-size: 9.5pt; color: #4a4944; }
  .mk-h { margin: 0 0 2px; font-weight: 600; color: #8C6D37; }
  .meal { margin-bottom: 6px; font-size: 10pt; }
  .why { color: #8C6D37; font-size: 9pt; margin-left: 5px; }
  .lead { font-size: 10.5pt; }
  .doc { background: #fdf6e6; padding: 7px 9px; border-radius: 4px; font-size: 10pt; }
  .caveat { font-size: 8.5pt; color: #6b6a64; line-height: 1.45; margin-top: 8px; }
  footer { margin-top: 20px; padding-top: 8px; border-top: 0.5pt solid #ddd;
           font-size: 8.5pt; color: #6b6a64; }
  @media print { .noprint { display: none; } }
</style></head><body>
<header>
  <h1>${h(memberName)}</h1>
  <p class="sub">Lab results${dates.length ? ` &middot; ${dates.length} test date${dates.length > 1 ? 's' : ''}` : ''}
     &middot; generated ${h(fmtDate(today()))}</p>
</header>
<h2>Results</h2>
${panels || '<p>No results recorded.</p>'}
${changes}
${analysis}
<footer>
  FitLife. Values as entered from the member's lab report. Reference ranges are those printed by the
  testing laboratory. This document does not diagnose or interpret any result &mdash; discuss anything
  outside range with the doctor who ordered the test.
</footer>
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return false;          // popup blocked — caller tells the user
  win.document.write(html);
  win.document.close();
  return true;
}
