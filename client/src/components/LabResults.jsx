/**
 * LabResults.jsx — member-entered blood work, and what changed alongside it.
 *
 * Two modes:
 *   member (no patientId) — add results, see their own history and trends
 *   coach  (patientId)    — read-only view of the same analysis
 *
 * The framing is the important part. Between two blood tests a member changes
 * diet, supplements, training, weight and sleep at once, and the testing lab
 * may differ too. So this shows what changed ALONGSIDE a result and never
 * suggests what caused it, and it reports abnormal values without interpreting
 * them — that conversation belongs with the doctor who ordered the test.
 */

import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { exportLabsCSV, exportComparisonsCSV, printLabReport } from '../utils/labExport';

const COMMON = [
  { name: 'HbA1c',        unit: '%',      min: 4,   max: 5.6 },
  { name: 'Fasting Glucose', unit: 'mg/dL', min: 70, max: 99 },
  { name: 'Vitamin D',    unit: 'ng/mL',  min: 30,  max: 100 },
  { name: 'Vitamin B12',  unit: 'pg/mL',  min: 200, max: 900 },
  { name: 'Haemoglobin',  unit: 'g/dL',   min: 13,  max: 17 },
  { name: 'Ferritin',     unit: 'ng/mL',  min: 30,  max: 400 },
  { name: 'Total Cholesterol', unit: 'mg/dL', min: 0, max: 200 },
  { name: 'HDL',          unit: 'mg/dL',  min: 40,  max: 60 },
  { name: 'LDL',          unit: 'mg/dL',  min: 0,   max: 100 },
  { name: 'Triglycerides', unit: 'mg/dL', min: 0,   max: 150 },
  { name: 'ALT',          unit: 'U/L',    min: 7,   max: 40 },
  { name: 'TSH',          unit: 'mIU/L',  min: 0.4, max: 4.0 },
];

const STATE_STYLE = {
  low:    'text-amber-300 bg-amber-400/10 border-amber-400/30',
  high:   'text-amber-300 bg-amber-400/10 border-amber-400/30',
  normal: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30',
};

