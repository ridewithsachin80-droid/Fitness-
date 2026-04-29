import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../api/client';
import { adminResetPin, adminSendPush, getAuditLog } from '../api/logs';
import { Card, SectionTitle, PageLoader } from '../components/UI';
import { ACTIVITIES, ACV_ITEMS, SUPPLEMENTS, RDA_TARGETS, RDA_OVERRIDE_KEYS } from '../constants';

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ value, label, icon, color }) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-700',
    blue:    'bg-blue-50    text-blue-700',
    purple:  'bg-purple-50  text-purple-700',
  };
  return (
    <div className={`rounded-2xl p-4 ${colors[color]}`}>
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-xs font-medium opacity-70 mt-0.5">{label}</div>
    </div>
  );
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-[#131317] rounded-3xl border border-white/[0.08] w-full max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-stone-100">
          <h3 className="font-bold text-stone-800 text-base">{title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-2xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Input helper ──────────────────────────────────────────────────────────────
function Field({ label, type = 'text', value, onChange, placeholder, required }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
          focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800"
      />
    </div>
  );
}

// ── Add Member modal ──────────────────────────────────────────────────────────
function AddMemberModal({ monitors, onClose, onAdded }) {
  const [form, setForm] = useState({
    name: '', phone: '', height_cm: '', start_weight: '',
    target_weight: '', monitor_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name || !form.phone) { setError('Name and phone are required'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/admin/members', {
        ...form,
        monitor_id:    form.monitor_id   || null,
        height_cm:     form.height_cm    || null,
        start_weight:  form.start_weight || null,
        target_weight: form.target_weight|| null,
      });
      onAdded(data);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to create member');
      setSaving(false);
    }
  };

  return (
    <Modal title="Add New Member" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Full Name"   value={form.name}         onChange={v=>set('name',v)}         placeholder="Mrs. Padmini" required />
        <Field label="Phone"       value={form.phone}        onChange={v=>set('phone',v)}        placeholder="9876543210"   required type="tel" />
        <Field label="Height (cm)" value={form.height_cm}    onChange={v=>set('height_cm',v)}    placeholder="165"         type="number" />
        <Field label="Start Weight (kg)" value={form.start_weight} onChange={v=>set('start_weight',v)} placeholder="85"   type="number" />
        <Field label="Target Weight (kg)" value={form.target_weight} onChange={v=>set('target_weight',v)} placeholder="70" type="number" />

        {/* Assign monitor */}
        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
            Assign to Monitor
          </label>
          <select
            value={form.monitor_id}
            onChange={e => set('monitor_id', e.target.value)}
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800 bg-white"
          >
            <option value="">— Unassigned —</option>
            {monitors.map(m => (
              <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
            ))}
          </select>
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

        <button onClick={submit} disabled={saving}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold
            rounded-xl transition-colors disabled:opacity-50 mt-2">
          {saving ? 'Creating…' : 'Create Member'}
        </button>
      </div>
    </Modal>
  );
}

