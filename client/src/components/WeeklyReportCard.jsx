/**
 * WeeklyReportCard — the Sunday review, at the top of the Progress tab.
 *
 * Renders the latest weekly_report: weight + week delta, the goal projection,
 * four stat tiles, the win-of-the-week banner, and the coach's note. "Share"
 * draws the same content onto a 1080×1350 branded canvas (charcoal + gold, FL
 * monogram) and hands it to the system share sheet — every forwarded week is
 * a real result with the FitLife mark on it.
 *
 * Fails silent and renders nothing when there's no report yet — Progress must
 * never break over this card. Numbers come straight from data JSONB; nothing
 * is recomputed client-side, so the card and the push always agree.
 */
import { useEffect, useState } from 'react';
import api from '../api/client';
import { haptic } from '../store/settingsStore';

const GOLD = '#D4AF37', BG = '#121316', CARD = '#1A1C20', MUT = '#9EA3B0', FAINT = '#7E8596';

const fmtDate = (iso) => new Date(iso + 'T00:00:00Z')
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtAround = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  const part = day <= 10 ? 'early' : day <= 20 ? 'mid' : 'late';
  return `${part} ${d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}`;
};

export default function WeeklyReportCard() {
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    api.get('/members/me/weekly-report').then(({ data }) => {
      setReport(data.latest || null);
      setHistory(data.history || []);
    }).catch(() => {});
  }, []);

  if (!report) return null;
  const d = report.data || {};
  const isNew = (Date.now() - new Date(report.created_at).getTime()) < 2 * 86400e3;

  const share = async () => {
    setSharing(true); haptic(15);
    try {
      const blob = await renderShareImage(d, report.coach_note);
      const file = new File([blob], 'fitlife-week.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My week with FitLife' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'fitlife-week.png'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch { /* member cancelled the sheet — not an error */ }
    setSharing(false);
  };

  const tiles = [
    [`${d.daysLogged ?? 0}/7`, 'DAYS LOGGED'],
    [d.avgKcal != null ? String(d.avgKcal) : '—', `AVG KCAL${d.kcalTarget ? ` · TARGET ${d.kcalTarget}` : ''}`],
    [d.avgPro != null ? `${d.avgPro} g` : '—', `AVG PROTEIN${d.proTarget ? ` · TARGET ${d.proTarget}` : ''}`],
    [`${d.workoutDays ?? 0} + ${d.cardioCount ?? 0}`, 'WORKOUTS + CARDIO'],
  ];

  return (
    <div className="rounded-2xl border border-[rgba(212,175,55,0.3)] bg-[#1A1C20] p-4 mb-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-bold text-[#D4AF37]">
          Your week · {fmtDate(report.week_start)}–{fmtDate(report.week_end)}
        </p>
        {isNew && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#D4AF37] text-[#121316]">NEW</span>}
      </div>

      {d.latestWeight != null && (
        <div className="flex items-baseline gap-2.5 mt-2">
          <span className="text-[30px] font-bold text-white" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
            {d.latestWeight} kg
          </span>
          {d.weekDelta != null && (
            <span className={`text-sm font-semibold ${d.weekDelta < 0 ? 'text-emerald-400' : d.weekDelta > 0 ? 'text-amber-400' : 'text-[#9EA3B0]'}`}>
              {d.weekDelta < 0 ? '▼' : d.weekDelta > 0 ? '▲' : '—'} {Math.abs(d.weekDelta)} this week
            </span>
          )}
        </div>
      )}
      {(d.totalDelta != null || d.projectedDate) && (
        <p className="text-[11.5px] text-[#9EA3B0] mt-0.5 mb-3">
          {d.totalDelta != null && `${Math.abs(d.totalDelta)} kg ${d.totalDelta >= 0 ? 'down' : 'up'} since starting`}
          {d.totalDelta != null && d.projectedDate && ' · '}
          {d.projectedDate && <>on current pace, {d.targetWeight} kg lands around <span className="text-[#D4AF37]">{fmtAround(d.projectedDate)}</span></>}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 mb-3">
        {tiles.map(([v, l]) => (
          <div key={l} className="bg-[#121316] rounded-xl px-3 py-2.5">
            <p className="text-[16px] font-bold text-white leading-tight">{v}</p>
            <p className="text-[9px] font-bold tracking-wider text-[#7E8596] mt-0.5">{l}</p>
          </div>
        ))}
      </div>

      {d.win && (
        <div className="rounded-xl border border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.08)] px-3 py-2 mb-3">
          <p className="text-[12px] text-[#D4AF37]">🎉 Win of the week: {d.win}</p>
        </div>
      )}

      {report.coach_note && (
        <div className="mb-3">
          <p className="text-[9px] font-bold text-[#7E8596] mb-1">From your coach</p>
          <p className="text-[13px] text-[#EDEDF0] leading-relaxed italic"
             style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
            "{report.coach_note}"
          </p>
        </div>
      )}

      <button onClick={share} disabled={sharing}
        style={{ minHeight: 42 }}
        className="w-full rounded-full border border-[rgba(212,175,55,0.4)] text-[#D4AF37] text-xs font-bold active:scale-[0.98] transition-transform">
        {sharing ? 'Preparing…' : '↗ Share your week'}
      </button>

      {history.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-white/[0.06]">
          <p className="text-[9px] font-bold tracking-wider text-[#7E8596] mb-1.5">Previous weeks</p>
          {history.slice(0, 4).map(h => (
            <div key={h.week_start} className="flex justify-between py-0.5">
              <span className="text-[11px] text-[#9EA3B0]">{fmtDate(h.week_start)}–{fmtDate(h.week_end)}</span>
              <span className="text-[11px] text-[#9EA3B0]">
                {h.weekDelta != null ? `${h.weekDelta > 0 ? '+' : ''}${h.weekDelta} kg · ` : ''}{h.daysLogged ?? 0}/7 logged
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Share image: 1080×1350 branded canvas ────────────────────────────────────
async function renderShareImage(d, note) {
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const serif = '"Fraunces", Georgia, serif';
  const sans = '"Outfit", system-ui, sans-serif';
  try { await document.fonts?.ready; } catch { /* draw with fallbacks */ }

  x.fillStyle = BG; x.fillRect(0, 0, W, H);

  // FL monogram
  x.fillStyle = GOLD; x.beginPath(); x.arc(W / 2, 150, 64, 0, 7); x.fill();
  x.fillStyle = BG; x.font = `bold 56px ${serif}`; x.textAlign = 'center';
  x.fillText('FL', W / 2, 170);

  x.fillStyle = GOLD; x.font = `bold 30px ${sans}`;
  x.fillText('M Y   W E E K   W I T H   F I T L I F E', W / 2, 280);
  x.fillStyle = FAINT; x.font = `26px ${sans}`;
  x.fillText(`${fmtDate(d.weekStart)} – ${fmtDate(d.weekEnd)}`, W / 2, 322);

  if (d.latestWeight != null) {
    x.fillStyle = '#FFFFFF'; x.font = `bold 130px ${serif}`;
    x.fillText(`${d.latestWeight} kg`, W / 2, 500);
    if (d.weekDelta != null) {
      x.fillStyle = d.weekDelta < 0 ? '#5DCAA5' : d.weekDelta > 0 ? '#EF9F27' : MUT;
      x.font = `bold 40px ${sans}`;
      x.fillText(`${d.weekDelta < 0 ? '▼' : d.weekDelta > 0 ? '▲' : '—'} ${Math.abs(d.weekDelta)} kg this week`, W / 2, 570);
    }
    if (d.totalDelta != null && d.totalDelta > 0) {
      x.fillStyle = MUT; x.font = `32px ${sans}`;
      x.fillText(`${d.totalDelta} kg down since starting`, W / 2, 625);
    }
  }

  const tiles = [
    [`${d.daysLogged ?? 0}/7`, 'DAYS LOGGED'],
    [d.avgKcal != null ? `${d.avgKcal}` : '—', 'AVG KCAL'],
    [d.avgPro != null ? `${d.avgPro} g` : '—', 'AVG PROTEIN'],
    [`${d.workoutDays ?? 0}+${d.cardioCount ?? 0}`, 'TRAINING'],
  ];
  const tw = 225, th = 150, gap = 24, x0 = (W - (tw * 4 + gap * 3)) / 2, y0 = 690;
  tiles.forEach(([v, l], i) => {
    const tx = x0 + i * (tw + gap);
    x.fillStyle = CARD; roundRect(x, tx, y0, tw, th, 20); x.fill();
    x.fillStyle = '#FFFFFF'; x.font = `bold 46px ${sans}`; x.fillText(v, tx + tw / 2, y0 + 75);
    x.fillStyle = FAINT; x.font = `bold 19px ${sans}`; x.fillText(l, tx + tw / 2, y0 + 118);
  });

  let y = 940;
  if (d.win) {
    x.strokeStyle = 'rgba(212,175,55,0.5)'; x.lineWidth = 2;
    x.fillStyle = 'rgba(212,175,55,0.08)';
    roundRect(x, 90, y, W - 180, 90, 18); x.fill(); x.stroke();
    x.fillStyle = GOLD; x.font = `30px ${sans}`;
    x.fillText(`🎉 ${clip(x, d.win, W - 260)}`, W / 2, y + 57);
    y += 140;
  }

  if (note) {
    x.fillStyle = FAINT; x.font = `bold 22px ${sans}`;
    x.fillText('F R O M   M Y   C O A C H', W / 2, y + 10);
    x.fillStyle = '#EDEDF0'; x.font = `italic 33px ${serif}`;
    wrapText(x, `"${note}"`, W / 2, y + 65, W - 200, 46, 3);
  }

  x.fillStyle = FAINT; x.font = `26px ${sans}`;
  x.fillText('fitness.upscale-app.com', W / 2, H - 60);

  return new Promise(res => cv.toBlob(res, 'image/png'));
}

function roundRect(x, px, py, w, h, r) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}
function clip(x, text, maxW) {
  let t = text;
  while (t.length > 4 && x.measureText(t).width > maxW) t = t.slice(0, -4) + '…';
  return t;
}
function wrapText(x, text, cx, cy, maxW, lh, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (x.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{2}$/, '…');
  }
  lines.forEach((l, i) => x.fillText(l, cx, cy + i * lh));
}
