/**
 * components/food/portions.js — typical gram amounts, smart defaults, and the portion picker.
 * Moved out of components/FoodLog.jsx verbatim (Sprint 12c). Behaviour unchanged.
 */
import { useState } from 'react';
import { haptic } from '../../store/settingsStore';

export const TYPICAL_GRAMS = {
  // Eggs
  egg: 55, 'boiled egg': 55, 'fried egg': 55, 'scrambled egg': 100, 'omelette': 120,
  // Dairy
  curd: 100, yogurt: 100, 'greek yogurt': 150, paneer: 100, 'low fat paneer': 100,
  'whole milk': 200, milk: 200, buttermilk: 200, 'cottage cheese': 100,
  // Bread/rotis
  chapati: 30, roti: 30, phulka: 25, paratha: 60, puri: 30, naan: 90,
  'bread slice': 25, 'brown bread': 25, 'white bread': 25, 'multigrain bread': 25,
  idli: 40, dosa: 80, uttapam: 100, appam: 70, 'poha': 60,
  'upma': 150, 'idiyappam': 80, 'puttu': 100,
  // Rice
  rice: 150, 'cooked rice': 150, 'brown rice': 150, 'white rice': 150,
  'red rice': 150, 'basmati rice': 150, 'steamed rice': 150, biryani: 200,
  // Fruits
  banana: 120, apple: 150, orange: 130, mango: 200, papaya: 150,
  watermelon: 200, grapes: 80, pomegranate: 100, guava: 100, pear: 150,
  kiwi: 80, strawberry: 80, blueberry: 80, pineapple: 150, coconut: 40,
  // Vegetables (cooked serving)
  broccoli: 100, spinach: 100, 'palak': 100, carrot: 80, cucumber: 80,
  tomato: 80, onion: 50, 'bell pepper': 80, zucchini: 100, beans: 80,
  'french beans': 80, 'sweet potato': 100, potato: 150, 'baby corn': 50,
  cauliflower: 100, cabbage: 80, 'bitter gourd': 80, drumstick: 60,
  // Proteins
  'chicken breast': 150, chicken: 150, 'chicken curry': 200, 'chicken tikka': 150,
  fish: 150, salmon: 150, tuna: 150, 'rohu': 150, prawn: 100, 'egg white': 30,
  tofu: 100, tempeh: 100, 'soya chunks': 50, 'kidney beans': 100, rajma: 100,
  chana: 100, dal: 150, 'moong dal': 150, 'toor dal': 150, 'masoor dal': 150,
  // Nuts & seeds (small servings)
  almonds: 28, cashews: 28, walnuts: 28, peanuts: 28, pistachios: 28,
  'pumpkin seeds': 20, 'sunflower seeds': 20, 'flaxseeds': 15, 'chia seeds': 15,
  'hemp seeds': 15, 'sesame seeds': 10,
  // Oils & fats
  ghee: 10, 'coconut oil': 10, 'olive oil': 14, butter: 14,
  'peanut butter': 32, 'almond butter': 32,
  // Snacks
  biscuits: 30, 'marie biscuits': 30, 'digestive biscuits': 30,
  'protein bar': 60, 'granola bar': 40, popcorn: 28, chips: 30,
  // Drinks/beverages
  coffee: 240, tea: 240, 'green tea': 240, 'protein shake': 300,
  'fruit juice': 200, 'coconut water': 240, lassi: 200,
  // Indian dishes
  'chole': 150, 'pav bhaji': 200, 'sambar': 150, 'rasam': 150,
  'khichdi': 200, 'daliya': 150, 'muesli': 60, oats: 40,
  // Sweets (small portions)
  ladoo: 30, barfi: 30, halwa: 60, kheer: 100, rasgulla: 50,
};

export function smartGrams(foodName) {
  const lc = (foodName || '').toLowerCase();
  for (const [key, g] of Object.entries(TYPICAL_GRAMS)) {
    if (lc.includes(key)) return g;
  }
  return null;
}

// ── Portion Picker ────────────────────────────────────────────────────────────
export const PORTIONS = [
  { label: 'Small',   emoji: '🥛', multiplier: 0.6 },
  { label: 'Medium',  emoji: '🍽',  multiplier: 1.0 },
  { label: 'Large',   emoji: '🫙',  multiplier: 1.5 },
  { label: 'Custom',  emoji: '✏️',  multiplier: null },
];

export function PortionPicker({ baseGrams, onSelect }) {
  const [selected, setSelected] = useState(null);
  if (!baseGrams) return null;
  return (
    <div>
      <p className="text-xs text-faint mb-2 font-medium">How much did you have?</p>
      <div className="grid grid-cols-4 gap-1.5">
        {PORTIONS.map(p => (
          <button key={p.label}
            onClick={() => {
              haptic(18);
              setSelected(p.label);
              if (p.multiplier !== null) onSelect(Math.round(baseGrams * p.multiplier));
              // Custom → user types manually (handled in parent)
            }}
            style={{ minHeight: 60 }}
            className={`rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
              selected === p.label
                ? 'border-gold/50 bg-gold/10'
                : 'border-white/[0.1] bg-surface hover:border-white/[0.2]'}`}>
            <span style={{ fontSize: 20 }}>{p.emoji}</span>
            <span className="text-eyebrow text-mute font-medium">{p.label}</span>
            {p.multiplier !== null && (
              <span className="text-eyebrow text-ghost">{Math.round(baseGrams * p.multiplier)}g</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Traffic light nutrition badge ─────────────────────────────────────────────
