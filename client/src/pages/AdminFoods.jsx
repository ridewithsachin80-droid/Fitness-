/**
 * AdminFoods.jsx — Sprint 7
 * Admin food database manager: search, view, add, edit, delete foods.
 * Accessible via /admin/foods.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { Card, SectionTitle, BackButton } from '../components/UI';

const CATEGORIES = ['grain','vegetable','fruit','protein','dairy','nut','seed','oil','spice','beverage','supplement','other'];

const DEFAULT_NUTRIENTS = {
  calories:0, protein:0, total_carbs:0, net_carbs:0, fat:0, fiber:0, sugar:0,
  saturated_fat:0, cholesterol:0,
  vit_a:0, vit_b1:0, vit_b2:0, vit_b3:0, vit_b5:0, vit_b6:0, vit_b12:0,
  vit_c:0, vit_d:0, vit_e:0, vit_k:0, folate:0, biotin:0, choline:0,
  calcium:0, iron:0, magnesium:0, phosphorus:0, potassium:0, sodium:0,
  zinc:0, copper:0, manganese:0, selenium:0,
  omega3_ala:0, omega3_epa:0, omega3_dha:0, omega6:0,
  lycopene:0, beta_glucan:0,
  glycemic_index:0, glycemic_load:0,
};

const NUTRIENT_GROUPS = [
  { label: 'Macros', keys: ['calories','protein','total_carbs','net_carbs','fat','fiber','sugar','saturated_fat','cholesterol'] },
  { label: 'Vitamins', keys: ['vit_a','vit_b1','vit_b2','vit_b3','vit_b5','vit_b6','vit_b12','vit_c','vit_d','vit_e','vit_k','folate','biotin','choline'] },
  { label: 'Minerals', keys: ['calcium','iron','magnesium','phosphorus','potassium','sodium','zinc','copper','manganese','selenium'] },
  { label: 'Lipids & Specials', keys: ['omega3_ala','omega3_epa','omega3_dha','omega6','lycopene','beta_glucan','glycemic_index','glycemic_load'] },
];

const NUTRIENT_UNITS = {
  calories:'kcal', protein:'g', total_carbs:'g', net_carbs:'g', fat:'g', fiber:'g',
  sugar:'g', saturated_fat:'g', cholesterol:'mg',
  vit_a:'mcg', vit_b1:'mg', vit_b2:'mg', vit_b3:'mg', vit_b5:'mg', vit_b6:'mg',
  vit_b12:'mcg', vit_c:'mg', vit_d:'IU', vit_e:'mg', vit_k:'mcg', folate:'mcg',
  biotin:'mcg', choline:'mg',
  calcium:'mg', iron:'mg', magnesium:'mg', phosphorus:'mg', potassium:'mg',
  sodium:'mg', zinc:'mg', copper:'mg', manganese:'mg', selenium:'mcg',
  omega3_ala:'mg', omega3_epa:'mg', omega3_dha:'mg', omega6:'mg',
  lycopene:'mcg', beta_glucan:'g', glycemic_index:'', glycemic_load:'',
};

function emptyForm() {
  return {
    name: '', name_hindi: '', name_local: '', category: 'vegetable', source: 'manual', verified: true,
    per_100g: { ...DEFAULT_NUTRIENTS },
  };
}

function FoodForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || emptyForm());
  const [nutrientTab, setNutrientTab] = useState('Macros');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setN = (k, v) => setForm(f => ({ ...f, per_100g: { ...f.per_100g, [k]: parseFloat(v) || 0 } }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">Name *</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Brown Rice (Cooked)"
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">Hindi Name</label>
          <input value={form.name_hindi} onChange={e => set('name_hindi', e.target.value)} placeholder="ब्राउन राइस"
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">Local / Brand Name</label>
          <input value={form.name_local} onChange={e => set('name_local', e.target.value)} placeholder="Aashirvaad Brown Rice"
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">Category</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white">
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">Source</label>
          <select value={form.source} onChange={e => set('source', e.target.value)}
            className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white">
            {['manual','nin','usda','ifct','branded','openfoodfacts'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <input type="checkbox" id="verified" checked={form.verified} onChange={e => set('verified', e.target.checked)}
            className="w-4 h-4 accent-emerald-600" />
          <label htmlFor="verified" className="text-sm font-medium text-stone-700">Verified (trusted data source)</label>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Nutrients per 100g</p>
        <div className="flex gap-1 bg-stone-100 p-1 rounded-xl mb-3">
          {NUTRIENT_GROUPS.map(g => (
            <button key={g.label} onClick={() => setNutrientTab(g.label)}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                nutrientTab === g.label ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500'}`}>
              {g.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {NUTRIENT_GROUPS.find(g => g.label === nutrientTab)?.keys.map(k => (
            <div key={k}>
              <label className="block text-xs text-stone-500 mb-1 capitalize">
                {k.replace(/_/g,' ')} {NUTRIENT_UNITS[k] ? `(${NUTRIENT_UNITS[k]})` : ''}
              </label>
              <input type="number" step="0.001" value={form.per_100g[k] || ''}
                onChange={e => setN(k, e.target.value)}
                className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button onClick={() => onSave(form)} disabled={saving || !form.name.trim()}
          className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl transition-colors">
          {saving ? 'Saving…' : 'Save Food'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-3 text-stone-600 border border-stone-200 rounded-xl hover:bg-stone-50 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function AdminFoods() {
  const navigate    = useNavigate();
  const [foods,     setFoods]     = useState([]);
  const [total,     setTotal]     = useState(0);
  const [page,      setPage]      = useState(1);
  const [pages,     setPages]     = useState(1);
  const [query,     setQuery]     = useState('');
  const [loading,   setLoading]   = useState(true);
  const [mode,      setMode]      = useState('list'); // list | add | edit
  const [editing,   setEditing]   = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const debRef = useRef(null);

  const load = useCallback(async (q = query, p = page) => {
    setLoading(true);
    try {
      const { data } = await api.get('/foods/admin/list', { params: { q, page: p, limit: 30 } });
      setFoods(data.foods);
      setTotal(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch { setError('Failed to load foods'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load('', 1); }, []);

  const handleSearch = (v) => {
    setQuery(v);
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => load(v, 1), 400);
  };

  const handleSave = async (form) => {
    setSaving(true); setError('');
    try {
      if (editing) {
        await api.put(`/foods/${editing.id}`, form);
      } else {
        await api.post('/foods', form);
      }
      setMode('list');
      setEditing(null);
      load(query, page);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (food) => {
    if (!window.confirm(`Delete "${food.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/foods/${food.id}`);
      setFoods(fs => fs.filter(f => f.id !== food.id));
      setTotal(t => t - 1);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to delete');
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0b0e]">
      {/* Header */}
      <div className="bg-[#08080b] text-white px-4 pt-10 pb-5">
        <div className="max-w-2xl mx-auto">
          <BackButton onClick={() => navigate('/admin')} light />
          <div className="flex items-center justify-between mt-3">
            <div>
              <h1 className="text-xl font-bold">Food Database</h1>
              <p className="text-stone-400 text-sm mt-0.5">{total.toLocaleString()} foods · Indian + USDA</p>
            </div>
            <button onClick={() => { setEditing(null); setMode('add'); }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-colors">
              + Add Food
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-10 space-y-3">

        {error && <p className="text-red-600 text-xs bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

        {/* Add / Edit form */}
        {(mode === 'add' || mode === 'edit') && (
          <Card>
            <SectionTitle icon={mode === 'add' ? '➕' : '✏️'}>
              {mode === 'add' ? 'Add New Food' : `Edit: ${editing?.name}`}
            </SectionTitle>
            <FoodForm
              initial={mode === 'edit' && editing
                ? { ...editing, per_100g: { ...DEFAULT_NUTRIENTS, ...(editing.per_100g || {}) } }
                : null}
              onSave={handleSave}
              onCancel={() => { setMode('list'); setEditing(null); }}
              saving={saving}
            />
          </Card>
        )}

        {/* Search */}
        {mode === 'list' && (
          <>
            <input value={query} onChange={e => handleSearch(e.target.value)}
              placeholder="Search foods by name…"
              className="w-full px-4 py-3 bg-[#1a1a20] border border-white/[0.10] rounded-2xl text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />

            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {foods.length === 0 ? (
                    <p className="text-center text-stone-400 py-12">No foods found. Try a different search or add one.</p>
                  ) : foods.map(food => (
                    <div key={food.id} className="bg-[#131317] rounded-2xl border border-white/[0.08] px-4 py-3 flex items-center gap-3 group shadow-sm">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-stone-800 text-sm truncate">{food.name}</span>
                          {food.verified && <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">✓</span>}
                          <span className="text-xs bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">{food.category}</span>
                          <span className="text-xs text-stone-400">{food.source}</span>
                        </div>
                        {food.name_local && <p className="text-xs text-stone-400 mt-0.5">{food.name_local}</p>}
                        {food.kcal_per_100g && (
                          <p className="text-xs font-semibold text-orange-500 mt-0.5">{Math.round(food.kcal_per_100g)} kcal/100g</p>
                        )}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditing(food); setMode('edit'); }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors text-sm">
                          ✏️
                        </button>
                        <button onClick={() => handleDelete(food)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors text-sm">
                          🗑
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {pages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <button onClick={() => load(query, page - 1)} disabled={page <= 1}
                      className="px-4 py-2 text-sm font-semibold text-stone-600 bg-[#1a1a20] rounded-xl border border-white/[0.07] border border-stone-200 disabled:opacity-40 hover:bg-stone-50 transition-colors">
                      ← Prev
                    </button>
                    <span className="text-xs text-stone-500 font-medium">Page {page} of {pages}</span>
                    <button onClick={() => load(query, page + 1)} disabled={page >= pages}
                      className="px-4 py-2 text-sm font-semibold text-stone-600 bg-[#1a1a20] rounded-xl border border-white/[0.07] border border-stone-200 disabled:opacity-40 hover:bg-stone-50 transition-colors">
                      Next →
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