// ── MealPlanTab — top-level component so hooks are always stable ──────────────
// Must be OUTSIDE EditMemberModal. If defined inside, React error #310 fires
// because the tab is rendered conditionally — hook count changes between renders.
function MealPlanTab({ mealPlan, setMealPlan, macrosKcal }) {
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
    emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    blue:    'bg-blue-100 text-blue-700 border-blue-200',
    orange:  'bg-orange-100 text-orange-700 border-orange-200',
    purple:  'bg-purple-100 text-purple-700 border-purple-200',
    rose:    'bg-rose-100 text-rose-700 border-rose-200',
  };
  const dotMap = {
    emerald: 'bg-emerald-500', blue: 'bg-blue-500',
    orange:  'bg-orange-500',  purple: 'bg-purple-500', rose: 'bg-rose-500',
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-stone-400">
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
                className="flex-1 text-sm font-bold bg-transparent border-none outline-none text-stone-700" />
              <input type="time" value={meal.time} onChange={e => updateMeal(meal.id, 'time', e.target.value)}
                className="text-xs bg-white/70 border border-white/50 rounded-lg px-2 py-1 text-stone-600 w-28" />
              <button onClick={() => removeMeal(meal.id)} className="text-stone-400 hover:text-red-500 text-sm ml-1">🗑</button>
            </div>

            {(meal.items || []).map((item, iIdx) => (
              <div key={iIdx} className="bg-white/80 rounded-xl px-3 py-2 flex items-center gap-2 group">
                <span className="text-xs text-stone-700 font-medium flex-1 truncate">{item.food_name}</span>
                <input type="number" value={item.qty_g}
                  onChange={e => updateItemQty(meal.id, iIdx, parseFloat(e.target.value) || 0)}
                  className="w-16 text-xs text-center border border-stone-200 rounded-lg px-1 py-1 bg-white" />
                <span className="text-xs text-stone-400">g</span>
                <span className="text-xs font-bold text-orange-600 w-10 text-right">{item.kcal}</span>
                <span className="text-xs text-stone-400">kcal</span>
                <button onClick={() => removeItem(meal.id, iIdx)}
                  className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-400 ml-1 transition-opacity">×</button>
              </div>
            ))}

            {(meal.items || []).length > 0 && (
              <div className="flex gap-3 text-xs px-1 pt-1 border-t border-white/50">
                <span className="font-bold text-orange-600">{mealTotal.kcal} kcal</span>
                <span className="text-blue-700">P {mealTotal.pro.toFixed(1)}g</span>
                <span className="text-amber-700">C {mealTotal.carb.toFixed(1)}g</span>
                <span className="text-purple-700">F {mealTotal.fat.toFixed(1)}g</span>
              </div>
            )}

            {activeMealId === meal.id ? (
              <div ref={containerRef} className="relative">
                <input autoFocus value={foodQuery} onChange={e => handleFoodQuery(e.target.value)}
                  placeholder="Search food…"
                  className="w-full text-xs px-3 py-2 rounded-xl border border-white bg-white
                    focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-700" />
                {searchingFood && <span className="absolute right-3 top-2 text-xs text-stone-400">…</span>}
                {foodSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-[#1a1a20] rounded-xl border border-white/[0.07] shadow-lg
                    z-30 border border-stone-100 max-h-52 overflow-y-auto" style={{overscrollBehavior:'contain'}}>
                    {foodSuggestions.map(food => (
                      <button key={food.id}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => addFoodToMeal(meal.id, food, 100)}
                        className="w-full text-left px-3 py-2 hover:bg-emerald-50 border-b border-stone-50 last:border-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-stone-700 font-medium truncate">{food.name}</span>
                          <span className="text-xs font-bold text-orange-500 flex-shrink-0 ml-2">
                            {food.per_100g?.calories || 0} kcal/100g
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => { setActiveMealId(null); setFoodQuery(''); setFoodSugg([]); }}
                  className="text-xs text-stone-400 mt-1 hover:text-stone-600">Cancel</button>
              </div>
            ) : (
              <button onClick={() => { setActiveMealId(meal.id); setFoodQuery(''); setFoodSugg([]); }}
                className="w-full py-1.5 text-xs font-semibold text-stone-500 hover:text-emerald-700
                  bg-white/60 hover:bg-white/90 rounded-xl border border-dashed border-stone-300
                  hover:border-emerald-400 transition-all">
                + Add food item
              </button>
            )}
          </div>
        );
      })}

      <button onClick={addMeal}
        className="w-full py-2.5 text-sm font-bold text-emerald-700 bg-emerald-50
          hover:bg-emerald-100 border-2 border-dashed border-emerald-300
          hover:border-emerald-500 rounded-2xl transition-all">
        + Add meal
      </button>

      {mealPlan.length > 0 && (
        <div className="bg-white/[0.08] border border-white/[0.10] text-[#ededf0] rounded-2xl px-4 py-3 space-y-2">
          <p className="text-xs font-bold tracking-widest uppercase text-stone-400">Day Total</p>
          <div className="flex gap-4 flex-wrap">
            <span className="text-sm font-bold text-orange-400">{dayTotal.kcal} kcal</span>
            <span className="text-sm text-blue-300">P {dayTotal.pro.toFixed(1)}g</span>
            <span className="text-sm text-amber-300">C {dayTotal.carb.toFixed(1)}g</span>
            <span className="text-sm text-purple-300">F {dayTotal.fat.toFixed(1)}g</span>
            <span className="text-sm text-emerald-300">Fiber {dayTotal.fiber.toFixed(1)}g</span>
          </div>
          {/* Micronutrients */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 border-t border-stone-700">
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
              const cls = pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';
              return (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-stone-400">{label}</span>
                  <span className={`text-xs font-bold ${cls}`}>
                    {v} <span className="text-stone-500 font-normal">{unit}</span>
                    <span className="text-stone-600 ml-1">({Math.round(pct)}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
          {macrosKcal && (
            <div className="text-xs text-stone-400 pt-1 border-t border-stone-700">
              Target: {macrosKcal} kcal · Difference:{' '}
              <span className={Math.abs(dayTotal.kcal - parseInt(macrosKcal)) <= 100 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                {dayTotal.kcal - parseInt(macrosKcal) > 0 ? '+' : ''}{dayTotal.kcal - parseInt(macrosKcal)} kcal
              </span>
            </div>
          )}
        </div>
      )}

      {mealPlan.length > 0 && (
        <button onClick={() => setMealPlan([])}
          className="text-xs text-red-400 hover:text-red-600 font-semibold">
          🗑 Clear entire meal plan
        </button>
      )}
    </div>
  );
}

// ── Edit Member modal ─────────────────────────────────────────────────────────
function EditMemberModal({ member, onClose, onSaved }) {
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
    start_weight:  member.start_weight  || '',
    target_weight: member.target_weight || '',
  });

  // Re-init form fields when full profile loads
  useEffect(() => {
    if (loadingProfile) return;
    setForm(f => ({
      ...f,
      height_cm:     data.height_cm     || '',
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
        <p className="text-xs text-stone-400">
          Set the fasting window. Member sees a live bar showing exactly where they are right now.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
              Fast Begins ⏸
            </label>
            <input type="time" value={fasting.start} onChange={e => setF('start', e.target.value)}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
              Eating Window Opens ▶
            </label>
            <input type="time" value={fasting.end} onChange={e => setF('end', e.target.value)}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
          </div>
        </div>

        {/* Live preview bar */}
        {hasValues && (
          <div className="bg-stone-50 rounded-2xl p-3">
            <div className="flex justify-between text-xs text-stone-500 mb-1.5">
              <span className="font-semibold text-blue-600">🔵 Fasting {fastHrs.toFixed(1)}h</span>
              <span className="font-semibold text-emerald-600">🟢 Eating {eatHrs.toFixed(1)}h</span>
            </div>
            <div className="h-5 rounded-full overflow-hidden flex">
              {segments.map((s, i) => (
                <div key={i} style={{ width: `${s.pct}%` }}
                  className={s.type === 'eat' ? 'bg-emerald-400' : 'bg-blue-400'} />
              ))}
            </div>
            <div className="flex justify-between mt-1 text-xs text-stone-400">
              <span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>12AM</span>
            </div>
            <p className="text-xs text-stone-500 mt-2 text-center font-medium">
              Eating: {fasting.end} – {fasting.start} · Fasting: {fasting.start} – {fasting.end}
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
            Protocol Label (shown to member)
          </label>
          <input value={fasting.label} onChange={e => setF('label', e.target.value)}
            placeholder="e.g. 16:8 Intermittent Fasting"
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
            Member-Facing Note
          </label>
          <textarea value={fasting.note} onChange={e => setF('note', e.target.value)} rows={2}
            placeholder="e.g. Water and black coffee allowed during fasting window"
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800 resize-none" />
        </div>

        {(fasting.start || fasting.end) && (
          <button onClick={() => setFasting({ start:'', end:'', note:'', label:'' })}
            className="text-xs text-red-400 hover:text-red-600 font-semibold">
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
        <p className="text-xs text-stone-400">
          Set daily targets. Member sees live progress bars that fill as food is logged.
        </p>

        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
            Daily Calorie Target (kcal)
          </label>
          <input type="number" value={macros.kcal} onChange={e => setM('kcal', e.target.value)}
            placeholder="e.g. 1450"
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[['pro','Protein (g)','66'],['carb','Net Carbs (g)','144'],['fat','Fat (g)','57']].map(([k,lbl,ph]) => (
            <div key={k}>
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">{lbl}</label>
              <input type="number" value={macros[k]} onChange={e => setM(k, e.target.value)}
                placeholder={ph}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                  focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
            </div>
          ))}
        </div>

        {/* Live macro → kcal calculator */}
        {(p > 0 || c > 0 || f > 0) && (
          <div className={`rounded-xl px-3 py-2.5 text-xs ${diffOk ? 'bg-emerald-50' : 'bg-amber-50'}`}>
            <div className="flex justify-between items-center">
              <span className="text-stone-500">
                {p}×4 + {c}×4 + {f}×9 = <span className="font-bold text-stone-700">{fromMacros} kcal from macros</span>
              </span>
              {target > 0 && (
                <span className={`font-bold ml-2 ${diffOk ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {diffOk ? '✓ Balanced' : `${diff > 0 ? '+' : ''}${diff} kcal off`}
                </span>
              )}
            </div>
            {!diffOk && (
              <p className="text-amber-600 mt-1">⚠️ Macro kcal is {absDiff} kcal away from target — adjust to match.</p>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
            Phase / Label (shown to member)
          </label>
          <input value={macros.phase} onChange={e => setM('phase', e.target.value)}
            placeholder="e.g. Phase 1 — Fat Loss"
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
        </div>

        {(macros.kcal || macros.pro) && (
          <button onClick={() => setMacros({ kcal:'', pro:'', carb:'', fat:'', phase:'' })}
            className="text-xs text-red-400 hover:text-red-600 font-semibold">
            🗑 Clear macro targets
          </button>
        )}

        {/* Sprint 5: Clinical RDA Overrides */}
        <div className="border-t border-stone-100 pt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-stone-500 uppercase tracking-wider">★ Clinical RDA Overrides</p>
            <span className="text-xs text-stone-400">Leave blank = use defaults</span>
          </div>
          <p className="text-xs text-stone-400 mb-3">
            Override default nutrient targets for this member's specific needs (e.g. B12 deficiency, osteoporosis).
          </p>
          <div className="space-y-2">
            {RDA_OVERRIDE_KEYS.map(key => {
              const meta = RDA_TARGETS[key];
              if (!meta) return null;
              const current = rdaOverrides[key] || '';
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs text-stone-600 w-28 flex-shrink-0">{meta.icon} {meta.label}</span>
                  <input
                    type="number"
                    value={current}
                    onChange={e => setRda(key, e.target.value)}
                    placeholder={`${meta.rda} ${meta.unit}`}
                    className={`flex-1 border rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300 ${
                      current ? 'border-purple-300 bg-purple-50 text-purple-800 font-semibold' : 'border-stone-200'}`}
                  />
                  <span className="text-xs text-stone-400 w-10">{meta.unit}</span>
                  {current && (
                    <button onClick={() => setRda(key, '')} className="text-stone-300 hover:text-red-400 text-sm flex-shrink-0">×</button>
                  )}
                </div>
              );
            })}
          </div>
          {Object.keys(rdaOverrides).length > 0 && (
            <button onClick={() => setRdaOverrides({})}
              className="text-xs text-red-400 hover:text-red-600 font-semibold mt-2">
              🗑 Clear all overrides
            </button>
          )}
        </div>
      </div>
    );
  };

  // ── Inline timing edit form ────────────────────────────────────────────────
  const EditForm = ({ onSave, onCancel }) => (
    <div className="mt-2 ml-7 space-y-2 p-2.5 bg-stone-50 rounded-xl border border-stone-200">
      <div className="flex gap-2">
        <div className="flex-1">
          <p className="text-xs text-stone-400 mb-1">Label</p>
          <input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
            placeholder="Item name"
            className="w-full text-sm border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400" />
        </div>
      </div>
      <div>
        <p className="text-xs text-stone-400 mb-1">Description (optional)</p>
        <input value={draft.sub} onChange={e => setDraft(d => ({ ...d, sub: e.target.value }))}
          placeholder="e.g. 30 min · 6:30–7:00 AM"
          className="w-full text-sm border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-xs text-stone-400 mb-1">From</p>
          <input type="time" value={draft.fromTime} onChange={e => setDraft(d => ({ ...d, fromTime: e.target.value }))}
            className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400" />
        </div>
        <div>
          <p className="text-xs text-stone-400 mb-1">To</p>
          <input type="time" value={draft.toTime} onChange={e => setDraft(d => ({ ...d, toTime: e.target.value }))}
            className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400" />
        </div>
        <div>
          <p className="text-xs text-stone-400 mb-1">Duration</p>
          <input value={draft.totalTime} onChange={e => setDraft(d => ({ ...d, totalTime: e.target.value }))}
            placeholder="30 min"
            className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave}
          className="flex-1 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700">
          ✓ Save
        </button>
        <button onClick={onCancel}
          className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-700 rounded-lg border border-stone-200">
          Cancel
        </button>
      </div>
    </div>
  );

  // ── Add new custom item form ───────────────────────────────────────────────
  const AddForm = ({ protoKey }) => (
    <div className="mt-2 p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 space-y-2">
      <p className="text-xs font-semibold text-emerald-700">New item</p>
      <input autoFocus value={newItem.label}
        onChange={e => setNewItem(n => ({ ...n, label: e.target.value }))}
        onKeyDown={e => e.key === 'Enter' && confirmAddCustom(protoKey)}
        placeholder="Item name (required)"
        className="w-full text-sm border border-emerald-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-500 bg-white" />
      <input value={newItem.sub}
        onChange={e => setNewItem(n => ({ ...n, sub: e.target.value }))}
        placeholder="Description (optional)"
        className="w-full text-sm border border-stone-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-emerald-400 bg-white" />
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-xs text-stone-400 mb-1">From</p>
          <input type="time" value={newItem.fromTime}
            onChange={e => setNewItem(n => ({ ...n, fromTime: e.target.value }))}
            className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400 bg-white" />
        </div>
        <div>
          <p className="text-xs text-stone-400 mb-1">To</p>
          <input type="time" value={newItem.toTime}
            onChange={e => setNewItem(n => ({ ...n, toTime: e.target.value }))}
            className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400 bg-white" />
        </div>
        <div>
          <p className="text-xs text-stone-400 mb-1">Duration</p>
          <input value={newItem.totalTime}
            onChange={e => setNewItem(n => ({ ...n, totalTime: e.target.value }))}
            placeholder="30 min"
            className="w-full text-xs border border-stone-200 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-400 bg-white" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => confirmAddCustom(protoKey)}
          className="flex-1 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700">
          + Add
        </button>
        <button onClick={() => { setAddingKey(null); setNewItem({ label:'',sub:'',fromTime:'',toTime:'',totalTime:'' }); }}
          className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-700 rounded-lg border border-stone-200">
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
      <div className="border border-stone-100 rounded-2xl p-3 space-y-1">
        <p className="text-xs font-bold tracking-widest uppercase text-stone-400 mb-2">{icon} {label}</p>

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
                  className="w-4 h-4 accent-emerald-600 flex-shrink-0 cursor-pointer" />

                {/* Label + sub */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-stone-700 leading-tight">{dispLabel}</div>
                  {subLine && <div className="text-xs text-stone-400 mt-0.5">{subLine}</div>}
                </div>

                {/* Edit button */}
                <button onClick={() => isEditing ? setEditingId(null) : startEdit(item)}
                  className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors flex-shrink-0 ${
                    isEditing ? 'bg-emerald-100 text-emerald-700' : 'text-stone-400 hover:text-emerald-600 hover:bg-emerald-50'}`}>
                  ✏️
                </button>

                {/* Delete button */}
                <button onClick={() => deleteItem(protoKey, item.id, !!item.custom)}
                  className="text-xs px-2 py-1 rounded-lg text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0">
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
              className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-800 font-semibold mt-2 px-1">
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
      <div className="flex gap-1 bg-stone-100 p-1 rounded-xl mb-4">
        {[['identity','👤 Identity'],['protocol','📋 Protocol']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
              tab === id ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'identity' && (
        <div className="space-y-3">
          <p className="text-xs font-bold tracking-widest uppercase text-stone-400">Identity</p>
          <Field label="Full Name"        value={form.name}  onChange={v=>set('name',v)}  placeholder="Mrs. Padmini" required />
          <Field label="Phone (Login ID)" type="tel" value={form.phone} onChange={v=>set('phone',v)} placeholder="9876543210" required />

          <div className="border border-stone-100 rounded-2xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold tracking-widest uppercase text-stone-400">PIN / Password</p>
              <button onClick={() => { setShowPin(s => !s); set('pin',''); set('confirmPin',''); }}
                className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                  showPin ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                {showPin ? 'Cancel' : '🔑 Change PIN'}
              </button>
            </div>
            {showPin ? (
              <>
                <Field label="New PIN (min 4 digits)" type="password" value={form.pin} onChange={v=>set('pin',v)} placeholder="e.g. 1234" />
                <Field label="Confirm PIN" type="password" value={form.confirmPin} onChange={v=>set('confirmPin',v)} placeholder="Repeat PIN" />
              </>
            ) : (
              <p className="text-xs text-stone-400">Leave unchanged — member uses existing PIN.</p>
            )}
          </div>

          <p className="text-xs font-bold tracking-widest uppercase text-stone-400 mt-1">Profile</p>
          <Field label="Height (cm)"        type="number" value={form.height_cm}     onChange={v=>set('height_cm',v)}     placeholder="165" />
          <Field label="Start Weight (kg)"  type="number" value={form.start_weight}  onChange={v=>set('start_weight',v)}  placeholder="85" />
          <Field label="Target Weight (kg)" type="number" value={form.target_weight} onChange={v=>set('target_weight',v)} placeholder="70" />
        </div>
      )}

      {tab === 'protocol' && (
        <div className="space-y-3">
          {/* Protocol sub-tabs */}
          <div className="flex gap-1 bg-stone-100 p-1 rounded-xl">
            {[['items','📋 Items'],['fasting','⏰ Fasting'],['macros','🎯 Macros'],['meals','🍽 Meal Plan']].map(([id, label]) => (
              <button key={id} onClick={() => setProtoTab(id)}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                  protoTab === id ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
                {label}
              </button>
            ))}
          </div>

          {protoTab === 'items' && (
            <>
              <p className="text-xs text-stone-400 bg-amber-50 px-3 py-2 rounded-xl">
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

      {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl mt-3">{error}</p>}

      <button onClick={submit} disabled={saving}
        className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold
          rounded-xl transition-colors disabled:opacity-50 mt-4">
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </Modal>
  );
}

// ── Push Notification modal (Sprint 11) ──────────────────────────────────────
function PushModal({ members, onClose }) {
  const [form,    setForm]    = useState({ patient_id: '', title: '', body: '' });
  const [sending, setSending] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const send = async () => {
    if (!form.title.trim() || !form.body.trim()) { setError('Title and message are required'); return; }
    setSending(true); setError('');
    try {
      const payload = { title: form.title, body: form.body };
      if (form.patient_id) payload.patient_id = form.patient_id;
      const { data } = await adminSendPush(payload);
      setResult(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to send');
      setSending(false);
    }
  };

  return (
    <Modal title="Send Push Notification" onClose={onClose}>
      <div className="space-y-3">
        {result ? (
          <div className="text-center py-4 space-y-2">
            <div className="text-4xl">📨</div>
            <p className="font-bold text-stone-800">Notification sent!</p>
            <p className="text-sm text-stone-500">
              Delivered to <span className="font-semibold text-emerald-600">{result.sent}</span> device{result.sent !== 1 ? 's' : ''}
              {result.failed > 0 && `, ${result.failed} failed`}
            </p>
            <button onClick={onClose} className="mt-2 text-sm font-semibold text-stone-500 hover:text-stone-700">Close</button>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">Recipient</label>
              <select value={form.patient_id} onChange={e => set('patient_id', e.target.value)}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm bg-white
                  focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800">
                <option value="">📢 All active members ({members.filter(m => m.active).length})</option>
                {members.filter(m => m.active).map(m => (
                  <option key={m.id} value={m.id}>{m.name} · {m.phone}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">Title</label>
              <input value={form.title} onChange={e => set('title', e.target.value)}
                placeholder="e.g. Reminder: Log your weight today"
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                  focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">Message</label>
              <textarea value={form.body} onChange={e => set('body', e.target.value)} rows={3}
                placeholder="e.g. Great work this week! Don't forget to log your morning weight."
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm resize-none
                  focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
              <p className="text-xs text-stone-400 mt-1">{form.body.length}/140 characters</p>
            </div>

            <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              <p className="text-xs text-amber-700 font-medium">
                ⚠ Only members with push notifications enabled will receive this.
              </p>
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

            <button onClick={send} disabled={sending || !form.title.trim() || !form.body.trim()}
              className="w-full py-3 bg-[#0e0e12] hover:bg-[#08080b] text-white font-bold
                rounded-xl transition-colors disabled:opacity-40">
              {sending ? 'Sending…' : `Send Notification`}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Add Monitor modal ─────────────────────────────────────────────────────────
function AddMonitorModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'monitor' });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name || !form.email || !form.password) { setError('All fields required'); return; }
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post('/admin/monitors', form);
      onAdded(data);
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to create monitor');
      setSaving(false);
    }
  };

  return (
    <Modal title="Add Monitor / Trainer" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Full Name" value={form.name} onChange={v=>set('name',v)} placeholder="Dr. Sachin" required />
        <Field label="Email" type="email" value={form.email} onChange={v=>set('email',v)} placeholder="trainer@fitlife.app" required />
        <Field label="Password" type="password" value={form.password} onChange={v=>set('password',v)} placeholder="Min 8 characters" required />

        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">Role</label>
          <div className="flex gap-2">
            {['monitor','admin'].map(r => (
              <button key={r} onClick={() => set('role', r)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all capitalize ${
                  form.role === r
                    ? 'bg-white/[0.08] border border-white/[0.10] text-[#ededf0] border-stone-800'
                    : 'bg-white text-stone-500 border-stone-200 hover:border-stone-300'
                }`}>
                {r === 'admin' ? '👑 Admin' : '🏋️ Monitor'}
              </button>
            ))}
          </div>
          {form.role === 'admin' && (
            <p className="text-xs text-amber-600 mt-1.5 bg-amber-50 px-3 py-1.5 rounded-lg">
              Admin has full access including creating/managing all users.
            </p>
          )}
        </div>

        {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

        <button onClick={submit} disabled={saving}
          className="w-full py-3 bg-[#0e0e12] hover:bg-[#08080b] text-white font-bold
            rounded-xl transition-colors disabled:opacity-50 mt-2">
          {saving ? 'Creating…' : 'Create Account'}
        </button>
      </div>
    </Modal>
  );
}

// ── Assign Monitor modal ──────────────────────────────────────────────────────
function AssignModal({ member, monitors, onClose, onAssigned }) {
  const [monitorId, setMonitorId] = useState(member.monitor_id || '');
  const [saving,    setSaving]    = useState(false);

  const submit = async () => {
    if (!monitorId) return;
    setSaving(true);
    try {
      await api.post('/admin/assign', { monitor_id: monitorId, patient_id: member.id });
      onAssigned(member.id, monitorId, monitors.find(m => m.id == monitorId)?.name);
      onClose();
    } catch (e) {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Assign Monitor — ${member.name}`} onClose={onClose}>
      <div className="space-y-4">
        <select value={monitorId} onChange={e => setMonitorId(e.target.value)}
          className="w-full border border-stone-200 rounded-xl px-3 py-3 text-sm
            focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white text-stone-800">
          <option value="">— Unassigned —</option>
          {monitors.map(m => (
            <option key={m.id} value={m.id}>{m.name} · {m.role} · {m.patient_count} members</option>
          ))}
        </select>
        <button onClick={submit} disabled={saving || !monitorId}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold
            rounded-xl disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : 'Confirm Assignment'}
        </button>
      </div>
    </Modal>
  );
}

// ── Main Admin Dashboard ──────────────────────────────────────────────────────
export default function AdminDashboard() {
  const navigate         = useNavigate();
  const { user, logout } = useAuthStore();
  const [tab,       setTab]       = useState('overview');
  const [stats,     setStats]     = useState(null);
  const [overview,  setOverview]  = useState(null);
  const [members,   setMembers]   = useState([]);
  const [monitors,  setMonitors]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showAddMember,  setShowAddMember]  = useState(false);
  const [showAddMonitor, setShowAddMonitor] = useState(false);
  const [showPush,       setShowPush]       = useState(false);
  const [auditLog,       setAuditLog]       = useState([]);
  const [assignTarget,   setAssignTarget]   = useState(null);
  const [editTarget,     setEditTarget]     = useState(null);
  const [search,    setSearch]    = useState('');

  const load = useCallback(async () => {
    try {
      const [s, m, mo, ov, al] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/members'),
        api.get('/admin/monitors'),
        api.get('/admin/overview').catch(() => ({ data: null })),
        getAuditLog(100).catch(() => ({ data: [] })),
      ]);
      setStats(s.data);
      setMembers(m.data);
      setMonitors(mo.data);
      setOverview(ov.data);
      setAuditLog(al.data || []);
    } catch (e) {
      console.error('Admin load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleUser = async (id, type) => {
    const url = `/admin/${type}s/${id}/toggle`;
    const { data } = await api.patch(url);
    if (type === 'member') {
      setMembers(prev => prev.map(m => m.id === id ? { ...m, active: data.active } : m));
    } else {
      setMonitors(prev => prev.map(m => m.id === id ? { ...m, active: data.active } : m));
    }
  };

  const filtered = (list, key) =>
    list.filter(x => x[key]?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <PageLoader />;

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="min-h-screen bg-[#0b0b0e]">

      {/* Header */}
      <div className="bg-gradient-to-br from-stone-800 to-stone-900 text-white px-4 pt-10 pb-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-stone-400 mb-0.5">FitLife Admin</p>
              <h1 className="text-xl font-bold">Welcome, {user?.name} 👑</h1>
              <p className="text-stone-400 text-xs mt-0.5">Full access — manage all members & monitors</p>
            </div>
            <button onClick={() => { logout(); }}
              className="text-xs text-stone-400 hover:text-white px-3 py-1.5 border border-stone-700
                hover:border-stone-500 rounded-xl transition-colors">
              Sign out
            </button>
          </div>

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-3 gap-3">
              <StatCard value={stats.members}   label="Members"    icon="👥" color="emerald" />
              <StatCard value={stats.monitors}  label="Monitors"   icon="🏋️" color="blue" />
              <StatCard value={stats.logsToday} label="Logs today" icon="📋" color="purple" />
            </div>
          )}
        </div>
      </div>

      {/* Tabs + search */}
      <div className="max-w-2xl mx-auto px-4 pt-4">
        <div className="flex gap-2 mb-3">
          {[
            { id: 'overview', label: '📊 Overview'  },
            { id: 'members',  label: '👥 Members'   },
            { id: 'monitors', label: '🏋️ Monitors'  },
            { id: 'audit',    label: '🔍 Audit'     },
          ].map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setSearch(''); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                tab === t.id
                  ? 'bg-white text-stone-800 shadow-card'
                  : 'text-stone-500 hover:text-stone-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Search + add button — only for members/monitors tabs */}
        {(tab === 'members' || tab === 'monitors') && (
        <div className="flex gap-2 mb-4">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${tab}…`}
            className="flex-1 px-3 py-2.5 bg-[#1a1a20] border border-white/[0.10] rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800"
          />
          <button
            onClick={() => tab === 'members' ? setShowAddMember(true) : setShowAddMonitor(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold
              rounded-xl transition-colors whitespace-nowrap">
            + Add {tab === 'members' ? 'Member' : 'Monitor'}
          </button>
        </div>
        )}
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 pb-10 space-y-2">

        {/* ── Overview tab ── */}
        {tab === 'overview' && overview && (
          <div className="space-y-3">
            {/* Quick stats */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Total Members',    value: overview.stats.total_members,         color: 'bg-blue-50 text-blue-700' },
                { label: 'Logged Today',     value: `${overview.stats.logged_today} / ${overview.stats.total_members}`, color: 'bg-emerald-50 text-emerald-700' },
                { label: '7-Day Avg Comply', value: `${overview.stats.avg_compliance_7d}%`, color: overview.stats.avg_compliance_7d >= 75 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700' },
                { label: 'Total Weight Lost',value: `${overview.stats.total_weight_lost_kg} kg`, color: 'bg-purple-50 text-purple-700' },
              ].map(s => (
                <div key={s.label} className={`rounded-2xl px-4 py-3 ${s.color}`}>
                  <div className="text-xl font-bold">{s.value}</div>
                  <div className="text-xs font-semibold mt-0.5 opacity-80">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Alerts — members who haven't logged */}
            {overview.alerts.length > 0 && (
              <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
                <p className="text-sm font-bold text-red-700 mb-2">⚠️ Needs Attention ({overview.alerts.length})</p>
                <div className="space-y-1">
                  {overview.alerts.map(a => (
                    <div key={a.id} className="flex items-center justify-between text-xs">
                      <span className="font-medium text-red-800">{a.name}</span>
                      <span className="text-red-500 font-bold">
                        {a.days_since ? `${a.days_since}d no log` : 'Never logged'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Today's detail per member */}
            <div className="bg-[#131317] rounded-2xl border border-white/[0.08] border border-stone-100 overflow-hidden">
              <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-100">
                <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Today's Compliance</span>
              </div>
              {overview.today_detail.map(m => {
                const pct = m.compliance_pct || 0;
                const color = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : pct > 0 ? 'bg-red-400' : 'bg-stone-200';
                const textColor = pct >= 75 ? 'text-emerald-700' : pct >= 50 ? 'text-amber-700' : pct > 0 ? 'text-red-600' : 'text-stone-400';
                return (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3 border-b border-stone-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-stone-700">{m.name}</span>
                      {m.monitor_name && <span className="text-xs text-stone-400 ml-2">· {m.monitor_name}</span>}
                    </div>
                    {m.weight_kg && <span className="text-xs font-semibold text-emerald-600">{m.weight_kg} kg</span>}
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 bg-stone-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`text-xs font-bold w-8 text-right ${textColor}`}>
                        {m.log_date ? `${pct}%` : '—'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 7-day compliance ranking */}
            <div className="bg-[#131317] rounded-2xl border border-white/[0.08] border border-stone-100 overflow-hidden">
              <div className="px-4 py-2.5 bg-stone-50 border-b border-stone-100">
                <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">7-Day Average Compliance</span>
              </div>
              {overview.compliance_7d.map(m => {
                const pct = parseFloat(m.avg_7d) || 0;
                return (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-stone-50 last:border-0">
                    <span className="text-sm text-stone-700 flex-1">{m.name}</span>
                    <span className="text-xs text-stone-400">{m.days_logged} days</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      pct >= 75 ? 'bg-emerald-100 text-emerald-700' :
                      pct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-50 text-red-600'
                    }`}>{Math.round(pct)}%</span>
                  </div>
                );
              })}
            </div>

            {/* Food manager shortcut */}
            <button onClick={() => navigate('/admin/foods')}
              className="w-full py-3 bg-[#0e0e12] hover:bg-[#08080b] text-white font-semibold rounded-2xl text-sm transition-colors flex items-center justify-center gap-2">
              🥗 Food Database Manager
              <span className="text-stone-400 text-xs">→</span>
            </button>
          </div>
        )}

        {tab === 'overview' && !overview && !loading && (
          <p className="text-center text-stone-400 py-8">Overview data loading…</p>
        )}

        {/* ── Members tab ── */}
        {tab === 'members' && (
          <>
            {filtered(members, 'name').length === 0 ? (
              <div className="text-center py-16 text-stone-400">
                <div className="text-4xl mb-3">👥</div>
                <p className="font-medium">No members yet</p>
                <button onClick={() => setShowAddMember(true)}
                  className="mt-3 text-emerald-600 font-semibold text-sm">+ Add first member</button>
              </div>
            ) : (
              filtered(members, 'name').map(m => {
                const noLog = m.last_logged !== today;
                return (
                  <div key={m.id} className={`bg-[#131317] rounded-2xl border border-white/[0.08] p-4 shadow-card border
                    ${!m.active ? 'opacity-50 border-stone-200' : noLog ? 'border-amber-200' : 'border-stone-100'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-stone-800 truncate">{m.name}</h3>
                          {!m.active && <span className="text-xs bg-stone-100 text-stone-400 px-2 py-0.5 rounded-full">Inactive</span>}
                        </div>
                        <p className="text-xs text-stone-400 mt-0.5">📱 {m.phone}</p>
                        {m.monitor_name ? (
                          <p className="text-xs text-emerald-600 mt-0.5 font-medium">🏋️ {m.monitor_name}</p>
                        ) : (
                          <p className="text-xs text-amber-500 mt-0.5">⚠ Unassigned</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        {m.latest_weight && (
                          <div className="font-bold text-stone-700 text-sm">{m.latest_weight} kg</div>
                        )}
                        {m.last_compliance != null && (
                          <div className={`text-xs font-bold px-2 py-0.5 rounded-full mt-0.5 inline-block ${
                            m.last_compliance >= 75 ? 'bg-emerald-100 text-emerald-700' :
                            m.last_compliance >= 50 ? 'bg-amber-100 text-amber-700' :
                                                       'bg-red-100 text-red-700'
                          }`}>{m.last_compliance}%</div>
                        )}
                      </div>
                    </div>

                    {/* Row 2 — target + actions */}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-stone-50">
                      <div className="text-xs text-stone-400">
                        {m.start_weight && m.target_weight && (
                          <span>{m.start_weight} kg → {m.target_weight} kg goal</span>
                        )}
                        {noLog && m.active && (
                          <span className="text-amber-500 font-medium ml-2">· No log today</span>
                        )}
                        {/* Sprint 9: PIN status badge */}
                        {m.has_pin === false && m.active && (
                          <span className="text-amber-600 font-semibold ml-2">· 🔑 No PIN set</span>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => setAssignTarget(m)}
                          className="text-xs px-2.5 py-1.5 bg-emerald-50 text-emerald-700 font-semibold
                            rounded-lg hover:bg-emerald-100 transition-colors">
                          Assign
                        </button>
                        <button onClick={() => setEditTarget(m)}
                          className="text-xs px-2.5 py-1.5 bg-blue-50 text-blue-700 font-semibold
                            rounded-lg hover:bg-blue-100 transition-colors">
                          ✏️ Edit
                        </button>
                        <button onClick={() => navigate(`/monitor/${m.id}`)}
                          className="text-xs px-2.5 py-1.5 bg-stone-50 text-stone-600 font-semibold
                            rounded-lg hover:bg-white/[0.05] transition-colors">
                          View
                        </button>
                        <button onClick={() => toggleUser(m.id, 'member')}
                          className={`text-xs px-2.5 py-1.5 font-semibold rounded-lg transition-colors ${
                            m.active
                              ? 'bg-red-50 text-red-600 hover:bg-red-100'
                              : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                          }`}>
                          {m.active ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ── Monitors tab ── */}
        {tab === 'monitors' && (
          <>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-stone-400">{monitors.length} monitor{monitors.length !== 1 ? 's' : ''} registered</p>
              <div className="flex gap-2">
                <button onClick={() => setShowPush(true)}
                  className="flex items-center gap-1.5 text-xs font-bold text-stone-600 bg-stone-100
                    hover:bg-white/[0.08] px-3 py-2 rounded-xl transition-colors">
                  📨 Send Push
                </button>
                <button onClick={() => setShowAddMonitor(true)}
                  className="flex items-center gap-1.5 text-xs font-bold text-white bg-[#0e0e12]
                    hover:bg-[#08080b] px-3 py-2 rounded-xl transition-colors">
                  + Add Monitor
                </button>
              </div>
            </div>
            {filtered(monitors, 'name').length === 0 ? (
              <div className="text-center py-16 text-stone-400">
                <div className="text-4xl mb-3">🏋️</div>
                <p className="font-medium">No monitors yet</p>
                <button onClick={() => setShowAddMonitor(true)}
                  className="mt-3 text-emerald-600 font-semibold text-sm">+ Add first monitor</button>
              </div>
            ) : (
              filtered(monitors, 'name').map(m => (
                <div key={m.id} className={`bg-[#131317] rounded-2xl border border-white/[0.08] p-4 shadow-card border
                  ${!m.active ? 'opacity-50 border-stone-200' : 'border-stone-100'}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-stone-800">{m.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${
                          m.role === 'admin'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {m.role === 'admin' ? '👑 admin' : '🏋️ monitor'}
                        </span>
                        {!m.active && <span className="text-xs bg-stone-100 text-stone-400 px-2 py-0.5 rounded-full">Inactive</span>}
                      </div>
                      <p className="text-xs text-stone-400 mt-0.5">✉ {m.email}</p>
                      <p className="text-xs text-emerald-600 mt-0.5 font-medium">
                        {m.patient_count} member{m.patient_count !== 1 ? 's' : ''} assigned
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => navigate('/monitor')}
                        className="text-xs px-2.5 py-1.5 bg-stone-50 text-stone-600 font-semibold
                          rounded-lg hover:bg-white/[0.05] transition-colors">
                        View
                      </button>
                      {m.id !== user?.id && (
                        <button onClick={() => toggleUser(m.id, 'monitor')}
                          className={`text-xs px-2.5 py-1.5 font-semibold rounded-lg transition-colors ${
                            m.active
                              ? 'bg-red-50 text-red-600 hover:bg-red-100'
                              : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                          }`}>
                          {m.active ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}
        {/* ── Audit tab ── */}
        {tab === 'audit' && (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-stone-400">{auditLog.length} recent actions</p>
              <button onClick={() => getAuditLog(100).then(r => setAuditLog(r.data || []))}
                className="text-xs font-semibold text-stone-500 hover:text-stone-700 px-3 py-1.5
                  bg-[#1a1a20] rounded-xl border border-white/[0.07] border border-stone-200 transition-colors">
                ↻ Refresh
              </button>
            </div>

            {auditLog.length === 0 ? (
              <div className="text-center py-16 text-stone-400">
                <div className="text-4xl mb-3">🔍</div>
                <p className="font-medium">No audit events yet</p>
                <p className="text-sm mt-1">Actions like creating members, resetting PINs, and toggling accounts will appear here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {auditLog.map(entry => {
                  const actionConfig = {
                    member_created:   { icon: '➕', color: 'bg-emerald-50 border-emerald-100 text-emerald-700' },
                    monitor_created:  { icon: '➕', color: 'bg-blue-50 border-blue-100 text-blue-700' },
                    monitor_assigned: { icon: '🔗', color: 'bg-purple-50 border-purple-100 text-purple-700' },
                    member_toggled:   { icon: '⚡', color: 'bg-amber-50 border-amber-100 text-amber-700' },
                    monitor_toggled:  { icon: '⚡', color: 'bg-amber-50 border-amber-100 text-amber-700' },
                    pin_reset:        { icon: '🔑', color: 'bg-orange-50 border-orange-100 text-orange-700' },
                    pin_set:          { icon: '🔑', color: 'bg-orange-50 border-orange-100 text-orange-700' },
                    weight_logged:    { icon: '⚖️', color: 'bg-stone-50 border-stone-100 text-stone-600' },
                  }[entry.action] || { icon: '📝', color: 'bg-stone-50 border-stone-100 text-stone-600' };

                  const timeAgo = (() => {
                    const diff = Date.now() - new Date(entry.created_at).getTime();
                    const mins = Math.floor(diff / 60000);
                    const hrs  = Math.floor(mins / 60);
                    const days = Math.floor(hrs / 24);
                    if (days > 0)  return `${days}d ago`;
                    if (hrs > 0)   return `${hrs}h ago`;
                    if (mins > 0)  return `${mins}m ago`;
                    return 'just now';
                  })();

                  return (
                    <div key={entry.id}
                      className={`rounded-2xl border px-4 py-3 ${actionConfig.color}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span className="text-base flex-shrink-0 mt-0.5">{actionConfig.icon}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{entry.detail || entry.action}</p>
                            <p className="text-xs opacity-70 mt-0.5">
                              by {entry.actor_name}
                              <span className="ml-1 opacity-60 capitalize">({entry.actor_role})</span>
                            </p>
                          </div>
                        </div>
                        <span className="text-xs opacity-60 flex-shrink-0 mt-0.5">{timeAgo}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showAddMember  && <AddMemberModal  monitors={monitors} onClose={() => setShowAddMember(false)}  onAdded={u => { setMembers(prev => [u, ...prev]); load(); }} />}
      {showAddMonitor && <AddMonitorModal onClose={() => setShowAddMonitor(false)} onAdded={u => { setMonitors(prev => [u, ...prev]); load(); }} />}
      {showPush       && <PushModal members={members} onClose={() => setShowPush(false)} />}
      {assignTarget   && <AssignModal member={assignTarget} monitors={monitors}
        onClose={() => setAssignTarget(null)}
        onAssigned={(pid, mid, mname) => {
          setMembers(prev => prev.map(m => m.id === pid ? { ...m, monitor_id: mid, monitor_name: mname } : m));
          setAssignTarget(null);
        }} />}
      {editTarget && <EditMemberModal member={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={updated => {
          setMembers(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m));
          setEditTarget(null);
        }} />}
    </div>
  );
}
