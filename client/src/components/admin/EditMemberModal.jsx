/**
 * components/admin/EditMemberModal.jsx — moved out of pages/AdminDashboard.jsx verbatim
 * (Sprint 12c). The dashboard was 2,163 lines, 1,400 of them modals that
 * closed over nothing on the page. Each is now a file with its own imports;
 * the page imports what it renders. Behaviour unchanged.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/client';
import { adminResetPin, adminSendPush, getAuditLog, adminDeleteMember, markMessagesRead } from '../../api/logs';
import { Card, SectionTitle } from '../UI';
import { ACTIVITIES, ACV_ITEMS, SUPPLEMENTS, RDA_TARGETS, RDA_OVERRIDE_KEYS, roleLabel, plural } from '../../constants';
import { StatCard, Modal, Field, assignableCoaches } from './AdminAtoms';

// because the tab is rendered conditionally — hook count changes between renders.
export function MealPlanTab({ mealPlan, setMealPlan, macrosKcal }) {
  const MEAL_COLORS = ['emerald','blue','orange','purple','rose'];
  const [foodQuery, setFoodQuery]         = useState('');
  const [foodSuggestions, setFoodSugg]    = useState([]);
  const [searchingFood, setSearchingFood] = useState(false);
  const [activeMealId, setActiveMealId]   = useState(null);
  const debRef       = useRef(null);
  const containerRef = useRef(null);

  const searchFood = async (q) => {
    if (!q || q.length < 2) { setFoodSugg([]); return; }
    setSearchingFood(true);
    try {
      const { data } = await api.get('/foods/search', { params: { q, limit: 8 } });
      setFoodSugg(data);
    } catch { setFoodSugg([]); }
    finally { setSearchingFood(false); }
  };

  const handleFoodQuery = (v) => {
    setFoodQuery(v);
    clearTimeout(debRef.current);
    if (v.length >= 2) debRef.current = setTimeout(() => searchFood(v), 300);
    else setFoodSugg([]);
  };

  const addFoodToMeal = (mealId, food, qtyG = 100) => {
    const f = qtyG / 100;
    const n = food.per_100g || {};
    const item = {
      food_id:   food.id,
      food_name: food.name,
      qty_g:     qtyG,
      kcal:      Math.round((n.calories || 0) * f),
      pro:       +((n.protein    || 0) * f).toFixed(1),
      carb:      +((n.net_carbs != null ? n.net_carbs : n.total_carbs || 0) * f).toFixed(1),
      fat:       +((n.fat        || 0) * f).toFixed(1),
      fiber:     +((n.fiber      || 0) * f).toFixed(1),
      per_100g:  n,
    };
    setMealPlan(mp => mp.map(m =>
      m.id === mealId ? { ...m, items: [...(m.items || []), item] } : m
    ));
    setFoodQuery(''); setFoodSugg([]); setActiveMealId(null);
  };

  const updateItemQty = (mealId, idx, newQty) => {
    setMealPlan(mp => mp.map(m => {
      if (m.id !== mealId) return m;
      const items = [...m.items];
      const item  = { ...items[idx] };
      const f = newQty / 100;
      const n = item.per_100g || {};
      item.qty_g = newQty;
      item.kcal  = Math.round((n.calories || 0) * f);
      item.pro   = +((n.protein    || 0) * f).toFixed(1);
      item.carb  = +((n.net_carbs != null ? n.net_carbs : n.total_carbs || 0) * f).toFixed(1);
      item.fat   = +((n.fat        || 0) * f).toFixed(1);
      item.fiber = +((n.fiber      || 0) * f).toFixed(1);
      items[idx] = item;
      return { ...m, items };
    }));
  };

  const removeItem = (mealId, idx) => setMealPlan(mp => mp.map(m =>
    m.id === mealId ? { ...m, items: m.items.filter((_, i) => i !== idx) } : m
  ));
  const removeMeal = (mealId) => setMealPlan(mp => mp.filter(m => m.id !== mealId));
  const updateMeal = (mealId, k, v) => setMealPlan(mp => mp.map(m =>
    m.id === mealId ? { ...m, [k]: v } : m
  ));

  const addMeal = () => {
    const idx   = mealPlan.length;
    const color = MEAL_COLORS[idx % MEAL_COLORS.length];
    setMealPlan(mp => [...mp, {
      id:    `meal_${Date.now()}`,
      name:  `Meal ${idx + 1}`,
      badge: `M${idx + 1}`,
      time:  '',
      color,
      items: [],
    }]);
  };

  const dayTotal = mealPlan.reduce((acc, m) => {
    (m.items || []).forEach(item => {
      acc.kcal   += item.kcal  || 0;
      acc.pro    += item.pro   || 0;
      acc.carb   += item.carb  || 0;
      acc.fat    += item.fat   || 0;
      acc.fiber  += item.fiber || 0;
      // Micros from per_100g snapshot
      const n = item.per_100g || {};
      const f = (item.qty_g || 0) / 100;
      acc.omega3    += ((n.omega3_epa || 0) + (n.omega3_dha || 0) + (n.omega3_ala || 0)) * f;
      acc.vit_b12   += (n.vit_b12   || 0) * f;
      acc.vit_d     += (n.vit_d     || 0) * f;
      acc.vit_c     += (n.vit_c     || 0) * f;
      acc.calcium   += (n.calcium   || 0) * f;
      acc.iron      += (n.iron      || 0) * f;
      acc.magnesium += (n.magnesium || 0) * f;
      acc.zinc      += (n.zinc      || 0) * f;
      acc.folate    += (n.folate    || 0) * f;
      acc.potassium += (n.potassium || 0) * f;
    });
    return acc;
  }, { kcal:0, pro:0, carb:0, fat:0, fiber:0,
       omega3:0, vit_b12:0, vit_d:0, vit_c:0, calcium:0,
       iron:0, magnesium:0, zinc:0, folate:0, potassium:0 });

  const colorMap = {
    emerald: 'bg-ok/[0.14] text-gold-light border-ok/25',
    blue:    'bg-blue-400/[0.14] text-blue-300 border-blue-400/25',
    orange:  'bg-orange-400/[0.14] text-orange-300 border-orange-400/25',
    purple:  'bg-gold/[0.14] text-amber-300 border-gold/25',
    rose:    'bg-rose-400/[0.14] text-rose-300 border-rose-400/25',
  };
  const dotMap = {
    emerald: 'bg-gold', blue: 'bg-blue-500',
    orange:  'bg-orange-500',  purple: 'bg-amber-500', rose: 'bg-rose-500',
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-mid">
        Build the prescribed meal plan. Member sees cards above the food log — tap to pre-fill.
      </p>

      {mealPlan.map((meal) => {
        const mealTotal = (meal.items || []).reduce((a, i) => ({
          kcal: a.kcal + (i.kcal||0), pro: a.pro + (i.pro||0),
          carb: a.carb + (i.carb||0), fat: a.fat + (i.fat||0),
        }), { kcal:0, pro:0, carb:0, fat:0 });

        return (
          <div key={meal.id} className={`rounded-2xl border p-3 space-y-2 ${colorMap[meal.color] || colorMap.emerald}`}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotMap[meal.color] || dotMap.emerald}`} />
              <input value={meal.name} onChange={e => updateMeal(meal.id, 'name', e.target.value)}
                className="flex-1 text-sm font-bold bg-transparent border-none outline-none text-white" />
              <input type="time" value={meal.time} onChange={e => updateMeal(meal.id, 'time', e.target.value)}
                className="text-xs border border-white/[0.15] rounded-lg px-2 py-1 w-28" />
              <button onClick={() => removeMeal(meal.id)} className="text-mid hover:text-red-400 text-sm ml-1">🗑</button>
            </div>

            {(meal.items || []).map((item, iIdx) => (
              <div key={iIdx} className="bg-black/20 rounded-xl px-3 py-2 flex items-center gap-2 group border border-white/[0.08]">
                <span className="text-xs font-medium flex-1 truncate" style={{ color: 'var(--text-hi)' }}>{item.food_name}</span>
                <input type="number" value={item.qty_g}
                  onChange={e => updateItemQty(meal.id, iIdx, parseFloat(e.target.value) || 0)}
                  className="w-16 text-xs text-center border border-white/[0.15] rounded-lg px-1 py-1" />
                <span className="text-xs" style={{ color: 'var(--text-mid)' }}>g</span>
                <span className="text-xs font-bold text-orange-300 w-10 text-right">{item.kcal}</span>
                <span className="text-xs" style={{ color: 'var(--text-mid)' }}>kcal</span>
                <button onClick={() => removeItem(meal.id, iIdx)}
                  className="opacity-0 group-hover:opacity-100 ml-1 transition-opacity" style={{ color: 'var(--text-lo)' }}>×</button>
              </div>
            ))}

            {(meal.items || []).length > 0 && (
              <div className="flex gap-3 text-xs px-1 pt-1 border-t border-white/[0.12]">
                <span className="font-bold text-orange-400">{mealTotal.kcal} kcal</span>
                <span className="text-blue-300">P {mealTotal.pro.toFixed(1)}g</span>
                <span className="text-amber-300">C {mealTotal.carb.toFixed(1)}g</span>
                <span className="text-amber-300">F {mealTotal.fat.toFixed(1)}g</span>
              </div>
            )}

            {activeMealId === meal.id ? (
              <div ref={containerRef} className="relative">
                <input autoFocus value={foodQuery} onChange={e => handleFoodQuery(e.target.value)}
                  placeholder="Search food…"
                  /* Third of four controls that paired `bg-surface` with white
                     text and relied on the index.css remap to stay legible —
                     see test-layout-contracts [7]. */
                  className="w-full text-xs px-3 py-2 rounded-xl border border-white/[0.1] bg-charcoal
                    focus:outline-none focus:ring-2 focus:ring-gold/30 text-white
                    placeholder-lo" />
                {searchingFood && <span className="absolute right-3 top-2 text-xs text-mid">…</span>}
                {foodSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-surface rounded-xl border border-hair shadow-lg
                    z-30 max-h-52 overflow-y-auto" style={{overscrollBehavior:'contain'}}>
                    {foodSuggestions.map(food => (
                      <button key={food.id}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => addFoodToMeal(meal.id, food, 100)}
                        className="w-full text-left px-3 py-2 hover:bg-ok/10 border-b border-white/[0.06] last:border-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-white font-medium truncate">{food.name}</span>
                          <span className="text-xs font-bold text-orange-300 flex-shrink-0 ml-2">
                            {food.per_100g?.calories || 0} kcal/100g
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => { setActiveMealId(null); setFoodQuery(''); setFoodSugg([]); }}
                  className="text-xs text-mid mt-1 hover:text-mid">Cancel</button>
              </div>
            ) : (
              <button onClick={() => { setActiveMealId(meal.id); setFoodQuery(''); setFoodSugg([]); }}
                className="w-full py-1.5 text-xs font-semibold text-mid hover:text-gold-light
                  bg-white/[0.04] hover:bg-white/[0.08] rounded-xl border border-dashed border-white/[0.1]
                  hover:border-ok/35 transition-all">
                + Add food item
              </button>
            )}
          </div>
        );
      })}

      <button onClick={addMeal}
        className="w-full py-2.5 text-sm font-bold text-gold-light bg-ok/10
          hover:bg-ok/[0.14] border-2 border-dashed border-ok/30
          hover:border-ok/40 rounded-2xl transition-all">
        + Add meal
      </button>

      {mealPlan.length > 0 && (
        <div className="bg-white/[0.08] border border-white/[0.1] text-white rounded-2xl px-4 py-3 space-y-2">
          <p className="text-note font-semibold text-mid">Day Total</p>
          <div className="flex gap-4 flex-wrap">
            <span className="text-sm font-bold text-orange-400">{dayTotal.kcal} kcal</span>
            <span className="text-sm text-blue-300">P {dayTotal.pro.toFixed(1)}g</span>
            <span className="text-sm text-amber-300">C {dayTotal.carb.toFixed(1)}g</span>
            <span className="text-sm text-amber-300">F {dayTotal.fat.toFixed(1)}g</span>
            <span className="text-sm text-gold-light">Fiber {dayTotal.fiber.toFixed(1)}g</span>
          </div>
          {/* Micronutrients */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 border-t border-white/[0.15]">
            {[
              ['🐟 Omega-3',    dayTotal.omega3,    1000, 'mg',  1],
              ['💉 B12',        dayTotal.vit_b12,   2.4,  'mcg', 1],
              ['☀️ Vit D',      dayTotal.vit_d,     600,  'IU',  0],
              ['🍊 Vit C',      dayTotal.vit_c,     65,   'mg',  0],
              ['🦴 Calcium',    dayTotal.calcium,   1200, 'mg',  0],
              ['⚙️ Iron',       dayTotal.iron,      8,    'mg',  1],
              ['⚡ Magnesium',  dayTotal.magnesium, 320,  'mg',  0],
              ['🔩 Zinc',       dayTotal.zinc,      8,    'mg',  1],
              ['🧬 Folate',     dayTotal.folate,    400,  'mcg', 0],
              ['🍌 Potassium',  dayTotal.potassium, 2600, 'mg',  0],
            ].map(([label, val, target, unit, dec]) => {
              const v   = +val.toFixed(dec);
              const pct = Math.min(100, (val / target) * 100);
              const cls = pct >= 80 ? 'text-gold-light' : pct >= 50 ? 'text-amber-300' : 'text-red-400';
              return (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-mid">{label}</span>
                  <span className={`text-xs font-bold ${cls}`}>
                    {v} <span className="text-mid font-normal">{unit}</span>
                    <span className="text-mid ml-1">({Math.round(pct)}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
          {macrosKcal && (
            <div className="text-xs text-mid pt-1 border-t border-white/[0.15]">
              Target: {macrosKcal} kcal · Difference:{' '}
              <span className={Math.abs(dayTotal.kcal - parseInt(macrosKcal)) <= 100 ? 'text-gold-light font-bold' : 'text-amber-300 font-bold'}>
                {dayTotal.kcal - parseInt(macrosKcal) > 0 ? '+' : ''}{dayTotal.kcal - parseInt(macrosKcal)} kcal
              </span>
            </div>
          )}
        </div>
      )}

      {mealPlan.length > 0 && (
        <button onClick={() => setMealPlan([])}
          className="text-xs text-red-400 hover:text-red-400 font-semibold">
          🗑 Clear entire meal plan
        </button>
      )}
    </div>
  );
}

// ── Edit Member modal ─────────────────────────────────────────────────────────

// ── Edit Member modal ─────────────────────────────────────────────────────────
export function EditMemberModal({ member, onClose, onSaved }) {
  // ── Fetch full profile on open (list query only has basic fields) ───────────
  // We use 'data' as the source of truth once loaded; falls back to 'member' prop.
  const [data, setData] = useState(member);
  const [loadingProfile, setLoadingProfile] = useState(true);

  useEffect(() => {
    api.get(`/admin/members/${member.id}`)
      .then(res => setData({ ...member, ...res.data }))
      .catch(() => { /* use member prop as fallback */ })
      .finally(() => setLoadingProfile(false));
  }, [member.id]);

  const [form, setForm] = useState({
    name:          member.name          || '',
    phone:         member.phone         || '',
    pin:           '',
    confirmPin:    '',
    height_cm:     member.height_cm     || '',
    dob:           member.dob ? String(member.dob).slice(0, 10) : '',
    gender:        member.gender        || '',
    start_weight:  member.start_weight  || '',
    target_weight: member.target_weight || '',
  });

  // Re-init form fields when full profile loads
  useEffect(() => {
    if (loadingProfile) return;
    setForm(f => ({
      ...f,
      height_cm:     data.height_cm     || '',
      dob:           data.dob ? String(data.dob).slice(0, 10) : '',
      gender:        data.gender        || '',
      start_weight:  data.start_weight  || '',
      target_weight: data.target_weight || '',
    }));
    setProto({
      activities:  data.protocol_activities  || null,
      acv:         data.protocol_acv         || null,
      supplements: data.protocol_supplements || null,
    });
    setOverrides(data.item_overrides || {});
    setCustomItems({
      activities:  data.custom_activities  || [],
      acv:         data.custom_acv         || [],
      supplements: data.custom_supplements || [],
    });
    setFasting({
      start: data.fasting_start ? String(data.fasting_start).slice(0, 5) : '',
      end:   data.fasting_end   ? String(data.fasting_end).slice(0, 5)   : '',
      note:  data.fasting_note  || '',
      label: data.fasting_label || '',
    });
    setMacros({
      kcal:  data.macro_kcal  ? String(data.macro_kcal)  : '',
      pro:   data.macro_pro   ? String(data.macro_pro)   : '',
      carb:  data.macro_carb  ? String(data.macro_carb)  : '',
      fat:   data.macro_fat   ? String(data.macro_fat)   : '',
      phase: data.macro_phase || '',
    });
    setRdaOverrides(data.rda_overrides || {});
    // Sprint 3: meal plan
    setMealPlan(data.meal_plan || []);
  }, [loadingProfile]);

  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [showPin, setShowPin] = useState(false);
  const [tab,     setTab]     = useState('identity');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Protocol enabled IDs (null = all enabled)
  const [proto, setProto] = useState({
    activities:  member.protocol_activities  || null,
    acv:         member.protocol_acv         || null,
    supplements: member.protocol_supplements || null,
  });

  // Per-item overrides: { [itemId]: { label, sub, fromTime, toTime, totalTime } }
  const [overrides, setOverrides] = useState(member.item_overrides || {});

  // Custom items per section
  const [customItems, setCustomItems] = useState({
    activities:  member.custom_activities  || [],
    acv:         member.custom_acv         || [],
    supplements: member.custom_supplements || [],
  });

  // Which item is being edited inline
  const [editingId, setEditingId] = useState(null);
  // Draft state while editing
  const [draft, setDraft] = useState({});

  // Adding new custom item
  const [addingKey, setAddingKey] = useState(null);
  const [newItem, setNewItem]     = useState({ label: '', sub: '', fromTime: '', toTime: '', totalTime: '' });

  // ── Sprint 2: Fasting window ───────────────────────────────────────────────
  const [fasting, setFasting] = useState({
    start: member.fasting_start ? String(member.fasting_start).slice(0, 5) : '',
    end:   member.fasting_end   ? String(member.fasting_end).slice(0, 5)   : '',
    note:  member.fasting_note  || '',
    label: member.fasting_label || '',
  });
  const setF = (k, v) => setFasting(f => ({ ...f, [k]: v }));

  // ── Sprint 2: Macro targets ────────────────────────────────────────────────
  const [macros, setMacros] = useState({
    kcal:  member.macro_kcal  ? String(member.macro_kcal)  : '',
    pro:   member.macro_pro   ? String(member.macro_pro)   : '',
    carb:  member.macro_carb  ? String(member.macro_carb)  : '',
    fat:   member.macro_fat   ? String(member.macro_fat)   : '',
    phase: member.macro_phase || '',
  });
  const setM = (k, v) => setMacros(m => ({ ...m, [k]: v }));

  // ── Sprint 5: RDA overrides per member ────────────────────────────────────
  const [rdaOverrides, setRdaOverrides] = useState(member.rda_overrides || {});
  const setRda = (key, val) => {
    if (val) {
      setRdaOverrides(o => ({ ...o, [key]: parseFloat(val) }));
    } else {
      setRdaOverrides(o => { const r = { ...o }; delete r[key]; return r; });
    }
  };

  // ── Protocol sub-tab (items / fasting / macros / meal plan) ──────────────────
  const [protoTab, setProtoTab] = useState('items');

  // ── Sprint 3: Meal plan ────────────────────────────────────────────────────
  // Structure: [{id, name, badge, time, color, items:[{food_id,food_name,qty_g,kcal,pro,carb,fat,fiber,per_100g}]}]
  const [mealPlan, setMealPlan] = useState(member.meal_plan || []);

  const toggleProto = (key, id, defaultItems) => {
    setProto(p => {
      const current = p[key] || defaultItems.map(i => i.id);
      const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
      return { ...p, [key]: next.length === defaultItems.length ? null : next };
    });
  };

  const startEdit = (item) => {
    const ov = overrides[item.id] || {};
    setDraft({
      label:     ov.label     ?? item.label ?? '',
      sub:       ov.sub       ?? item.sub   ?? '',
      fromTime:  ov.fromTime  ?? '',
      toTime:    ov.toTime    ?? '',
      totalTime: ov.totalTime ?? '',
    });
    setEditingId(item.id);
  };

  const saveEdit = (id) => {
    setOverrides(o => ({ ...o, [id]: { ...draft } }));
    setEditingId(null);
  };

  const deleteItem = (key, id, isCustom) => {
    if (isCustom) {
      setCustomItems(c => ({ ...c, [key]: c[key].filter(i => i.id !== id) }));
    }
    setProto(p => {
      const def = key === 'activities' ? ACTIVITIES : key === 'acv' ? ACV_ITEMS : SUPPLEMENTS;
      const current = p[key] || def.map(i => i.id);
      return { ...p, [key]: current.filter(x => x !== id) };
    });
    setOverrides(o => { const n = { ...o }; delete n[id]; return n; });
  };

  const confirmAddCustom = (key) => {
    if (!newItem.label.trim()) return;
    const id   = `custom_${Date.now()}`;
    const item = { id, label: newItem.label.trim(), sub: newItem.sub.trim(), custom: true };
    const ov   = { label: item.label, sub: item.sub,
                   fromTime: newItem.fromTime, toTime: newItem.toTime, totalTime: newItem.totalTime };
    setCustomItems(c => ({ ...c, [key]: [...c[key], item] }));
    setOverrides(o => ({ ...o, [id]: ov }));
    setProto(p => {
      const def = key === 'activities' ? ACTIVITIES : key === 'acv' ? ACV_ITEMS : SUPPLEMENTS;
      const current = p[key] || def.map(i => i.id);
      return { ...p, [key]: [...current, id] };
    });
    setAddingKey(null);
    setNewItem({ label: '', sub: '', fromTime: '', toTime: '', totalTime: '' });
  };

  const submit = async () => {
    if (!form.name.trim() || !form.phone.trim()) { setError('Name and phone are required'); return; }
    if (form.pin && form.pin !== form.confirmPin) { setError('PINs do not match'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.put(`/admin/members/${member.id}`, {
        name:          form.name.trim(),
        phone:         form.phone.trim(),
        pin:           form.pin || undefined,
        height_cm:     form.height_cm     || null,
        dob:           form.dob           || null,
        gender:        form.gender        || null,
        start_weight:  form.start_weight  || null,
        target_weight: form.target_weight || null,
        protocol_activities:  proto.activities,
        protocol_acv:         proto.acv,
        protocol_supplements: proto.supplements,
        custom_activities:    customItems.activities,
        custom_acv:           customItems.acv,
        custom_supplements:   customItems.supplements,
        item_overrides:       overrides,
        // Sprint 2
        fasting_start: fasting.start || null,
        fasting_end:   fasting.end   || null,
        fasting_note:  fasting.note  || null,
        fasting_label: fasting.label || null,
        macro_kcal:  macros.kcal  ? parseInt(macros.kcal)  : null,
        macro_pro:   macros.pro   ? parseInt(macros.pro)   : null,
        macro_carb:  macros.carb  ? parseInt(macros.carb)  : null,
        macro_fat:   macros.fat   ? parseInt(macros.fat)   : null,
        macro_phase: macros.phase || null,
        // Sprint 3
        meal_plan: mealPlan.length > 0 ? mealPlan : null,
        // Sprint 5
        rda_overrides: Object.keys(rdaOverrides).length > 0 ? rdaOverrides : {},
      });
      onSaved(data);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save changes');
      setSaving(false);
    }
  };

  // ── Fasting tab ────────────────────────────────────────────────────────────
  const FastingTab = () => {
    // Live preview bar (recalculates on fasting state change)
    const timeToMin = (t) => { if (!t) return 0; const [h,m]=t.split(':').map(Number); return h*60+m; };
    const TOTAL = 1440;
    const fastStartMin = timeToMin(fasting.start);
    const fastEndMin   = timeToMin(fasting.end);
    const hasValues    = fasting.start && fasting.end;
    const crossesMid   = hasValues && fastStartMin > fastEndMin;
    const eatHrs  = hasValues ? (crossesMid ? (fastStartMin - fastEndMin) : (fastEndMin - fastStartMin)) / 60 : 0;
    const fastHrs = hasValues ? 24 - eatHrs : 0;

    // Segments for preview bar
    let segments = [];
    if (hasValues) {
      if (crossesMid) {
        if (fastEndMin > 0)        segments.push({ pct: (fastEndMin / TOTAL)*100, type:'fast' });
        segments.push({ pct: ((fastStartMin - fastEndMin) / TOTAL)*100, type:'eat' });
        if (fastStartMin < TOTAL)  segments.push({ pct: ((TOTAL - fastStartMin) / TOTAL)*100, type:'fast' });
      } else {
        if (fastStartMin > 0)      segments.push({ pct: (fastStartMin / TOTAL)*100, type:'eat' });
        segments.push({ pct: ((fastEndMin - fastStartMin) / TOTAL)*100, type:'fast' });
        if (fastEndMin < TOTAL)    segments.push({ pct: ((TOTAL - fastEndMin) / TOTAL)*100, type:'eat' });
      }
    }

    return (
      <div className="space-y-4">
        <p className="text-xs text-mid">
          Set the fasting window. Member sees a live bar showing exactly where they are right now.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-note font-medium text-mute mb-1.5">
              Fast Begins ⏸
            </label>
            <input type="time" value={fasting.start} onChange={e => setF('start', e.target.value)}
              className="w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm
                focus:outline-none focus:ring-2 focus:ring-gold/[0.28] text-white" />
          </div>
          <div>
            <label className="block text-note font-medium text-mute mb-1.5">
              Eating Window Opens ▶
            </label>
            <input type="time" value={fasting.end} onChange={e => setF('end', e.target.value)}
              className="w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm
                focus:outline-none focus:ring-2 focus:ring-gold/[0.28] text-white" />
          </div>
        </div>

        {/* Live preview bar */}
        {hasValues && (
          <div className="bg-white/[0.04] rounded-2xl p-3">
            <div className="flex justify-between text-xs text-mid mb-1.5">
              <span className="font-semibold text-blue-400">🔵 Fasting {fastHrs.toFixed(1)}h</span>
              <span className="font-semibold text-gold-light">🟢 Eating {eatHrs.toFixed(1)}h</span>
            </div>
            <div className="h-5 rounded-full overflow-hidden flex">
              {segments.map((s, i) => (
                <div key={i} style={{ width: `${s.pct}%` }}
                  className={s.type === 'eat' ? 'bg-gold-deep' : 'bg-blue-400'} />
              ))}
            </div>
            <div className="flex justify-between mt-1 text-xs text-mid">
              <span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>12AM</span>
            </div>
            <p className="text-xs text-mid mt-2 text-center font-medium">
              Eating: {fasting.end} – {fasting.start} · Fasting: {fasting.start} – {fasting.end}
            </p>
          </div>
        )}

        <div>
          <label className="block text-note font-medium text-mute mb-1.5">
            Protocol Label (shown to member)
          </label>
          <input value={fasting.label} onChange={e => setF('label', e.target.value)}
            placeholder="e.g. 16:8 Intermittent Fasting"
            className="w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-gold/[0.28] text-white" />
        </div>

        <div>
          <label className="block text-note font-medium text-mute mb-1.5">
            Member-Facing Note
          </label>
          <textarea value={fasting.note} onChange={e => setF('note', e.target.value)} rows={2}
            placeholder="e.g. Water and black coffee allowed during fasting window"
            className="w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-gold/[0.28] text-white resize-none" />
        </div>

        {(fasting.start || fasting.end) && (
          <button onClick={() => setFasting({ start:'', end:'', note:'', label:'' })}
            className="text-xs text-red-400 hover:text-red-400 font-semibold">
            🗑 Clear fasting window
          </button>
        )}
      </div>
    );
  };

  // ── Macros tab ─────────────────────────────────────────────────────────────
  const MacrosTab = () => {
    const p = parseFloat(macros.pro)  || 0;
    const c = parseFloat(macros.carb) || 0;
    const f = parseFloat(macros.fat)  || 0;
    const fromMacros = Math.round(p * 4 + c * 4 + f * 9);
    const target     = parseInt(macros.kcal) || 0;
    const diff       = target - fromMacros;
    const absDiff    = Math.abs(diff);
    const diffOk     = target === 0 || absDiff <= 100;

    return (
      <div className="space-y-3">
        <p className="text-xs text-mid">
          Set daily targets. Member sees live progress bars that fill as food is logged.
        </p>

        <div>
          <label className="block text-note font-medium text-mute mb-1.5">
            Daily Calorie Target (kcal)
          </label>
          <input type="number" value={macros.kcal} onChange={e => setM('kcal', e.target.value)}
            placeholder="e.g. 1450"
            className="w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-gold/[0.28] text-white" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[['pro','Protein (g)','66'],['carb','Net Carbs (g)','144'],['fat','Fat (g)','57']].map(([k,lbl,ph]) => (
            <div key={k}>
              <label className="block text-note font-medium text-mute mb-1.5">{lbl}</label>
              <input type="number" value={macros[k]} onChange={e => setM(k, e.target.value)}
                placeholder={ph}
                className="w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm
                  focus:outline-none focus:ring-2 focus:ring-gold/[0.28] text-white" />
            </div>
          ))}
        </div>

        {/* Live macro → kcal calculator */}
        {(p > 0 || c > 0 || f > 0) && (
          <div className={`rounded-xl px-3 py-2.5 text-xs ${diffOk ? 'bg-ok/10' : 'bg-amber-400/10'}`}>
            <div className="flex justify-between items-center">
              <span className="text-mid">
                {p}×4 + {c}×4 + {f}×9 = <span className="font-bold text-white">{fromMacros} kcal from macros</span>
              </span>
              {target > 0 && (
                <span className={`font-bold ml-2 ${diffOk ? 'text-gold-light' : 'text-amber-300'}`}>
                  {diffOk ? '✓ Balanced' : `${diff > 0 ? '+' : ''}${diff} kcal off`}
                </span>
              )}
            </div>
            {!diffOk && (
              <p className="text-amber-300 mt-1">⚠️ Macro kcal is {absDiff} kcal away from target — adjust to match.</p>
            )}
          </div>
        )}

        <div>
          <label className="block text-note font-medium text-mute mb-1.5">
            Phase / Label (shown to member)
          </label>
          <input value={macros.phase} onChange={e => setM('phase', e.target.value)}
            placeholder="e.g. Phase 1 — Fat Loss"
            className="w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-gold/[0.28] text-white" />
        </div>

        {(macros.kcal || macros.pro) && (
          <button onClick={() => setMacros({ kcal:'', pro:'', carb:'', fat:'', phase:'' })}
            className="text-xs text-red-400 hover:text-red-400 font-semibold">
            🗑 Clear macro targets
          </button>
        )}

        {/* Sprint 5: Clinical RDA Overrides */}
        <div className="border-t border-hair pt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-mid tracking-wider">★ Clinical RDA Overrides</p>
            <span className="text-xs text-mid">Leave blank = use defaults</span>
          </div>
          <p className="text-xs text-mid mb-3">
            Override default nutrient targets for this member's specific needs (e.g. B12 deficiency, osteoporosis).
          </p>
          <div className="space-y-2">
            {RDA_OVERRIDE_KEYS.map(key => {
              const meta = RDA_TARGETS[key];
              if (!meta) return null;
              const current = rdaOverrides[key] || '';
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs text-mid w-28 flex-shrink-0">{meta.icon} {meta.label}</span>
                  <input
                    type="number"
                    value={current}
                    onChange={e => setRda(key, e.target.value)}
                    placeholder={`${meta.rda} ${meta.unit}`}
                    className={`flex-1 border rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300 ${
                      current ? 'border-gold/40 bg-gold/10 text-amber-300 font-semibold' : 'border-white/[0.08]'}`}
                  />
                  <span className="text-xs text-mid w-10">{meta.unit}</span>
                  {current && (
                    <button onClick={() => setRda(key, '')} className="text-white hover:text-red-400 text-sm flex-shrink-0">×</button>
                  )}
                </div>
              );
            })}
          </div>
          {Object.keys(rdaOverrides).length > 0 && (
            <button onClick={() => setRdaOverrides({})}
              className="text-xs text-red-400 hover:text-red-400 font-semibold mt-2">
              🗑 Clear all overrides
            </button>
          )}
        </div>
      </div>
    );
  };

  // ── Inline timing edit form ────────────────────────────────────────────────
  const EditForm = ({ onSave, onCancel }) => (
    <div className="mt-2 ml-7 space-y-2 p-2.5 bg-white/[0.04] rounded-xl border border-white/[0.08]">
      <div className="flex gap-2">
        <div className="flex-1">
          <p className="text-xs text-mid mb-1">Label</p>
          <input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
            placeholder="Item name"
            className="w-full text-sm border border-white/[0.08] rounded-lg px-2 py-1.5 outline-none focus:border-ok/35" />
        </div>
      </div>
      <div>
        <p className="text-xs text-mid mb-1">Description (optional)</p>
        <input value={draft.sub} onChange={e => setDraft(d => ({ ...d, sub: e.target.value }))}
          placeholder="e.g. 30 min · 6:30–7:00 AM"
          className="w-full text-sm border border-white/[0.08] rounded-lg px-2 py-1.5 outline-none focus:border-ok/35" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-xs text-mid mb-1">From</p>
          <input type="time" value={draft.fromTime} onChange={e => setDraft(d => ({ ...d, fromTime: e.target.value }))}
            className="w-full text-xs border border-white/[0.08] rounded-lg px-2 py-1.5 outline-none focus:border-ok/35" />
        </div>
        <div>
          <p className="text-xs text-mid mb-1">To</p>
          <input type="time" value={draft.toTime} onChange={e => setDraft(d => ({ ...d, toTime: e.target.value }))}
            className="w-full text-xs border border-white/[0.08] rounded-lg px-2 py-1.5 outline-none focus:border-ok/35" />
        </div>
        <div>
          <p className="text-xs text-mid mb-1">Duration</p>
          <input value={draft.totalTime} onChange={e => setDraft(d => ({ ...d, totalTime: e.target.value }))}
            placeholder="30 min"
            className="w-full text-xs border border-white/[0.08] rounded-lg px-2 py-1.5 outline-none focus:border-ok/35" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave}
          className="flex-1 py-1.5 text-xs bg-gold text-charcoal rounded-lg font-semibold hover:bg-gold-deep">
          ✓ Save
        </button>
        <button onClick={onCancel}
          className="px-3 py-1.5 text-xs text-mid hover:text-white rounded-lg border border-white/[0.08]">
          Cancel
        </button>
      </div>
    </div>
  );

  // ── Add new custom item form ───────────────────────────────────────────────
  const AddForm = ({ protoKey }) => (
    <div className="mt-2 p-2.5 bg-ok/10 rounded-xl border border-ok/25 space-y-2">
      <p className="text-xs font-semibold text-gold-light">New item</p>
      <input autoFocus value={newItem.label}
        onChange={e => setNewItem(n => ({ ...n, label: e.target.value }))}
        onKeyDown={e => e.key === 'Enter' && confirmAddCustom(protoKey)}
        placeholder="Item name (required)"
        className="w-full text-sm border border-ok/30 rounded-lg px-2.5 py-1.5 outline-none focus:border-gold/40 bg-charcoal text-white placeholder-lo" />
      <input value={newItem.sub}
        onChange={e => setNewItem(n => ({ ...n, sub: e.target.value }))}
        placeholder="Description (optional)"
        className="w-full text-sm border border-white/[0.08] rounded-lg px-2.5 py-1.5 outline-none focus:border-gold/35 bg-charcoal text-white placeholder-lo" />
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-xs text-mid mb-1">From</p>
          <input type="time" value={newItem.fromTime}
            onChange={e => setNewItem(n => ({ ...n, fromTime: e.target.value }))}
            className="w-full text-xs border border-white/[0.08] rounded-lg px-2 py-1.5 outline-none focus:border-gold/35 bg-charcoal text-white placeholder-lo" />
        </div>
        <div>
          <p className="text-xs text-mid mb-1">To</p>
          <input type="time" value={newItem.toTime}
            onChange={e => setNewItem(n => ({ ...n, toTime: e.target.value }))}
            className="w-full text-xs border border-white/[0.08] rounded-lg px-2 py-1.5 outline-none focus:border-gold/35 bg-charcoal text-white placeholder-lo" />
        </div>
        <div>
          <p className="text-xs text-mid mb-1">Duration</p>
          <input value={newItem.totalTime}
            onChange={e => setNewItem(n => ({ ...n, totalTime: e.target.value }))}
            placeholder="30 min"
            className="w-full text-xs border border-white/[0.08] rounded-lg px-2 py-1.5 outline-none focus:border-gold/35 bg-charcoal text-white placeholder-lo" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => confirmAddCustom(protoKey)}
          className="flex-1 py-1.5 text-xs bg-gold text-charcoal rounded-lg font-semibold hover:bg-gold-deep">
          + Add
        </button>
        <button onClick={() => { setAddingKey(null); setNewItem({ label:'',sub:'',fromTime:'',toTime:'',totalTime:'' }); }}
          className="px-3 py-1.5 text-xs text-mid hover:text-white rounded-lg border border-white/[0.08]">
          Cancel
        </button>
      </div>
    </div>
  );

  // ── Protocol section ───────────────────────────────────────────────────────
  const ProtocolSection = ({ label, icon, items, protoKey }) => {
    const allItems = [...items, ...customItems[protoKey]];
    const assigned = proto[protoKey] || items.map(i => i.id);

    return (
      <div className="border border-hair rounded-2xl p-3 space-y-1">
        <p className="text-note font-semibold text-mid mb-2">{icon} {label}</p>

        {allItems.map(item => {
          const ov       = overrides[item.id] || {};
          const dispLabel = ov.label || item.label || '';
          const dispSub   = ov.sub   || item.sub   || '';
          const timing    = [ov.fromTime, ov.toTime].filter(Boolean).join('–');
          const duration  = ov.totalTime || '';
          const subLine   = [duration, timing].filter(Boolean).join(' · ') || dispSub;
          const isEditing = editingId === item.id;
          const enabled   = assigned.includes(item.id);

          return (
            <div key={item.id} className={`rounded-xl transition-colors ${enabled ? '' : 'opacity-40'}`}>
              <div className="flex items-center gap-2 py-1.5">
                {/* Checkbox */}
                <input type="checkbox" checked={enabled}
                  onChange={() => toggleProto(protoKey, item.id, items)}
                  className="w-4 h-4 accent-gold flex-shrink-0 cursor-pointer" />

                {/* Label + sub */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white leading-tight">{dispLabel}</div>
                  {subLine && <div className="text-xs text-mid mt-0.5">{subLine}</div>}
                </div>

                {/* Edit button */}
                <button onClick={() => isEditing ? setEditingId(null) : startEdit(item)}
                  className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors flex-shrink-0 ${
                    isEditing ? 'bg-ok/[0.14] text-gold-light' : 'text-mid hover:text-gold-light hover:bg-ok/10'}`}>
                  ✏️
                </button>

                {/* Delete button */}
                <button onClick={() => deleteItem(protoKey, item.id, !!item.custom)}
                  className="text-xs px-2 py-1 rounded-lg text-white hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0">
                  🗑
                </button>
              </div>

              {/* Inline edit form */}
              {isEditing && <EditForm onSave={() => saveEdit(item.id)} onCancel={() => setEditingId(null)} />}
            </div>
          );
        })}

        {/* Add item */}
        {addingKey === protoKey
          ? <AddForm protoKey={protoKey} />
          : (
            <button onClick={() => setAddingKey(protoKey)}
              className="flex items-center gap-1.5 text-xs text-gold-light hover:text-gold-light font-semibold mt-2 px-1">
              <span className="text-base leading-none">+</span> Add custom item
            </button>
          )
        }
      </div>
    );
  };

  return (
    <Modal title={`Edit — ${member.name}`} onClose={onClose}>
      {/* Tab switcher */}
      <div className="flex gap-1 bg-white/[0.06] p-1 rounded-xl mb-4">
        {[['identity','👤 Identity'],['protocol','📋 Protocol']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
              tab === id ? 'bg-gold/[0.14] text-gold-light shadow-sm' : 'text-mid'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'identity' && (
        <div className="space-y-3">
          <p className="text-note font-semibold text-mid">Identity</p>
          <Field label="Full Name"        value={form.name}  onChange={v=>set('name',v)}  placeholder="Mrs. Padmini" required />
          <Field label="Phone (Login ID)" type="tel" value={form.phone} onChange={v=>set('phone',v)} placeholder="9876543210" required />

          <div className="border border-hair rounded-2xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-note font-semibold text-mid">PIN / Password</p>
              <button onClick={() => { setShowPin(s => !s); set('pin',''); set('confirmPin',''); }}
                className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                  showPin ? 'bg-red-400/10 text-red-400' : 'bg-ok/10 text-gold-light'}`}>
                {showPin ? 'Cancel' : '🔑 Change PIN'}
              </button>
            </div>
            {showPin ? (
              <>
                <Field label="New PIN (min 4 digits)" type="password" value={form.pin} onChange={v=>set('pin',v)} placeholder="e.g. 1234" />
                <Field label="Confirm PIN" type="password" value={form.confirmPin} onChange={v=>set('confirmPin',v)} placeholder="Repeat PIN" />
              </>
            ) : (
              <p className="text-xs text-mid">Leave unchanged — member uses existing PIN.</p>
            )}
          </div>

          <p className="text-note font-semibold text-mid mt-1">Profile</p>
          <Field label="Height (cm)"        type="number" value={form.height_cm}     onChange={v=>set('height_cm',v)}     placeholder="165" />
          <Field label="Date of birth"      type="date"   value={form.dob}           onChange={v=>set('dob',v)} />
          <div>
            <label className="block text-note font-medium text-mute mb-1.5">Sex</label>
            <div className="flex gap-2">
              {[['male','Male'],['female','Female']].map(([val,label]) => (
                <button key={val} type="button"
                  onClick={() => set('gender', form.gender === val ? '' : val)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                    form.gender === val
                      ? 'bg-gold/[0.16] border-gold/50 text-white'
                      : 'border-white/[0.08] text-mid hover:border-white/[0.15]'
                  }`}>{label}</button>
              ))}
            </div>
            <p className="text-eyebrow text-lo mt-1.5">
              Date of birth and sex are required for the member's TDEE calculation.
            </p>
          </div>
          <Field label="Start Weight (kg)"  type="number" value={form.start_weight}  onChange={v=>set('start_weight',v)}  placeholder="85" />
          <Field label="Target Weight (kg)" type="number" value={form.target_weight} onChange={v=>set('target_weight',v)} placeholder="70" />
        </div>
      )}

      {tab === 'protocol' && (
        <div className="space-y-3">
          {/* Protocol sub-tabs */}
          <div className="flex gap-1 bg-white/[0.06] p-1 rounded-xl">
            {[['items','📋 Items'],['fasting','⏰ Fasting'],['macros','🎯 Macros'],['meals','🍽 Meal Plan']].map(([id, label]) => (
              <button key={id} onClick={() => setProtoTab(id)}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                  protoTab === id ? 'bg-gold/[0.14] text-gold-light shadow-sm' : 'text-mid hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>

          {protoTab === 'items' && (
            <>
              <p className="text-xs text-mid bg-amber-400/10 px-3 py-2 rounded-xl">
                ✅ Check/uncheck to assign. ✏️ Edit label & timing. 🗑 Delete item.
              </p>
              <ProtocolSection label="Physical Activities" icon="🏃" items={ACTIVITIES}  protoKey="activities"  />
              <ProtocolSection label="Apple Cider Vinegar" icon="🍶" items={ACV_ITEMS}   protoKey="acv"         />
              <ProtocolSection label="Supplements"         icon="💊" items={SUPPLEMENTS} protoKey="supplements" />
            </>
          )}

          {protoTab === 'fasting' && FastingTab()}
          {protoTab === 'macros'  && MacrosTab()}
          {protoTab === 'meals'   && (
            <MealPlanTab
              mealPlan={mealPlan}
              setMealPlan={setMealPlan}
              macrosKcal={macros.kcal}
            />
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-xl mt-3">{error}</p>}

      <button onClick={submit} disabled={saving}
        className="w-full py-3 bg-gold hover:bg-gold-deep text-charcoal font-bold
          rounded-xl transition-colors disabled:opacity-50 mt-4">
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </Modal>
  );
}

// ── Push Notification modal (Sprint 11) ──────────────────────────────────────

