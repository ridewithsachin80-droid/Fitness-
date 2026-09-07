import { useState } from 'react';
import { Icon, ICON_NAMES, Eyebrow, Pressable, HeroNumber, Segmented, Sheet, Stagger, EmptyState, Skeleton, SkeletonText, SkeletonCard } from '../components/primitives';
import { Card } from '../components/UI';

/**
 * /dev/kit — the primitive kit on one page. DEVELOPMENT ONLY.
 *
 * Routed from App.jsx behind `import.meta.env.DEV`, so Vite removes it from
 * the production bundle entirely. Run `npm run dev` in client/ and open
 * http://localhost:5173/dev/kit on the phone (same Wi-Fi) to see every
 * primitive with real touch.
 */
export default function DevKit() {
  const [tab, setTab] = useState('7');
  const [weight, setWeight] = useState(82.4);
  const [kcal, setKcal] = useState(1240);
  const [sheet, setSheet] = useState(null);
  const [rows, setRows] = useState(['07:10  Weight 82.4 kg', '08:30  Idli ×3 · sambar · 320 kcal', '09:00  Morning walk ✓']);

  return (
    <div className="min-h-screen bg-charcoal text-white px-4 py-6 max-w-md mx-auto space-y-6">
      <div>
        <Eyebrow tone="gold">Sprint 0 · primitive kit</Eyebrow>
        <h1 className="font-display text-2xl font-medium mt-1">Building blocks</h1>
      </div>

      <Card>
        <Eyebrow className="mb-2">HeroNumber</Eyebrow>
        <div className="space-y-4">
          <HeroNumber value={weight} unit="kg" delta={-0.3} deltaUnit="" label="vs yesterday" />
          <HeroNumber value={kcal} of={1800} unit="kcal" size="md" label="eaten today" />
          <HeroNumber value="—" unit="kg" size="sm" placeholder label="Tap to log" />
        </div>
        <div className="flex gap-2 mt-4">
          <Pressable variant="secondary" onPress={() => setWeight(w => +(w - 0.4).toFixed(1))}>−0.4 kg</Pressable>
          <Pressable variant="secondary" onPress={() => setKcal(k => k + 320)}>+320 kcal</Pressable>
        </div>
      </Card>

      <Card>
        <Eyebrow className="mb-2">Segmented</Eyebrow>
        <Segmented value={tab} onChange={setTab}
          options={[{ id: '7', label: '7d' }, { id: '30', label: '30d' }, { id: '90', label: '90d', count: 3 }]} />
        <Segmented size="sm" className="mt-3" name="coach-tabs" value={tab} onChange={setTab}
          options={[{ id: '7', label: 'Today' }, { id: '30', label: 'Nutrition' }, { id: '90', label: 'Training' }, { id: 'x', label: 'Labs' }]} />
      </Card>

      <Card>
        <Eyebrow className="mb-2">Pressable</Eyebrow>
        <div className="flex flex-wrap gap-2">
          <Pressable variant="primary">Save</Pressable>
          <Pressable variant="secondary">Cancel</Pressable>
          <Pressable variant="ghost"><Icon name="close" /></Pressable>
          <Pressable variant="danger">Remove</Pressable>
          <Pressable variant="gold-text">Done</Pressable>
          <Pressable variant="primary" disabled>Disabled</Pressable>
        </div>
      </Card>

      <Card>
        <Eyebrow className="mb-2">Sheet</Eyebrow>
        <div className="flex gap-2">
          <Pressable variant="primary" onPress={() => setSheet('weight')}>Weight sheet</Pressable>
          <Pressable variant="secondary" onPress={() => setSheet('long')}>Long sheet</Pressable>
        </div>
      </Card>

      <Card>
        <Eyebrow className="mb-2">Stagger</Eyebrow>
        <Stagger className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={r} className="rounded-xl bg-white/[0.04] border border-hair px-3 py-2 text-sm">{r}</div>
          ))}
        </Stagger>
        <Pressable variant="secondary" className="mt-3" onPress={() => setRows(r => [...r, `${10 + r.length}:00  Water +500ml`])}>Add row</Pressable>
      </Card>

      <Card>
        <Eyebrow className="mb-2">EmptyState</Eyebrow>
        <EmptyState icon="food" title="Nothing logged yet"
          body="Tell me about breakfast and I'll fill this in."
          action={{ label: 'Log with AI', onPress: () => setSheet('weight') }} />
        <EmptyState compact icon="moon" title="Sleep times not set" body="Kal raat kab soye the?" />
      </Card>

      <Card>
        <Eyebrow className="mb-2">Skeleton</Eyebrow>
        <SkeletonText lines={3} />
        <SkeletonCard className="mt-3" />
      </Card>

      <Card>
        <Eyebrow className="mb-2">Icon · {ICON_NAMES.length}</Eyebrow>
        <div className="grid grid-cols-6 gap-3 text-mid">
          {ICON_NAMES.map(n => (
            <div key={n} className="flex flex-col items-center gap-1">
              <Icon name={n} size={22} />
              <span className="text-tiny text-lo truncate max-w-full">{n}</span>
            </div>
          ))}
        </div>
      </Card>

      <Sheet open={sheet === 'weight'} onClose={() => setSheet(null)} eyebrow="Morning weight" title="After washroom, before food"
        footer={<Pressable variant="primary" className="w-full" onPress={() => setSheet(null)}>Done</Pressable>}>
        <input type="number" inputMode="decimal" placeholder="e.g. 82.4" defaultValue={weight}
          className="w-full text-num font-display font-semibold text-center rounded-2xl px-3 py-3" style={{ minHeight: 56 }} />
      </Sheet>

      <Sheet open={sheet === 'long'} onClose={() => setSheet(null)} title="Nutrition · 19 of 31 targets">
        <div className="space-y-2">
          {Array.from({ length: 30 }).map((_, i) => (
            <div key={i} className="flex justify-between text-sm py-2 border-b border-hair"><span className="text-mid">Nutrient {i + 1}</span><span className="tabular-nums">{40 + i * 2}%</span></div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
