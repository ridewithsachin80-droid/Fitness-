/**
 * services/pdfDoc.js — a small PDF writer for the diet plan (Phase 5).
 *
 * No library: the lock files would have to change for one, and the plan
 * needs only text, lines and filled boxes on A4. Built-in PDF fonts
 * (Helvetica, Helvetica-Bold, Times-Bold), WinAnsi text. Characters outside
 * it (Kannada or Hindi script, emoji) are replaced: food names in the app are
 * written in English letters, so in practice that is only punctuation.
 *
 * Usage:
 *   const d = new PdfDoc();
 *   d.heading('Title'); d.para('Some text that wraps'); d.table(rows, cols)...
 *   const buf = d.toBuffer();
 */

// Helvetica widths (1/1000 em) for character codes 32..126, from the standard AFM.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
  667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
  278,278,278,469,556,333,
  556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,
  334,260,334,584];
const BOLD_FACTOR = 1.08;   // Helvetica-Bold runs ~5-8% wider; err wide so text never overflows

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 42;

const CHARMAP = { '\u2013': '-', '\u2014': '-', '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"',
  '\u2022': '-', '\u20B9': 'Rs ', '\u2026': '...', '\u00A0': ' ', '\u2192': '->', '\u2265': '>=', '\u2264': '<=', '\u2009': ' ' };

/** Text the built-in fonts can show: WinAnsi-safe Latin-1, everything else mapped or dropped. */
function clean(s) {
  return String(s ?? '').replace(/[\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u20B9\u2026\u00A0\u2192\u2265\u2264\u2009]/g, c => CHARMAP[c])
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '').replace(/\s+/g, ' ').trim();
}
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function widthOf(text, size, bold) {
  let w = 0;
  for (const ch of text) { const c = ch.charCodeAt(0); w += (c >= 32 && c <= 126 ? HELV[c - 32] : 556); }
  return (w / 1000) * size * (bold ? BOLD_FACTOR : 1);
}

/** Break text into lines no wider than `max` points. A word longer than a line is cut. */
function wrap(text, size, max, bold = false) {
  const words = clean(text).split(' ').filter(Boolean);
  const lines = []; let cur = '';
  for (let w of words) {
    while (widthOf(w, size, bold) > max) {           // a very long word: cut it
      let i = w.length; while (i > 1 && widthOf(w.slice(0, i), size, bold) > max) i--;
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, i)); w = w.slice(i);
    }
    const next = cur ? `${cur} ${w}` : w;
    if (widthOf(next, size, bold) <= max) cur = next; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

const rgb = (hex) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map(v => v.toFixed(3)).join(' '); };
const FONT = { regular: 'F1', bold: 'F2', serif: 'F3' };

class PdfDoc {
  constructor({ footer = '' } = {}) {
    this.pages = []; this.footer = clean(footer);
    this.newPage();
  }
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = A4.h - MARGIN; }
  ensure(h) { if (this.y - h < MARGIN + 24) this.newPage(); }

  text(x, y, s, { size = 10, font = 'regular', color = '#121316' } = {}) {
    this.ops.push(`BT /${FONT[font]} ${size} Tf ${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(clean(s))}) Tj ET`);
  }
  rect(x, y, w, h, color) { this.ops.push(`${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); }
  line(x1, y1, x2, y2, color = '#DDDDDD', width = 0.6) { this.ops.push(`${rgb(color)} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`); }

  /** Wrapped paragraph at the cursor. */
  para(s, { size = 10, font = 'regular', color = '#121316', x = MARGIN, width = A4.w - 2 * MARGIN, gap = 4, lead = 1.35 } = {}) {
    for (const l of wrap(s, size, width, font !== 'regular')) {
      this.ensure(size * lead);
      this.y -= size * lead; this.text(x, this.y + size * 0.25, l, { size, font, color });
    }
    this.y -= gap;
  }
  heading(s, { size = 13, color = '#121316' } = {}) {
    this.ensure(size * 2.6); this.y -= size * 0.9;
    this.para(s, { size, font: 'bold', color, gap: 2 });
    this.line(MARGIN, this.y, A4.w - MARGIN, this.y, '#D4AF37', 1); this.y -= 6;
  }
  space(h) { this.y -= h; }

  /**
   * Rows of cells. cols: [{ width (points), align: 'left'|'right', bold }]. A row
   * of cells that wrap; each row is kept on one page.
   */
  table(rows, cols, { size = 9.5, zebra = true, x0 = MARGIN } = {}) {
    rows.forEach((row, ri) => {
      const cells = row.map((c, i) => wrap(c, size, cols[i].width - 8, !!cols[i].bold || !!row.bold));
      const h = Math.max(...cells.map(c => c.length)) * size * 1.3 + 6;
      this.ensure(h);
      if (zebra && ri % 2 === 1) this.rect(x0, this.y - h, cols.reduce((a, c) => a + c.width, 0), h, '#F6F4EE');
      let x = x0;
      cells.forEach((lines, i) => {
        lines.forEach((l, li) => {
          const ty = this.y - 4 - (li + 1) * size * 1.3 + size * 0.3;
          const tx = cols[i].align === 'right' ? x + cols[i].width - 4 - widthOf(l, size, !!cols[i].bold || !!row.bold) : x + 4;
          this.text(tx, ty, l, { size, font: cols[i].bold || row.bold ? 'bold' : 'regular', color: row.color || cols[i].color || '#121316' });
        });
        x += cols[i].width;
      });
      this.y -= h;
    });
    this.y -= 6;
  }

  toBuffer() {
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesObj = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const f3 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    this.pages.forEach((ops, i) => {
      const foot = [];
      if (this.footer) foot.push(`BT /F1 7.5 Tf ${rgb('#8C93A3')} rg ${MARGIN} 22 Td (${esc(this.footer)}) Tj ET`);
      foot.push(`BT /F1 7.5 Tf ${rgb('#8C93A3')} rg ${(A4.w - MARGIN - 40).toFixed(2)} 22 Td (${esc(`Page ${i + 1} of ${this.pages.length}`)}) Tj ET`);
      const stream = Buffer.from([...ops, ...foot].join('\n'), 'latin1');
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream.toString('latin1')}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> >> /Contents ${content} 0 R >>`));
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}

module.exports = { PdfDoc, clean, wrap, widthOf, A4, MARGIN };
