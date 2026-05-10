/**
 * client/src/components/AIFoodSearch.jsx
 *
 * Smart food search that falls back to AI identification when our DB
 * doesn't have a result. Works in 4 states:
 *
 *   1. IDLE        — empty search box
 *   2. SEARCHING   — debounced DB query running
 *   3. RESULTS     — DB found ≥1 match, show list
 *   4. AI_PROMPT   — DB found 0 results, offer AI lookup
 *   5. AI_LOADING  — waiting for Claude response
 *   6. AI_RESULT   — show full nutrition card; confirm to save & log
 *
 * Props:
 *   onSelect(foodItem, grams)  — called when user taps "Add to log"
 *   mealSlot                  — e.g. "Breakfast"
 *   t                         — design tokens (from settingsStore / age mode)
 *
 * Drop-in usage (inside FoodLog.jsx or any meal slot):
 *   <AIFoodSearch onSelect={handleAddFood} mealSlot="Lunch" t={tokens} />
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import api from '../api/client';

// ── Nutrient display config ──────────────────────────────────────────────────
const MACRO_KEYS = [
  { key: 'calories',    label: 'Calories',    unit: 'kcal', color: '#FF6B35' },
  { key: 'protein',     label: 'Protein',     unit: 'g',    color: '#00D49F' },
  { key: 'total_carbs', label: 'Carbs',       unit: 'g',    color: '#F59E0B' },
  { key: 'fat',         label: 'Fat',         unit: 'g',    color: '#A78BFA' },
  { key: 'fiber',       label: 'Fiber',       unit: 'g',    color: '#4ADE80' },
  { key: 'sugar',       label: 'Sugar',       unit: 'g',    color: '#FB923C' },
];

const VITAMIN_KEYS = [
  { key: 'vit_a',   label: 'Vit A',   unit: 'mcg' },
  { key: 'vit_b1',  label: 'B1',      unit: 'mg'  },
  { key: 'vit_b2',  label: 'B2',      unit: 'mg'  },
  { key: 'vit_b3',  label: 'B3',      unit: 'mg'  },
  { key: 'vit_b6',  label: 'B6',      unit: 'mg'  },
  { key: 'vit_b12', label: 'B12',     unit: 'mcg' },
  { key: 'vit_c',   label: 'Vit C',   unit: 'mg'  },
  { key: 'vit_d',   label: 'Vit D',   unit: 'IU'  },
  { key: 'vit_e',   label: 'Vit E',   unit: 'mg'  },
  { key: 'vit_k',   label: 'Vit K',   unit: 'mcg' },
  { key: 'folate',  label: 'Folate',  unit: 'mcg' },
  { key: 'biotin',  label: 'Biotin',  unit: 'mcg' },
  { key: 'choline', label: 'Choline', unit: 'mg'  },
];

const MINERAL_KEYS = [
  { key: 'calcium',    label: 'Calcium',    unit: 'mg'  },
  { key: 'iron',       label: 'Iron',       unit: 'mg'  },
  { key: 'magnesium',  label: 'Magnesium',  unit: 'mg'  },
  { key: 'phosphorus', label: 'Phosphorus', unit: 'mg'  },
  { key: 'potassium',  label: 'Potassium',  unit: 'mg'  },
  { key: 'sodium',     label: 'Sodium',     unit: 'mg'  },
  { key: 'zinc',       label: 'Zinc',       unit: 'mg'  },
  { key: 'selenium',   label: 'Selenium',   unit: 'mcg' },
  { key: 'copper',     label: 'Copper',     unit: 'mg'  },
  { key: 'manganese',  label: 'Manganese',  unit: 'mg'  },
];

const OMEGA_KEYS = [
  { key: 'omega3_ala', label: 'Omega-3 ALA', unit: 'mg' },
  { key: 'omega3_epa', label: 'Omega-3 EPA', unit: 'mg' },
  { key: 'omega3_dha', label: 'Omega-3 DHA', unit: 'mg' },
  { key: 'omega6',     label: 'Omega-6',     unit: 'mg' },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function AIFoodSearch({ onSelect, mealSlot = 'Meal', t }) {
  const [query,      setQuery]      = useState('');
  const [state,      setState]      = useState('idle');   // idle|searching|results|ai_prompt|ai_loading|ai_result
  const [results,    setResults]    = useState([]);
  const [aiFood,     setAiFood]     = useState(null);
  const [grams,      setGrams]      = useState(100);
  const [saving,     setSaving]     = useState(false);
  const [saveMsg,    setSaveMsg]    = useState('');
  const [error,      setError]      = useState('');
  const debounceRef  = useRef(null);

  // Colours from tokens or defaults
  const accent  = t?.accent  || '#00D49F';
  const bg      = t?.card    || '#131720';
  const text    = t?.text    || '#EBF0F8';
  const muted   = t?.muted   || '#8A93A6';
  const faint   = t?.faint   || '#181D28';
  const border  = t?.cardBorder || 'rgba(255,255,255,0.07)';
  const font    = t?.font    || 'sans-serif';
  const radius  = t?.r       || 14;

  // ── Search DB ──────────────────────────────────────────────────────────────
  const searchDB = useCallback(async (q) => {
    if (!q || q.length < 2) { setState('idle'); setResults([]); return; }
    setState('searching');
    setError('');
    try {
      const { data } = await api.get(`/foods/search?q=${encodeURIComponent(q)}&limit=8`);
      setResults(data);
      setState(data.length > 0 ? 'results' : 'ai_prompt');
    } catch {
      setState('ai_prompt');
    }
  }, []);

  const handleInput = (e) => {
    const q = e.target.value;
    setQuery(q);
    setAiFood(null);
    setSaveMsg('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchDB(q), 400);
  };

  // ── Ask AI ─────────────────────────────────────────────────────────────────
  const askAI = async () => {
    if (!query.trim()) return;
    setState('ai_loading');
    setError('');
    try {
      const { data } = await api.post('/foods/ai-identify', { name: query.trim() });
      if (data.alreadyExists) {
        // Already in DB — treat as a normal result
        setResults([data.food]);
        setState('results');
      } else {
        setAiFood(data.food);
        setState('ai_result');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'AI lookup failed. Please try again.');
      setState('ai_prompt');
    }
  };

  // ── Save to DB ─────────────────────────────────────────────────────────────
  const saveToDb = async () => {
    if (!aiFood || saving) return;
    setSaving(true);
    try {
      const { data } = await api.post('/foods/ai-confirm', { food: aiFood });
      setSaveMsg(data.message);
      // Update local aiFood with confirmed DB id
      setAiFood(prev => ({ ...prev, id: data.id }));
    } catch (err) {
      setSaveMsg(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Add to log ─────────────────────────────────────────────────────────────
  const addToLog = (food) => {
    onSelect?.({ ...food, grams });
    setQuery('');
    setState('idle');
    setResults([]);
    setAiFood(null);
    setSaveMsg('');
  };

  // ── Scale nutrition values by grams ───────────────────────────────────────
  const scaled = (val) => val == null ? 0 : +((val * grams) / 100).toFixed(2);

  // ── Styles helpers ─────────────────────────────────────────────────────────
  const card  = { background: bg, border: `1.5px solid ${border}`, borderRadius: radius, padding: 16 };
  const chip  = (col) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${col}20`, color: col, border: `1px solid ${col}40`, marginRight: 4, marginBottom: 4 });
  const micro = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 6 };
  const mBox  = (col = '#4A9EFF') => ({ background: `${col}12`, borderRadius: 8, padding: '6px 8px', textAlign: 'center', border: `1px solid ${col}25` });

  return (
    <div style={{ fontFamily: font, color: text }}>

      {/* ── Search Input ──────────────────────────────────────────────────── */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <input
          value={query}
          onChange={handleInput}
          placeholder={`Search food or enter any name…`}
          style={{
            width: '100%', height: 48, borderRadius: radius,
            border: `1.5px solid ${state === 'ai_result' ? accent : border}`,
            background: faint, color: text, fontSize: 15, fontFamily: font,
            padding: '0 44px 0 16px', outline: 'none',
          }}
        />
        {state === 'searching' && (
          <div style={{ position: 'absolute', right: 14, top: 14, width: 20, height: 20, borderRadius: '50%', border: `2px solid ${accent}`, borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
        )}
        {query && state !== 'searching' && (
          <button onClick={() => { setQuery(''); setState('idle'); setResults([]); setAiFood(null); setSaveMsg(''); }}
            style={{ position: 'absolute', right: 12, top: 12, width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: 'none', color: muted, fontSize: 14, cursor: 'pointer' }}>✕</button>
        )}
      </div>

      {/* ── DB Results ────────────────────────────────────────────────────── */}
      {state === 'results' && results.length > 0 && (
        <div style={{ ...card, marginBottom: 8 }}>
          {results.map((f, i) => (
            <div key={f.id} onClick={() => addToLog(f)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 0', borderTop: i > 0 ? `1px solid ${border}` : 'none',
              cursor: 'pointer',
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{f.name}</div>
                <div style={{ fontSize: 11, color: muted, marginTop: 2 }}>
                  {f.per_100g?.calories} kcal · {f.per_100g?.protein}g protein per 100g
                  {f.source === 'ai' && <span style={{ ...chip(accent), marginLeft: 6 }}>AI</span>}
                </div>
              </div>
              <button style={{ padding: '6px 14px', borderRadius: radius - 4, background: accent, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>+ Add</button>
            </div>
          ))}
          {/* Offer AI for more precise match */}
          <div style={{ borderTop: `1px solid ${border}`, paddingTop: 10, marginTop: 4 }}>
            <button onClick={askAI} style={{ fontSize: 12, color: accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: font }}>
              ✨ Not the right one? Let AI identify "{query}" with full nutrition
            </button>
          </div>
        </div>
      )}

      {/* ── AI Prompt (no DB results) ─────────────────────────────────────── */}
      {state === 'ai_prompt' && query.length >= 2 && (
        <div style={{ ...card, textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            "{query}" isn't in our database yet
          </div>
          <div style={{ fontSize: 12, color: muted, marginBottom: 16 }}>
            Our AI can identify it and give you the complete nutrition data —<br/>
            macros, all vitamins, all minerals, omega-3s, and more.
          </div>
          {error && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <button onClick={askAI} style={{
            width: '100%', height: 48, borderRadius: radius, background: accent,
            color: '#fff', border: 'none', cursor: 'pointer', fontSize: 15,
            fontWeight: 700, fontFamily: font,
          }}>
            ✨ Identify with AI
          </button>
          <div style={{ fontSize: 11, color: muted, marginTop: 8 }}>
            Powered by Claude · Result saved to database for everyone
          </div>
        </div>
      )}

      {/* ── AI Loading ────────────────────────────────────────────────────── */}
      {state === 'ai_loading' && (
        <div style={{ ...card, textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Identifying "{query}"…</div>
          <div style={{ fontSize: 12, color: muted }}>
            Pulling macros, vitamins, minerals and more from nutrition databases
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 6, justifyContent: 'center' }}>
            {['Calories','Vitamins','Minerals','Omega-3s'].map((l,i) => (
              <span key={l} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, background: `${accent}20`, color: accent, border: `1px solid ${accent}40`, animation: `fade 1.4s ${i*0.3}s ease-in-out infinite` }}>{l}</span>
            ))}
          </div>
          <style>{`@keyframes fade{0%,100%{opacity:0.3}50%{opacity:1}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* ── AI Result Card ────────────────────────────────────────────────── */}
      {state === 'ai_result' && aiFood && (
        <div style={{ ...card }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 18, fontWeight: 800 }}>{aiFood.name}</span>
                {aiFood.name_hindi && <span style={{ fontSize: 13, color: muted }}>({aiFood.name_hindi})</span>}
                <span style={{ ...chip(accent), fontSize: 10 }}>✨ AI Identified</span>
                <span style={{ ...chip(
                  aiFood.data_confidence === 'high' ? '#4ADE80' :
                  aiFood.data_confidence === 'medium' ? '#F59E0B' : '#EF4444'
                ) }}>{aiFood.data_confidence === 'high' ? '✓ High confidence' : aiFood.data_confidence === 'medium' ? '~ Medium confidence' : '? Low confidence'}</span>
              </div>
              {aiFood.category && <div style={{ fontSize: 11, color: muted, marginTop: 3 }}>{aiFood.category}</div>}
            </div>
          </div>

          {/* Description */}
          {aiFood.description && (
            <div style={{ fontSize: 12, color: muted, lineHeight: 1.6, marginBottom: 12, padding: '10px 14px', background: faint, borderRadius: radius - 4, borderLeft: `3px solid ${accent}` }}>
              {aiFood.description}
            </div>
          )}

          {/* Dietary tags */}
          {aiFood.dietary_tags?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {aiFood.dietary_tags.map(tag => (
                <span key={tag} style={chip('#4ADE80')}>{tag}</span>
              ))}
            </div>
          )}

          {/* Serving size selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 14px', background: faint, borderRadius: radius - 4 }}>
            <span style={{ fontSize: 12, color: muted, whiteSpace: 'nowrap' }}>Serving size:</span>
            <input type="number" min={1} max={2000} value={grams}
              onChange={e => setGrams(Math.max(1, parseInt(e.target.value) || 100))}
              style={{ width: 70, height: 32, borderRadius: 8, border: `1.5px solid ${border}`, background: bg, color: text, fontSize: 14, fontWeight: 700, textAlign: 'center', fontFamily: font, outline: 'none' }} />
            <span style={{ fontSize: 12, color: muted }}>grams</span>
            {aiFood.serving_sizes?.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {aiFood.serving_sizes.map(ss => (
                  <button key={ss.label} onClick={() => setGrams(ss.grams)} style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                    background: grams === ss.grams ? accent : 'transparent',
                    color: grams === ss.grams ? '#fff' : muted,
                    border: `1px solid ${grams === ss.grams ? accent : border}`,
                    fontFamily: font,
                  }}>{ss.label} ({ss.grams}g)</button>
                ))}
              </div>
            )}
          </div>

          {/* Macros grid */}
          <div style={{ fontSize: 11, color: muted, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
            Macros · for {grams}g
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
            {MACRO_KEYS.map(m => (
              <div key={m.key} style={{ ...mBox(m.color), padding: '10px 8px' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: m.color }}>{scaled(aiFood.per_100g?.[m.key])}</div>
                <div style={{ fontSize: 10, color: muted, marginTop: 2 }}>{m.label} {m.unit}</div>
              </div>
            ))}
          </div>

          {/* Health note */}
          {aiFood.health_note && (
            <div style={{ fontSize: 12, color: '#4ADE80', padding: '8px 12px', background: 'rgba(74,222,128,0.08)', borderRadius: 8, marginBottom: 14, borderLeft: '3px solid #4ADE80' }}>
              💡 {aiFood.health_note}
            </div>
          )}

          {/* Vitamins */}
          <details style={{ marginBottom: 10 }}>
            <summary style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer', marginBottom: 8, userSelect: 'none' }}>
              Vitamins · tap to expand
            </summary>
            <div style={micro}>
              {VITAMIN_KEYS.map(v => (
                <div key={v.key} style={mBox('#A78BFA')}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#A78BFA' }}>{scaled(aiFood.per_100g?.[v.key])}</div>
                  <div style={{ fontSize: 9, color: muted, marginTop: 1 }}>{v.label} {v.unit}</div>
                </div>
              ))}
            </div>
          </details>

          {/* Minerals */}
          <details style={{ marginBottom: 10 }}>
            <summary style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer', marginBottom: 8, userSelect: 'none' }}>
              Minerals · tap to expand
            </summary>
            <div style={micro}>
              {MINERAL_KEYS.map(m => (
                <div key={m.key} style={mBox('#4A9EFF')}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#4A9EFF' }}>{scaled(aiFood.per_100g?.[m.key])}</div>
                  <div style={{ fontSize: 9, color: muted, marginTop: 1 }}>{m.label} {m.unit}</div>
                </div>
              ))}
            </div>
          </details>

          {/* Omega fatty acids */}
          <details style={{ marginBottom: 14 }}>
            <summary style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer', marginBottom: 8, userSelect: 'none' }}>
              Omega fatty acids · tap to expand
            </summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
              {OMEGA_KEYS.map(o => (
                <div key={o.key} style={mBox('#00D49F')}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#00D49F' }}>{scaled(aiFood.per_100g?.[o.key])}</div>
                  <div style={{ fontSize: 9, color: muted, marginTop: 1 }}>{o.label} {o.unit}</div>
                </div>
              ))}
            </div>
          </details>

          {/* Aliases */}
          {aiFood.name_aliases?.length > 0 && (
            <div style={{ fontSize: 11, color: muted, marginBottom: 14 }}>
              Also known as: {aiFood.name_aliases.join(' · ')}
            </div>
          )}

          {/* Save message */}
          {saveMsg && (
            <div style={{ fontSize: 12, color: '#4ADE80', padding: '8px 12px', background: 'rgba(74,222,128,0.08)', borderRadius: 8, marginBottom: 12, textAlign: 'center' }}>
              ✅ {saveMsg}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => addToLog({ ...aiFood, per_100g: aiFood.per_100g })} style={{
              flex: 2, height: 48, borderRadius: radius, background: accent,
              color: '#fff', border: 'none', cursor: 'pointer', fontSize: 15,
              fontWeight: 700, fontFamily: font,
            }}>
              ＋ Add to {mealSlot}
            </button>
            {!saveMsg && (
              <button onClick={saveToDb} disabled={saving} style={{
                flex: 1, height: 48, borderRadius: radius,
                background: saving ? 'rgba(255,255,255,0.05)' : 'rgba(0,212,159,0.12)',
                color: accent, border: `1.5px solid ${accent}40`,
                cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13,
                fontWeight: 700, fontFamily: font,
              }}>
                {saving ? 'Saving…' : '💾 Save to DB'}
              </button>
            )}
          </div>
          <div style={{ fontSize: 10, color: muted, textAlign: 'center', marginTop: 8 }}>
            Saving adds this food for all users. Admins can verify accuracy.
          </div>
        </div>
      )}
    </div>
  );
}
