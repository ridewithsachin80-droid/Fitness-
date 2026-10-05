import { useEffect, useState } from 'react';
import { Sheet, Pressable, Icon } from '../primitives';
import api from '../../api/client';
import { haptic } from '../../store/settingsStore';
import { clock, itemKcal } from '../../lib/day';
import { downscaleImage } from '../../utils/downscaleImage';

/**
 * PlatePhotoSheet — Phase 3: the plate photo checked against the planned meal.
 *
 * Opened from the Next up card with a photo. Sends it to /api/plate/check,
 * then shows each planned item as planned / less / more / not in the photo,
 * and anything not in the plan as an extra. The member can change grams and
 * untick before logging, exactly like Log as planned.
 *
 * If the plate is clearly a different meal it says so, and offers: log it as
 * an extra snack, log it as this meal instead of the plan, or retake.
 *
 * Food is written through the same update('food', …) as every other entry.
 * The confirm call afterwards only tells the coach's feed what was logged;
 * if it fails, the food is still logged.
 */
const STATUS = {
  as_planned: { icon: 'check',   tone: 'text-gold',       text: (r) => `As planned · about ${r.grams} g` },
  less:       { icon: 'minus',   tone: 'text-gold-light', text: (r) => `About ${r.grams} g · plan says ${r.planned_grams} g` },
  more:       { icon: 'plus',    tone: 'text-gold-light', text: (r) => `About ${r.grams} g · plan says ${r.planned_grams} g` },
  not_seen:   { icon: 'info',    tone: 'text-mid',        text: () => 'Not in the photo. Did you have it?' },
};
const EXTRA_FLAG_KCAL = 100;   // same as services/platePhoto.js

