import { useEffect, useState } from 'react';
import { Sheet, Pressable } from '../primitives';
import api from '../../api/client';
import { haptic } from '../../store/settingsStore';

/**
 * GrocerySheet — Phase 5: the week's shopping list from the diet plan in
 * force, with a tick box per item (remembered on this phone for this plan
 * version) and the prep list. Amounts are for seven days, as eaten.
 */
const amount = (g) => (g >= 1000 ? `${Math.round(g / 100) / 10} kg` : `${Math.round(g)} g`);
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function groceryText(data) {
  const lines = [`Grocery list${data?.plan?.title ? ` — ${data.plan.title}` : ''} (7 days, as eaten)`];
  for (const it of data?.items || []) lines.push(`- ${it.name}: ${amount(it.grams)}`);
  return lines.join('\n');
}

export default function GrocerySheet({ open, onClose }) {
  const [data, setData] = useState(null);
  const [ticked, setTicked] = useState({});
  const [note, setNote] = useState('');
  const key = data?.plan ? `fitlife-grocery-${data.plan.id}-v${data.plan.version}` : null;

  useEffect(() => {
    if (!open) return;
    setNote('');
    api.get('/diet-plans/me/grocery').then(({ data }) => {
      setData(data);
      try { setTicked(JSON.parse(localStorage.getItem(`fitlife-grocery-${data.plan?.id}-v${data.plan?.version}`) || '{}')); } catch (_) { setTicked({}); }
    }).catch(() => setData({ items: [], error: true }));
  }, [open]);

  const toggle = (name) => setTicked(t => {
    const n = { ...t, [name]: !t[name] };
    try { if (key) localStorage.setItem(key, JSON.stringify(n)); } catch (_) {}
    return n;
  });
  const share = async () => {
    haptic(10);
    const text = groceryText(data);
    try {
      if (navigator.share) { await navigator.share({ title: 'Grocery list', text }); return; }
      await navigator.clipboard.writeText(text); setNote('Copied. Paste it into WhatsApp or notes.');
    } catch (e) { if (e?.name !== 'AbortError') setNote('Could not share from this phone.'); }
  };

  const items = data?.items || [];
  const left = items.filter(i => !ticked[i.name]).length;
  return (
    <Sheet open={open} onClose={onClose} eyebrow="Diet plan" title="Grocery list"
      footer={items.length ? <Pressable variant="primary" className="w-full" onPress={share} data-testid="grocery-share">Share the list</Pressable> : null}>
      {!data ? <p className="text-sm text-mid">Loading…</p>
        : data.error ? <p className="text-sm text-mid">Could not load the list.</p>
        : !items.length ? <p className="text-sm text-mid" data-testid="grocery-empty">No diet plan yet, so no list.</p> : (
        <div data-testid="grocery-list">
          <p className="text-caption text-mid mb-2">For seven days, as eaten (cooked weight). Raw rice and dal weigh roughly a third to half of cooked: buy a little extra. {left ? `${left} to buy.` : 'All ticked.'}</p>
          <ul className="space-y-1">
            {items.map(it => (
              <li key={it.name}>
                <label className="flex items-center gap-3 rounded-xl bg-charcoal px-3" style={{ minHeight: 48 }}>
                  <input type="checkbox" checked={!!ticked[it.name]} onChange={() => toggle(it.name)} className="w-5 h-5 accent-gold flex-shrink-0" />
                  <span className={`flex-1 min-w-0 text-sm ${ticked[it.name] ? 'text-lo line-through' : 'text-white'}`}>{it.name}</span>
                  <span className="text-sm font-semibold text-white tabular-nums">{amount(it.grams)}</span>
                </label>
              </li>
            ))}
          </ul>
          {note && <p className="text-caption text-mid mt-2" data-testid="grocery-note">{note}</p>}
          {data.prep && (data.prep.byDay || []).some(d => d.length) && (
            <div className="mt-4" data-testid="prep-list">
              <p className="text-caption font-semibold uppercase tracking-wider text-lo mb-1">Prep by day</p>
              {data.prep.byDay.map((list, w) => list.length ? (
                <p key={w} className="text-caption text-white leading-relaxed"><span className="text-mid font-semibold">{DAYS[w]}:</span> {list.join('; ')}</p>
              ) : null)}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
