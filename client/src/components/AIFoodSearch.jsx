/**
 * client/src/components/AIFoodSearch.jsx
 *
 * Embedded AI food identifier — no separate search box.
 * Triggered from FoodLog when existing search finds nothing.
 * Auto-runs AI lookup using the query already typed by the user.
 *
 * Props:
 *   initialQuery  — food name already typed in FoodLog (auto-triggers AI)
 *   mealSlot      — "Breakfast" / "Lunch" / "Dinner" etc.
 *   onSelect(food)— called when user taps Add; parent handles logging
 *   t             — design tokens (optional)
 */

import { useState, useEffect } from 'react';
import api from '../api/client';

const MACRO_KEYS = [
  { key:'calories',    label:'Calories',  unit:'kcal', color:'#FF6B35' },
  { key:'protein',     label:'Protein',   unit:'g',    color:'#00D49F' },
  { key:'total_carbs', label:'Carbs',     unit:'g',    color:'#F59E0B' },
  { key:'fat',         label:'Fat',       unit:'g',    color:'#A78BFA' },
  { key:'fiber',       label:'Fiber',     unit:'g',    color:'#4ADE80' },
  { key:'sugar',       label:'Sugar',     unit:'g',    color:'#FB923C' },
];

const VITAMIN_KEYS = [
  {key:'vit_a',label:'Vit A',unit:'mcg'},{key:'vit_b1',label:'B1',unit:'mg'},
  {key:'vit_b2',label:'B2',unit:'mg'},{key:'vit_b3',label:'B3',unit:'mg'},
  {key:'vit_b6',label:'B6',unit:'mg'},{key:'vit_b12',label:'B12',unit:'mcg'},
  {key:'vit_c',label:'Vit C',unit:'mg'},{key:'vit_d',label:'Vit D',unit:'IU'},
  {key:'vit_e',label:'Vit E',unit:'mg'},{key:'vit_k',label:'Vit K',unit:'mcg'},
  {key:'folate',label:'Folate',unit:'mcg'},{key:'biotin',label:'Biotin',unit:'mcg'},
  {key:'choline',label:'Choline',unit:'mg'},
];

const MINERAL_KEYS = [
  {key:'calcium',label:'Calcium',unit:'mg'},{key:'iron',label:'Iron',unit:'mg'},
  {key:'magnesium',label:'Magnesium',unit:'mg'},{key:'phosphorus',label:'Phosphorus',unit:'mg'},
  {key:'potassium',label:'Potassium',unit:'mg'},{key:'sodium',label:'Sodium',unit:'mg'},
  {key:'zinc',label:'Zinc',unit:'mg'},{key:'selenium',label:'Selenium',unit:'mcg'},
  {key:'copper',label:'Copper',unit:'mg'},{key:'manganese',label:'Manganese',unit:'mg'},
];

const OMEGA_KEYS = [
  {key:'omega3_ala',label:'Omega-3 ALA',unit:'mg'},{key:'omega3_epa',label:'EPA',unit:'mg'},
  {key:'omega3_dha',label:'DHA',unit:'mg'},{key:'omega6',label:'Omega-6',unit:'mg'},
];