export default function PlatePhotoSheet({ job, onClose, onRetake, m }) {
  const { log, update, terms } = m;
  const kcalWord = terms?.kcal || 'kcal';
  const [state, setState] = useState('idle');      // idle | checking | result | error
  const [res, setRes]     = useState(null);
  const [error, setError] = useState('');
  const [choices, setChoices] = useState({});      // key -> { on, grams }
  // The member's own photo, shown from the phone (no download needed).
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!job?.file || typeof URL === 'undefined' || !URL.createObjectURL) { setPreview(null); return undefined; }
    const u = URL.createObjectURL(job.file);
    setPreview(u);
    return () => { try { URL.revokeObjectURL(u); } catch (_) {} };
  }, [job]);

  useEffect(() => {
    if (!job) return undefined;
    let live = true;
    setState('checking'); setRes(null); setError('');
    (async () => {
      try {
        const image = await downscaleImage(job.file);
        const { data } = await api.post('/plate/check', { image, mimeType: 'image/jpeg', meal: job.meal.meal });
        if (!live) return;
        const init = {};
        data.planned.forEach((r, i) => { init[`p${i}`] = { on: r.status !== 'not_seen', grams: String(r.grams) }; });
        data.extras.forEach((r, i) => { init[`x${i}`] = { on: true, grams: String(r.grams) }; });
        setChoices(init); setRes(data); setState('result');
      } catch (err) {
        if (!live) return;
        setError(err.response?.data?.error || "I couldn't check that photo. Check your connection, or log the meal as planned.");
        setState('error');
      }
    })();
    return () => { live = false; };
  }, [job]);

  if (!job) return <Sheet open={false} onClose={onClose} title="" />;
  const set = (k, patch) => setChoices(c => ({ ...c, [k]: { ...c[k], ...patch } }));
  const g = (k) => Math.min(2000, parseFloat(choices[k]?.grams));

  // What would be logged, for a given way of logging it.
  const rowsFor = (as) => {
    if (!res) return [];
    const slot = as === 'extra' ? 'Snack' : res.meal;
    const out = [];
    res.planned.forEach((r, i) => {
      const k = `p${i}`;
      if (as === 'meal' && choices[k]?.on && g(k) > 0) out.push({ name: r.name, grams: g(k), meal: slot, per_100g: r.per_100g, kind: 'planned' });
    });
    res.extras.forEach((r, i) => {
      const k = `x${i}`;
      if (choices[k]?.on && g(k) > 0) out.push({ name: r.name, grams: g(k), meal: slot, per_100g: r.per_100g, kind: 'extra' });
    });
    return out;
  };
  const kcal = (rows) => rows.reduce((a, r) => a + itemKcal(r), 0);

  const save = (as) => {
    const rows = rowsFor(as);
    if (!rows.length) return;
    const stamp = Date.now();
    update('food', [...(log.food || []), ...rows.map(({ kind, ...r }, i) => ({ id: `plate-${stamp}-${i}`, food_id: null, ...r }))]);
    api.post(`/plate/${res.photo_id}/confirm`, { as, items: rows }).catch(() => {});
    haptic(30);
    onClose();
  };

  const mealRows = rowsFor('meal');
  const extrasKcal = res ? res.extras.reduce((a, r, i) => a + (choices[`x${i}`]?.on && g(`x${i}`) > 0 ? itemKcal({ grams: g(`x${i}`), per_100g: r.per_100g }) : 0), 0) : 0;
  const title = `${job.meal.time ? `${clock(job.meal.time)} · ` : ''}${job.meal.meal}`;

  // A plain function, not a component: a component defined inside render is a
  // new type every render, so React would remount the grams box on each key
  // press and the keyboard would close.
  const row = ({ k, name, sub, tone, icon, extra }) => {
    const c = choices[k] || { on: true, grams: '' };
    return (
      <div key={k} className="flex items-center gap-3 rounded-2xl bg-charcoal px-3 py-2" style={{ minHeight: 56 }} data-testid={extra ? 'plate-extra' : 'plate-planned'}>
        <label className="flex items-center gap-3 flex-1 min-w-0">
          <input type="checkbox" checked={c.on} onChange={e => set(k, { on: e.target.checked })} className="w-6 h-6 accent-gold flex-shrink-0" aria-label={`${name}: eaten`} />
          <span className="min-w-0">
            <span className={`flex items-center gap-1.5 text-sm ${c.on ? 'text-white' : 'text-lo'}`}>
              <Icon name={icon} size={14} className={`${tone} flex-shrink-0`} />{name}
            </span>
            <span className={`block text-caption ${extra ? 'text-amber-300' : 'text-mid'}`}>{sub}</span>
          </span>
        </label>
        <input type="number" inputMode="decimal" min="0" max="2000" value={c.grams} disabled={!c.on} aria-label={`${name} grams`}
          onChange={e => set(k, { grams: e.target.value })} style={{ minHeight: 44, width: 72 }}
          className="text-right text-base font-semibold rounded-xl px-2.5 border border-white/[0.12] bg-transparent text-white tabular-nums disabled:opacity-40" />
        <span className="text-caption text-mid">g</span>
      </div>
    );
  };

  const retake = (
    <label className="w-full flex items-center justify-center gap-2 rounded-2xl border border-white/[0.12] text-sm font-semibold text-white cursor-pointer" style={{ minHeight: 46 }}>
      <Icon name="camera" size={16} /> Retake photo
      <input type="file" accept="image/*" capture="environment" className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onRetake(job.meal, f); }} />
    </label>
  );

  let body, footer = null;
  if (state === 'checking') {
    body = <p className="text-sm text-mid py-6 text-center" data-testid="plate-checking">Checking your plate against {job.meal.meal}…</p>;
  } else if (state === 'error') {
    body = (
      <div className="space-y-3" data-testid="plate-error">
        <p className="text-sm text-white leading-relaxed">{error}</p>
        {retake}
      </div>
    );
  } else if (state === 'result' && res.matches) {
    body = (
      <div className="space-y-2" data-testid="plate-result">
        <p className="text-caption text-mid">Matched to your plan. Amounts are estimates: change any that look wrong.</p>
        {res.planned.map((r, i) => {
          const s = STATUS[r.status] || STATUS.as_planned;
          return row({ k: `p${i}`, name: r.name, sub: s.text(r), tone: s.tone, icon: s.icon });
        })}
        {res.extras.map((r, i) => (
          row({ k: `x${i}`, name: r.name, extra: true, icon: 'plus', tone: 'text-amber-300', sub: `Not in your plan · ${r.kcal} ${kcalWord}` })
        ))}
        {extrasKcal > EXTRA_FLAG_KCAL && <p className="text-caption text-mid pt-1" data-testid="plate-coach-note">Your coach will see the extras.</p>}
        {res.photo_saved && <p className="text-caption text-lo pt-1">Only you and your coach can see this photo.</p>}
      </div>
    );
    footer = (
      <Pressable variant="primary" className="w-full" disabled={!mealRows.length} onPress={() => save('meal')} data-testid="plate-save">
        {mealRows.length ? `Log this · ${kcal(mealRows).toLocaleString('en-IN')} ${kcalWord}` : 'Nothing ticked'}
      </Pressable>
    );
  } else if (state === 'result') {
    const plate = rowsFor('extra');
    body = (
      <div className="space-y-2" data-testid="plate-mismatch">
        <p className="text-sm font-semibold text-white">This doesn&rsquo;t look like {res.meal}</p>
        <p className="text-caption text-mid leading-relaxed">
          {res.meal} is {res.planned.map(p => p.name.toLowerCase()).join(', ')}. Here&rsquo;s what I can see:
        </p>
        {res.extras.map((r, i) => (
          row({ k: `x${i}`, name: r.name, extra: true, icon: 'plus', tone: 'text-amber-300', sub: `About ${r.grams} g · ${r.kcal} ${kcalWord}` })
        ))}
        <Pressable variant="primary" className="w-full" disabled={!plate.length} onPress={() => save('extra')} data-testid="plate-as-extra">
          Log as an extra snack · {kcal(plate).toLocaleString('en-IN')} {kcalWord}
        </Pressable>
        <Pressable variant="secondary" className="w-full" disabled={!plate.length} onPress={() => save('swap')} data-testid="plate-as-swap">
          This was {res.meal} instead of the plan
        </Pressable>
        {retake}
        <p className="text-caption text-lo text-center">Either way, your coach sees what you ate. {res.meal} stays on your plan.</p>
      </div>
    );
  }

  return (
    <Sheet open onClose={onClose} eyebrow="Your plate" title={title} footer={footer}>
      {preview && <img src={preview} alt="Your plate" className="w-full max-h-48 object-cover rounded-2xl mb-3" data-testid="plate-preview" />}
      {body}
    </Sheet>
  );
}