export default function LabResults({ patientId = null, memberName = '' }) {
  const isCoach = !!patientId;
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding]   = useState(false);
  const [saving, setSaving]   = useState(false);
  const [notice, setNotice]   = useState(null);
  const [insight, setInsight] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [rawLabs, setRawLabs]   = useState([]);
  const [exportMsg, setExportMsg] = useState(null);
  const [error, setError]     = useState(null);

  const [testDate, setTestDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [labName, setLabName]   = useState('');
  const [rows, setRows]         = useState([{ test_name: '', value: '', unit: '', ref_min: '', ref_max: '' }]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [analysis, raw] = await Promise.all([
        api.get(isCoach ? `/patients/${patientId}/lab-analysis` : '/patients/me/lab-analysis'),
        api.get(isCoach ? `/patients/${patientId}` : '/patients/me/labs'),
      ]);
      setData(analysis.data);
      // Both endpoints return the rows under `labs` — the coach one nested in
      // the member payload, the member one on its own.
      setRawLabs(raw.data.labs || []);
    } catch {
      setError('Could not load results');
    } finally { setLoading(false); }
  }, [patientId, isCoach]);

  useEffect(() => { load(); }, [load]);

  const generateInsight = async () => {
    setThinking(true); setInsight(null);
    try {
      const { data } = await api.post(`/patients/${patientId}/lab-insight`);
      setInsight(data);
    } catch (err) {
      setInsight({ error: err.response?.data?.error || 'Could not generate the analysis' });
    } finally { setThinking(false); }
  };

  const setRow = (i, field, value) =>
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  const pickCommon = (i, name) => {
    const c = COMMON.find(x => x.name === name);
    if (!c) return setRow(i, 'test_name', name);
    setRows(rs => rs.map((r, j) => (j === i
      ? { ...r, test_name: c.name, unit: c.unit, ref_min: c.min, ref_max: c.max } : r)));
  };

  const save = async () => {
    const usable = rows.filter(r => r.test_name && r.value !== '');
    if (!usable.length) { setError('Add at least one result'); return; }
    setSaving(true); setError(null);
    try {
      const { data } = await api.post('/patients/me/labs', {
        test_date: testDate, lab_name: labName || null, results: usable,
      });
      setNotice(data.notice);
      setAdding(false);
      setRows([{ test_name: '', value: '', unit: '', ref_min: '', ref_max: '' }]);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save');
    } finally { setSaving(false); }
  };

  if (loading) return <p className="text-xs text-[#7E8596] py-4 text-center">Loading…</p>;

  const comparisons = data?.comparisons || [];
  const flags = data?.out_of_range || [];

  return (
    <div>
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      {notice && (
        <div className="bg-amber-400/[0.08] border border-amber-400/30 rounded-xl px-3 py-2.5 mb-3">
          <p className="text-[11px] text-amber-200 leading-relaxed">{notice}</p>
        </div>
      )}

      {/* Out of range — stated, never interpreted */}
      {flags.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#7E8596] mb-1.5">
            Outside reference range
          </p>
          <div className="space-y-1.5">
            {flags.map((f, i) => (
              <div key={i} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${STATE_STYLE[f.state]}`}>
                <span className="text-[11px] font-bold">{f.test_name}</span>
                <span className="text-[11px]">
                  {f.value}{f.unit ? ` ${f.unit}` : ''}
                  {f.ref && <span className="text-[#7E8596]"> · ref {f.ref}</span>}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#7E8596] mt-1.5 leading-relaxed">
            Discuss anything outside range with the doctor who ordered the test.
          </p>
        </div>
      )}

      {/* Exports. Available to members too — a PDF of their own results is
          exactly what they need to hand a doctor at the next appointment. */}
      {rawLabs.length > 0 && (
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => {
              const ok = printLabReport({
                labs: rawLabs,
                comparisons: data?.comparisons || [],
                insight: isCoach ? insight : null,
                memberName: memberName || 'Member',
              });
              setExportMsg(ok ? null : 'Allow pop-ups for this site to save the PDF.');
            }}
            style={{ minHeight: 38 }}
            className="flex-1 rounded-xl text-[11px] font-bold text-[#D4AF37]
              bg-[rgba(212,175,55,0.08)] border border-[rgba(212,175,55,0.28)] active:scale-[0.98]">
            ⬇ PDF
          </button>
          <button
            onClick={() => {
              const n = exportLabsCSV(rawLabs, memberName || 'member');
              setExportMsg(`${n} results exported`);
            }}
            style={{ minHeight: 38 }}
            className="flex-1 rounded-xl text-[11px] font-bold text-[#9EA3B0]
              border border-white/[0.12] active:scale-[0.98]">
            ⬇ CSV
          </button>
          {(data?.comparisons || []).length > 0 && (
            <button
              onClick={() => {
                const n = exportComparisonsCSV(data.comparisons, memberName || 'member');
                setExportMsg(`${n} comparisons exported`);
              }}
              style={{ minHeight: 38 }}
              className="flex-1 rounded-xl text-[11px] font-bold text-[#9EA3B0]
                border border-white/[0.12] active:scale-[0.98]">
              ⬇ Changes
            </button>
          )}
        </div>
      )}
      {exportMsg && <p className="text-[10px] text-[#7E8596] mb-3">{exportMsg}</p>}

      {/* Nutritional analysis — coach only. The engine drafts, the coach decides
          what reaches the member. */}
      {isCoach && (
        <div className="mb-3">
          {!insight && (
            <button onClick={generateInsight} disabled={thinking} style={{ minHeight: 42 }}
              className="w-full rounded-xl text-xs font-bold text-[#D4AF37]
                bg-[rgba(212,175,55,0.08)] border border-[rgba(212,175,55,0.28)]
                active:scale-[0.98] disabled:opacity-60">
              {thinking ? 'Analysing…' : '🔬 Analyse this panel'}
            </button>
          )}

          {insight?.error && (
            <div>
              <p className="text-xs text-red-400 leading-relaxed">{insight.error}</p>
              {/* Showing what tripped the filter turns an opaque failure into
                  something a coach can judge for themselves. */}
              {insight.rejected_for?.length > 0 && (
                <p className="text-[10px] text-[#7E8596] mt-1">
                  Flagged: {insight.rejected_for.join(' · ')}
                </p>
              )}
              <button onClick={generateInsight} disabled={thinking}
                className="text-[11px] font-bold text-[#D4AF37] mt-1.5">
                {thinking ? 'Analysing…' : 'Try again'}
              </button>
            </div>
          )}

          {/* Urgent findings replace the analysis entirely rather than sitting
              alongside it — diet tips beside "see a doctor" dilutes the only
              message that matters. */}
          {insight && !insight.error && insight.urgent?.length > 0 && (
            <div className="bg-red-500/[0.08] border border-red-500/35 rounded-xl px-3.5 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-red-300 mb-1.5">
                Needs medical review first
              </p>
              <p className="text-[12px] text-[#FFFFFF] leading-relaxed mb-2">{insight.summary}</p>
              <div className="space-y-1 mb-2">
                {insight.urgent.map((u, i) => (
                  <div key={i} className="flex justify-between text-[11px]">
                    <span className="text-[#FFFFFF]">{u.test_name}</span>
                    <span className="text-red-300 font-bold">
                      {u.value}{u.unit ? ` ${u.unit}` : ''} · {u.why}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[#9EA3B0] leading-relaxed">{insight.note}</p>
            </div>
          )}

          {insight?.generated && (
            <div className="bg-[#121316] border border-white/[0.08] rounded-xl p-3.5">
              <p className="text-[12px] text-[#FFFFFF] leading-relaxed mb-3">{insight.summary}</p>

              {(insight.markers || []).map((m, i) => (
                <div key={i} className="mb-3 pb-3 border-b border-white/[0.06] last:border-0 last:pb-0">
                  <p className="text-[11px] font-bold text-[#D4AF37] mb-1">{m.test_name}</p>
                  <p className="text-[11px] text-[#9EA3B0] leading-relaxed mb-1">{m.what_it_is}</p>
                  <p className="text-[11px] text-[#FFFFFF] leading-relaxed">{m.diet_change}</p>
                  {m.timeframe && (
                    <p className="text-[10px] text-[#7E8596] mt-1">{m.timeframe}</p>
                  )}
                </div>
              ))}

              {/* Macro targets — computed from body weight and maintenance,
                  adjusted for what the panel showed. Shown as both grams and
                  percentages: grams are what a member shops and cooks to,
                  percentages are how a coach reads a plan at a glance. */}
              {insight.macro_targets && (
                <div className="bg-[#1A1C20] border border-[rgba(212,175,55,0.25)] rounded-xl p-3 mb-3">
                  <div className="flex items-baseline justify-between mb-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#D4AF37]">
                      Macro target
                    </p>
                    <p className="text-[13px] font-extrabold text-[#FFFFFF]">
                      {insight.macro_targets.kcal.toLocaleString()} kcal
                    </p>
                  </div>

                  {/* Proportional bar — the split is easier to judge as a
                      shape than as three numbers. */}
                  <div className="flex h-2 rounded-full overflow-hidden mb-2">
                    <div style={{ width: `${insight.macro_targets.protein_pct}%` }} className="bg-[#D4AF37]" />
                    <div style={{ width: `${insight.macro_targets.carbs_pct}%` }} className="bg-[#8C6D37]" />
                    <div style={{ width: `${insight.macro_targets.fat_pct}%` }} className="bg-[#F0E2B6]" />
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      ['Protein', insight.macro_targets.protein_g, insight.macro_targets.protein_pct, 'text-[#D4AF37]'],
                      ['Carbs',   insight.macro_targets.carbs_g,   insight.macro_targets.carbs_pct,   'text-[#C5A059]'],
                      ['Fat',     insight.macro_targets.fat_g,     insight.macro_targets.fat_pct,     'text-[#F0E2B6]'],
                    ].map(([label, g, pctv, cls]) => (
                      <div key={label}>
                        <p className={`text-sm font-extrabold ${cls}`}>{pctv}%</p>
                        <p className="text-[11px] text-[#FFFFFF]">{g}g</p>
                        <p className="text-[9px] uppercase tracking-wider text-[#7E8596]">{label}</p>
                      </div>
                    ))}
                  </div>

                  <p className="text-[10px] text-[#7E8596] mt-2">
                    {insight.macro_targets.protein_per_kg} g protein per kg body weight
                  </p>

                  {(insight.macro_targets.reasons || []).length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {insight.macro_targets.reasons.map((r, i) => (
                        <li key={i} className="text-[10px] text-[#9EA3B0] leading-relaxed">· {r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {(insight.meal_ideas || []).length > 0 && (
                <>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#7E8596] mb-1.5">
                    Meal ideas
                  </p>
                  <div className="space-y-1.5 mb-3">
                    {insight.meal_ideas.map((m, i) => (
                      <div key={i} className="bg-[#1A1C20] border border-white/[0.06] rounded-lg px-3 py-2">
                        <p className="text-[11px] font-bold text-[#FFFFFF]">{m.meal}</p>
                        <p className="text-[11px] text-[#9EA3B0] leading-relaxed">{m.idea}</p>
                        {m.why && <p className="text-[10px] text-[#D4AF37] mt-0.5">{m.why}</p>}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {(insight.raise_with_doctor || []).length > 0 && (
                <p className="text-[11px] text-amber-300 leading-relaxed mb-2">
                  Raise with their doctor: {insight.raise_with_doctor.join(', ')}
                </p>
              )}

              <p className="text-[10px] text-[#7E8596] leading-relaxed">{insight.caveat}</p>

              <button onClick={generateInsight} disabled={thinking}
                className="text-[11px] font-bold text-[#D4AF37] mt-2">
                {thinking ? 'Analysing…' : 'Regenerate'}
              </button>
            </div>
          )}

          {insight && !insight.error && !insight.generated && !insight.urgent?.length && (
            <p className="text-xs text-[#9EA3B0] leading-relaxed">{insight.summary}</p>
          )}
        </div>
      )}

      {/* Interval comparisons */}
      {comparisons.length === 0 ? (
        <p className="text-xs text-[#9EA3B0] leading-relaxed mb-3">
          No comparable pairs yet. Two results for the same marker at least 30 days
          apart are needed — most markers cannot move meaningfully faster than that.
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {comparisons.map((c, i) => (
            <div key={i} className="bg-[#121316] border border-white/[0.07] rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] font-bold text-[#FFFFFF]">{c.test_name}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                  c.direction === 'improved' ? 'text-emerald-300'
                  : c.direction === 'worsened' ? 'text-amber-300' : 'text-[#9EA3B0]'}`}>
                  {c.direction}
                </span>
              </div>
              <p className="text-[11px] text-[#9EA3B0]">
                {c.from} → <span className="text-[#FFFFFF] font-semibold">{c.to}</span>
                {c.unit ? ` ${c.unit}` : ''}
                {c.from_state && c.to_state && c.from_state !== c.to_state && (
                  <span className="text-[#D4AF37]"> · {c.from_state} → {c.to_state}</span>
                )}
                <span className="text-[#7E8596]"> · {c.interval_days} days</span>
              </p>

              {/* What was happening in that window */}
              <div className="mt-2 pt-2 border-t border-white/[0.06]">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#7E8596] mb-1">
                  During this interval
                </p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                  {c.context.mean_kcal && (
                    <><span className="text-[#7E8596]">Avg intake</span>
                      <span className="text-[#FFFFFF] text-right">{c.context.mean_kcal} kcal</span></>
                  )}
                  {c.context.mean_protein && (
                    <><span className="text-[#7E8596]">Avg protein</span>
                      <span className="text-[#FFFFFF] text-right">{c.context.mean_protein}g</span></>
                  )}
                  {c.context.weight_change != null && (
                    <><span className="text-[#7E8596]">Weight</span>
                      <span className="text-[#FFFFFF] text-right">
                        {c.context.weight_change > 0 ? '+' : ''}{c.context.weight_change} kg</span></>
                  )}
                  {c.context.training_sessions > 0 && (
                    <><span className="text-[#7E8596]">Sessions</span>
                      <span className="text-[#FFFFFF] text-right">{c.context.training_sessions}</span></>
                  )}
                  {c.context.cardio_minutes > 0 && (
                    <><span className="text-[#7E8596]">Cardio</span>
                      <span className="text-[#FFFFFF] text-right">{c.context.cardio_minutes} min</span></>
                  )}
                  <><span className="text-[#7E8596]">Days logged</span>
                    <span className={`text-right ${c.context.coverage_pct < 50 ? 'text-amber-300' : 'text-[#FFFFFF]'}`}>
                      {c.context.coverage_pct}%</span></>
                </div>

                {c.context.supplements.length > 0 && (
                  <p className="text-[10px] text-[#7E8596] mt-1.5">
                    Supplements: {c.context.supplements.slice(0, 4)
                      .map(s => `${s.id} ${s.pct}%`).join(' · ')}
                  </p>
                )}
                {c.context.coverage_pct < 50 && (
                  <p className="text-[10px] text-amber-300/90 mt-1.5 leading-relaxed">
                    Only {c.context.coverage_pct}% of this window was logged, so the figures
                    above describe a fraction of it.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Member entry */}
      {!isCoach && (
        adding ? (
          <div className="bg-[#121316] border border-white/[0.08] rounded-xl p-3">
            <div className="flex gap-2 mb-2">
              <label className="flex-1">
                <span className="block text-[9px] uppercase tracking-wider text-[#7E8596] mb-1">Test date</span>
                <input type="date" value={testDate} max={new Date().toISOString().slice(0, 10)}
                  onChange={e => setTestDate(e.target.value)} style={{ minHeight: 38 }}
                  className="w-full bg-[#1A1C20] border border-white/[0.12] rounded-lg px-2 text-xs text-[#FFFFFF]" />
              </label>
              <label className="flex-1">
                <span className="block text-[9px] uppercase tracking-wider text-[#7E8596] mb-1">Lab (optional)</span>
                <input value={labName} onChange={e => setLabName(e.target.value)} placeholder="e.g. Metropolis"
                  style={{ minHeight: 38 }}
                  className="w-full bg-[#1A1C20] border border-white/[0.12] rounded-lg px-2 text-xs text-[#FFFFFF] placeholder-[#7E8596]" />
              </label>
            </div>

            {rows.map((r, i) => (
              <div key={i} className="bg-[#1A1C20] border border-white/[0.07] rounded-lg p-2 mb-1.5">
                <div className="flex gap-1.5 mb-1.5">
                  <input list="common-labs" value={r.test_name}
                    onChange={e => pickCommon(i, e.target.value)}
                    placeholder="Test name" style={{ minHeight: 34 }}
                    className="flex-1 min-w-0 bg-[#121316] border border-white/[0.12] rounded-md px-2 text-xs text-[#FFFFFF] placeholder-[#7E8596]" />
                  <input value={r.value} onChange={e => setRow(i, 'value', e.target.value)}
                    inputMode="decimal" placeholder="Value" style={{ minHeight: 34, width: 70 }}
                    className="bg-[#121316] border border-white/[0.12] rounded-md px-2 text-xs text-center text-[#FFFFFF] placeholder-[#7E8596]" />
                  {rows.length > 1 && (
                    <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}
                      className="w-6 text-[#7E8596] hover:text-red-400 text-sm">×</button>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {[['unit', 'Unit'], ['ref_min', 'Ref min'], ['ref_max', 'Ref max']].map(([f, ph]) => (
                    <input key={f} value={r[f]} onChange={e => setRow(i, f, e.target.value)}
                      placeholder={ph} style={{ minHeight: 30 }}
                      className="flex-1 min-w-0 bg-[#121316] border border-white/[0.10] rounded-md px-2 text-[10px] text-center text-[#9EA3B0] placeholder-[#7E8596]" />
                  ))}
                </div>
              </div>
            ))}
            <datalist id="common-labs">
              {COMMON.map(c => <option key={c.name} value={c.name} />)}
            </datalist>

            <button onClick={() => setRows(rs => [...rs, { test_name: '', value: '', unit: '', ref_min: '', ref_max: '' }])}
              className="text-[11px] font-bold text-[#D4AF37] mb-2">+ Another result</button>

            <div className="flex gap-2">
              <button onClick={save} disabled={saving} style={{ minHeight: 40 }}
                className="flex-1 rounded-xl text-xs font-bold text-[#121316]
                  bg-gradient-to-r from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37] active:scale-[0.98] disabled:opacity-60">
                {saving ? 'Saving…' : 'Save results'}
              </button>
              <button onClick={() => { setAdding(false); setError(null); }} style={{ minHeight: 40 }}
                className="px-4 rounded-xl text-xs font-bold text-[#9EA3B0] border border-white/[0.10]">
                Cancel
              </button>
            </div>
            <p className="text-[10px] text-[#7E8596] mt-2 leading-relaxed">
              Reference ranges are printed on your report — entering them lets the app
              tell in-range from out-of-range. Picking a common test fills them in.
            </p>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{ minHeight: 42 }}
            className="w-full rounded-xl text-xs font-bold text-[#D4AF37]
              bg-[rgba(212,175,55,0.08)] border border-[rgba(212,175,55,0.28)] active:scale-[0.98]">
            + Add lab results
          </button>
        )
      )}

      {data?.caveat && (
        <p className="text-[10px] text-[#7E8596] mt-3 leading-relaxed">{data.caveat}</p>
      )}
    </div>
  );
}