export default function AIFoodSearch({ initialQuery, mealSlot = 'meal', onSelect, t }) {
  const [status,  setStatus]  = useState('loading'); // loading | result | error
  const [food,    setFood]    = useState(null);
  const [grams,   setGrams]   = useState(100);
  const [error,   setError]   = useState('');
  const [adding,  setAdding]  = useState(false);

  // Tokens with fallbacks matching FoodLog's existing dark theme
  const accent = t?.accent  || '#00D49F';
  const bg     = t?.card    || '#131317';
  const text   = t?.text    || '#ededf0';
  const muted  = t?.muted   || '#6a6a78';
  const faint  = t?.faint   || '#1a1a20';
  const border = t?.cardBorder || 'rgba(255,255,255,0.1)';
  const font   = t?.font    || 'inherit';
  const r      = t?.r       || 14;

  // Auto-trigger AI as soon as the component mounts
  useEffect(() => {
    if (!initialQuery?.trim()) { setStatus('error'); setError('No food name provided.'); return; }
    runAI(initialQuery.trim());
  }, [initialQuery]);

  const runAI = async (name) => {
    setStatus('loading');
    setError('');
    try {
      const { data } = await api.post('/foods/ai-identify', { name });
      if (data.alreadyExists) {
        setFood(data.food);
      } else {
        setFood(data.food);
      }
      setGrams(100);
      setStatus('result');
    } catch (err) {
      setError(err.response?.data?.error || 'AI lookup failed. Please try again.');
      setStatus('error');
    }
  };

  // Single action: save to DB silently + add to meal log
  const handleAdd = async () => {
    if (!food || adding) return;
    setAdding(true);
    try {
      // Build the aliases list: AI aliases + user's typed query
      // This ensures "Ragi mudde" is findable next time, not just "Finger Millet Ball"
      const existingAliases = Array.isArray(food.name_aliases) ? food.name_aliases : [];
      const userQuery = (initialQuery || '').trim();
      const allAliases = [
        ...existingAliases,
        userQuery,
        food.name,  // also keep canonical as alias so both names are searchable
      ].filter((v, i, arr) =>
        v && v.trim() &&
        arr.findIndex(x => x?.toLowerCase().trim() === v?.toLowerCase().trim()) === i
      );

      // Save to DB with user's typed name included in aliases — fire and forget
      api.post('/foods/ai-confirm', {
        food: { ...food, name_aliases: allAliases }
      }).catch(() => {});

      // Log it immediately in the selected meal
      onSelect?.({
        ...food,
        name:     userQuery || food.name,  // show user's typed name in the log
        per_100g: food.per_100g,           // explicit — never lost
        grams,
      });
    } finally {
      setAdding(false);
    }
  };

  const sc = (v) => v == null ? '0' : ((v * grams) / 100).toFixed(1).replace(/\.0$/, '');

  const card  = { background: bg, border: `1.5px solid ${border}`, borderRadius: r, padding: 14 };
  const mBox  = (col) => ({
    background: `${col}18`, borderRadius: r - 4, padding: '10px 6px',
    textAlign: 'center', border: `1px solid ${col}30`,
  });
  const micro = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(78px,1fr))', gap: 6 };
  const chip  = (col) => ({
    display: 'inline-block', padding: '3px 10px', borderRadius: 20,
    fontSize: 11, fontWeight: 600, background: `${col}20`,
    color: col, border: `1px solid ${col}40`, marginRight: 4, marginBottom: 4,
  });

  // ── Loading ────────────────────────────────────────────────────────────────
  if (status === 'loading') return (
    <div style={{ ...card, textAlign: 'center', padding: 20 }}>
      <div style={{ fontSize: 13, color: muted, marginBottom: 12, fontFamily: font }}>
        Identifying <b style={{ color: text }}>"{initialQuery}"</b>…
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        {['Macros','Vitamins','Minerals','Omega-3s','Serving info'].map((l, i) => (
          <span key={l} style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 20,
            background: `${accent}15`, color: accent,
            border: `1px solid ${accent}30`, fontFamily: font,
            animation: `aipulse 1.5s ${i * 0.28}s ease-in-out infinite`,
          }}>{l}</span>
        ))}
      </div>
      <style>{`@keyframes aipulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
    </div>
  );

  // ── Error ──────────────────────────────────────────────────────────────────
  if (status === 'error') return (
    <div style={{ ...card, textAlign: 'center', padding: 16 }}>
      <div style={{ color: '#EF4444', fontSize: 13, marginBottom: 12, fontFamily: font }}>{error}</div>
      <button onClick={() => runAI(initialQuery)} style={{
        padding: '8px 20px', borderRadius: r, background: accent,
        color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13,
        fontWeight: 700, fontFamily: font,
      }}>Try again</button>
    </div>
  );

  // ── Result ─────────────────────────────────────────────────────────────────
  return (
    <div style={card}>

      {/* Name + badges */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: 16, fontWeight: 800, color: text, fontFamily: font }}>{food.name}</span>
            {food.name_hindi && (
              <span style={{ fontSize: 13, color: muted, marginLeft: 6, fontFamily: font }}>({food.name_hindi})</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={chip(accent)}>✨ AI Identified</span>
            <span style={chip(
              food.data_confidence === 'high' ? '#4ADE80' :
              food.data_confidence === 'medium' ? '#F59E0B' : '#EF4444'
            )}>
              {food.data_confidence === 'high' ? '✓ High confidence' : '~ Medium confidence'}
            </span>
          </div>
        </div>
        {food.category && (
          <div style={{ fontSize: 11, color: muted, marginTop: 3, fontFamily: font }}>{food.category}</div>
        )}
      </div>

      {/* Description */}
      {food.description && (
        <div style={{
          fontSize: 12, color: muted, lineHeight: 1.65, marginBottom: 10,
          padding: '10px 12px', background: faint, borderRadius: r - 4,
          borderLeft: `3px solid ${accent}`, fontFamily: font,
        }}>
          {food.description}
        </div>
      )}

      {/* Dietary tags */}
      {food.dietary_tags?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {food.dietary_tags.map(tag => (
            <span key={tag} style={chip('#4ADE80')}>{tag}</span>
          ))}
        </div>
      )}

      {/* Health note */}
      {food.health_note && (
        <div style={{
          fontSize: 12, color: '#4ADE80', padding: '8px 12px', marginBottom: 10,
          background: 'rgba(74,222,128,0.07)', borderRadius: r - 4,
          borderLeft: '3px solid #4ADE80', fontFamily: font,
        }}>
          💡 {food.health_note}
        </div>
      )}

      {/* Serving size picker */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '10px 12px', background: faint, borderRadius: r - 4, marginBottom: 12,
      }}>
        <span style={{ fontSize: 12, color: muted, fontFamily: font, whiteSpace: 'nowrap' }}>Serving:</span>
        <input
          type="number" min={1} max={2000} value={grams}
          onChange={e => setGrams(Math.max(1, parseInt(e.target.value) || 100))}
          style={{
            width: 64, height: 32, borderRadius: 8,
            border: `1.5px solid ${accent}60`,
            background: bg, color: text, fontSize: 14, fontWeight: 700,
            textAlign: 'center', fontFamily: font, outline: 'none',
          }}
        />
        <span style={{ fontSize: 12, color: muted, fontFamily: font }}>g</span>
        {food.serving_sizes?.map(ss => (
          <button key={ss.label} onClick={() => setGrams(ss.grams)} style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 11,
            background: grams === ss.grams ? accent : 'transparent',
            color: grams === ss.grams ? '#fff' : muted,
            border: `1px solid ${grams === ss.grams ? accent : border}`,
            cursor: 'pointer', fontFamily: font,
            fontWeight: grams === ss.grams ? 700 : 400,
          }}>{ss.label}</button>
        ))}
      </div>

      {/* Macros */}
      <div style={{ fontSize: 11, color: muted, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8, fontFamily: font }}>
        Macros · per {grams}g
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
        {MACRO_KEYS.map(m => (
          <div key={m.key} style={mBox(m.color)}>
            <div style={{ fontSize: 17, fontWeight: 800, color: m.color, fontFamily: font }}>{sc(food.per_100g?.[m.key])}</div>
            <div style={{ fontSize: 10, color: muted, marginTop: 2, fontFamily: font }}>{m.label} {m.unit}</div>
          </div>
        ))}
      </div>

      {/* Vitamins — collapsible */}
      <details style={{ marginBottom: 8 }}>
        <summary style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer', marginBottom: 8, fontFamily: font }}>
          ▶ Vitamins · tap to expand
        </summary>
        <div style={micro}>
          {VITAMIN_KEYS.map(v => (
            <div key={v.key} style={mBox('#A78BFA')}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#A78BFA', fontFamily: font }}>{sc(food.per_100g?.[v.key])}</div>
              <div style={{ fontSize: 9, color: muted, marginTop: 1, fontFamily: font }}>{v.label} {v.unit}</div>
            </div>
          ))}
        </div>
      </details>

      {/* Minerals — collapsible */}
      <details style={{ marginBottom: 8 }}>
        <summary style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer', marginBottom: 8, fontFamily: font }}>
          ▶ Minerals · tap to expand
        </summary>
        <div style={micro}>
          {MINERAL_KEYS.map(m => (
            <div key={m.key} style={mBox('#4A9EFF')}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#4A9EFF', fontFamily: font }}>{sc(food.per_100g?.[m.key])}</div>
              <div style={{ fontSize: 9, color: muted, marginTop: 1, fontFamily: font }}>{m.label} {m.unit}</div>
            </div>
          ))}
        </div>
      </details>

      {/* Omega fatty acids — collapsible */}
      <details style={{ marginBottom: 12 }}>
        <summary style={{ fontSize: 11, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer', marginBottom: 8, fontFamily: font }}>
          ▶ Omega fatty acids · tap to expand
        </summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
          {OMEGA_KEYS.map(o => (
            <div key={o.key} style={mBox(accent)}>
              <div style={{ fontSize: 13, fontWeight: 700, color: accent, fontFamily: font }}>{sc(food.per_100g?.[o.key])}</div>
              <div style={{ fontSize: 9, color: muted, marginTop: 1, fontFamily: font }}>{o.label} {o.unit}</div>
            </div>
          ))}
        </div>
      </details>

      {/* Aliases */}
      {food.name_aliases?.length > 0 && (
        <div style={{ fontSize: 11, color: muted, marginBottom: 12, fontFamily: font }}>
          Also known as: {food.name_aliases.join(' · ')}
        </div>
      )}

      {/* SINGLE action button — adds to meal + saves to DB in one tap */}
      <button
        onClick={handleAdd}
        disabled={adding}
        style={{
          width: '100%', height: 48, borderRadius: r,
          background: adding ? `${accent}60` : accent,
          color: '#fff', border: 'none',
          cursor: adding ? 'not-allowed' : 'pointer',
          fontSize: 15, fontWeight: 800, fontFamily: font,
        }}
      >
        {adding ? 'Adding…' : `+ Add to ${mealSlot}`}
      </button>

      <div style={{ fontSize: 10, color: muted, textAlign: 'center', marginTop: 6, fontFamily: font }}>
        Also saves to database so everyone can find it next time
      </div>
    </div>
  );
}
