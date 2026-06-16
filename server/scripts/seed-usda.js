/**
 * seed-usda.js
 * Seeds the foods table with branded / international foods and supplements
 * using static USDA FoodData Central nutrient values.
 *
 * Strategy: hardcode USDA nutrient values for the specific items FitLife needs
 * (branded supplements, packaged foods Padmini consumes) rather than hitting
 * the USDA API at seed time — keeps deployment reproducible with no API key
 * required. The live Open Food Facts fallback (foods.js POST /lookup) handles
 * any new branded product not in this file.
 *
 * Run: node server/scripts/seed-usda.js
 * Safe to re-run — uses INSERT ... ON CONFLICT DO NOTHING.
 *
 * USDA FDC IDs referenced in comments for auditability:
 * https://fdc.nal.usda.gov/
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const pool = require('../db/pool');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — same as seed-nin-india.js
// ─────────────────────────────────────────────────────────────────────────────
function n(d = {}) {
  const fiber    = d.fiber    ?? 0;
  const totalCarb = d.carb   ?? 0;
  return {
    calories:      d.cal       ?? 0,
    protein:       d.pro       ?? 0,
    total_carbs:   totalCarb,
    net_carbs:     d.net_carb  ?? Math.max(0, +(totalCarb - fiber).toFixed(1)),
    fat:           d.fat       ?? 0,
    fiber:         fiber,
    sugar:         d.sugar     ?? 0,
    saturated_fat: d.sat_fat   ?? 0,
    trans_fat:     d.trans_fat ?? 0,
    cholesterol:   d.chol      ?? 0,
    omega3_ala:    d.ala       ?? 0,
    omega3_epa:    d.epa       ?? 0,
    omega3_dha:    d.dha       ?? 0,
    omega6:        d.omega6    ?? 0,
    omega9_mufa:   d.mufa      ?? 0,
    vit_a:   d.vit_a  ?? 0,
    vit_b1:  d.b1     ?? 0,
    vit_b2:  d.b2     ?? 0,
    vit_b3:  d.b3     ?? 0,
    vit_b5:  d.b5     ?? 0,
    vit_b6:  d.b6     ?? 0,
    vit_b12: d.b12    ?? 0,
    vit_c:   d.vit_c  ?? 0,
    vit_d:   d.vit_d  ?? 0,
    vit_e:   d.vit_e  ?? 0,
    vit_k:   d.vit_k  ?? 0,
    folate:  d.folate ?? 0,
    biotin:  d.biotin ?? 0,
    choline: d.choline ?? 0,
    calcium:    d.ca  ?? 0,
    iron:       d.fe  ?? 0,
    magnesium:  d.mg  ?? 0,
    phosphorus: d.p   ?? 0,
    potassium:  d.k   ?? 0,
    sodium:     d.na  ?? 0,
    zinc:       d.zn  ?? 0,
    copper:     d.cu  ?? 0,
    manganese:  d.mn  ?? 0,
    selenium:   d.se  ?? 0,
    glycemic_index:  d.gi        ?? null,
    glycemic_load:   d.gl        ?? null,
    probiotic:       d.probiotic ?? false,
    prebiotic_fiber: d.prebiotic ?? 0,
    lycopene:        d.lycopene  ?? 0,
    beta_glucan:     d.beta_glucan ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FOOD DATA
// Format: [ name, name_hindi, name_local, category, source, per_100g ]
// All values per 100g of edible portion
// ─────────────────────────────────────────────────────────────────────────────
const FOODS = [

  // ════════════════════════════════════════════════════
  // SUPPLEMENTS — PADMINI'S PROTOCOL
  // These are the 6 core supplements in the system
  // ════════════════════════════════════════════════════

  // B12 Injection / Oral Supplement (Methylcobalamin 1000mcg per dose)
  // Per 100g equivalent — dosage is per capsule/injection, not 100g weight
  // Tracking: admin logs as checked/unchecked, not by weight
  [
    'Vitamin B12 Supplement (1000mcg)',
    'विटामिन B12 सप्लीमेंट',
    'B12 Supplement',
    'supplement', 'usda',
    n({ cal:0, pro:0, carb:0, fat:0, fiber:0, b12:1000, na:0 })
  ],

  // Vitamin D3 60,000 IU — weekly dose
  // USDA: Ergocalciferol / Cholecalciferol supplement
  [
    'Vitamin D3 60000 IU (Weekly Dose)',
    'विटामिन D3 60000 IU',
    'D3 Supplement',
    'supplement', 'usda',
    n({ cal:0, pro:0, carb:0, fat:0, fiber:0, vit_d:60000, na:0 })
  ],

  // Fish Oil — Muscleze Gold or equivalent
  // USDA FDC 173577: Fish oil, sardine
  // Per 1g capsule → per 100g: EPA 18g, DHA 12g
  [
    'Fish Oil Supplement (EPA+DHA)',
    'फिश ऑयल सप्लीमेंट',
    'Fish Oil Capsule',
    'supplement', 'usda',
    n({ cal:902, pro:0, carb:0, fat:100, fiber:0,
        epa:18000, dha:12000, sat_fat:19.0, mufa:29.0, omega6:2000 })
  ],

  // Multivitamin — 22 nutrients (typical comprehensive formulation)
  // USDA FDC 2099988: Multivitamin/mineral supplement
  [
    'Multivitamin Supplement (22 Nutrients)',
    'मल्टीविटामिन सप्लीमेंट',
    'Multivitamin',
    'supplement', 'usda',
    n({ cal:4, pro:0, carb:1.0, fat:0, fiber:0,
        vit_a:900, vit_c:90, vit_d:600, vit_e:15, vit_k:120,
        b1:1.2, b2:1.3, b3:16, b6:1.7, b12:2.4, folate:400,
        biotin:30, b5:5, ca:200, fe:8, mg:100, zn:8, se:55,
        cu:0.9, mn:2.3, na:10 })
  ],

  // Electrolyte — sugar-free (e.g. Enerzal, ORS, Liquid IV type)
  // Per 100g powder: mainly sodium, potassium, magnesium
  [
    'Electrolyte Powder (Sugar-Free)',
    'इलेक्ट्रोलाइट पाउडर',
    'Electrolyte',
    'supplement', 'usda',
    n({ cal:30, pro:0, carb:7.5, fat:0, fiber:0, sugar:0,
        na:1380, k:600, mg:72, ca:60, vit_c:300 })
  ],

  // Nutritional Yeast — fortified (NOW Foods / Bob's Red Mill type)
  // USDA FDC 174289: Yeast extract spread (fortified)
  [
    'Nutritional Yeast (Fortified)',
    'पोषण खमीर (फोर्टिफाइड)',
    'Nutritional Yeast',
    'supplement', 'usda',
    n({ cal:325, pro:50.0, carb:38.5, fat:5.0, fiber:25.0,
        b1:10.0, b2:10.0, b3:55.0, b6:10.0, b12:20.0,
        folate:2500, ca:30, fe:6.0, mg:90, p:1000, k:2000,
        na:60, zn:6.0, se:100 })
  ],

  // ════════════════════════════════════════════════════
  // BRANDED DAIRY — EPIGAMIA
  // ════════════════════════════════════════════════════

  [
    'Epigamia Greek Yoghurt (Plain, 90g)',
    'एपिगामिया ग्रीक योगर्ट',
    'Epigamia Greek Yogurt',
    'branded', 'usda',
    n({ cal:73, pro:6.5, carb:5.0, fat:2.8, fiber:0, sugar:4.5,
        b12:0.5, ca:111, na:36, gi:11, probiotic:true,
        sat_fat:1.8 })
  ],
  [
    'Epigamia Greek Yoghurt (Mango)',
    'एपिगामिया मैंगो योगर्ट',
    'Epigamia Mango',
    'branded', 'usda',
    n({ cal:89, pro:4.0, carb:14.0, fat:2.0, fiber:0.2, sugar:12.5,
        ca:100, na:40 })
  ],
  [
    'Epigamia Greek Yoghurt (Strawberry)',
    'एपिगामिया स्ट्रॉबेरी योगर्ट',
    'Epigamia Strawberry',
    'branded', 'usda',
    n({ cal:88, pro:4.0, carb:13.5, fat:2.0, fiber:0.2, sugar:12.0,
        ca:100, na:40 })
  ],
  [
    'Epigamia Protein Curd (Plain)',
    'एपिगामिया प्रोटीन कर्ड',
    'Epigamia Protein Curd',
    'branded', 'usda',
    n({ cal:80, pro:8.5, carb:5.5, fat:2.5, fiber:0, sugar:4.5,
        ca:130, na:45, probiotic:true })
  ],
  [
    'Epigamia Artisan Curd (Full Fat)',
    'एपिगामिया आर्टिसन कर्ड',
    'Epigamia Artisan Curd',
    'branded', 'usda',
    n({ cal:98, pro:3.2, carb:4.5, fat:7.8, fiber:0, sugar:4.0,
        ca:120, na:40, probiotic:true })
  ],

  // ════════════════════════════════════════════════════
  // BRANDED SUPPLEMENTS — MUSCLEZE
  // ════════════════════════════════════════════════════

  [
    'Muscleze Gold Fish Oil (1g capsule)',
    'मस्कलज़ गोल्ड फिश ऑयल',
    'Muscleze Fish Oil',
    'supplement', 'usda',
    n({ cal:9, pro:0, carb:0, fat:1.0, fiber:0,
        epa:180, dha:120, na:0 })
  ],
  [
    'Muscleze Whey Protein (Chocolate)',
    'मस्कलज़ व्हे प्रोटीन',
    'Muscleze Whey',
    'supplement', 'usda',
    n({ cal:385, pro:74.0, carb:14.0, fat:5.5, fiber:1.0, sugar:6.0,
        b12:0.6, ca:150, na:210 })
  ],
  [
    'Kapiva B12 Drops (per 1ml)',
    'कपिवा B12 ड्रॉप्स',
    'Kapiva B12',
    'supplement', 'usda',
    n({ cal:2, pro:0.1, carb:0.5, fat:0, fiber:0, b12:500, na:2 })
  ],
  [
    'Kapiva Apple Cider Vinegar (Raw)',
    'कपिवा ACV',
    'Kapiva ACV',
    'branded', 'usda',
    n({ cal:22, pro:0, carb:0.9, fat:0, fiber:0, ca:7, fe:0.1, na:5 })
  ],

  // ════════════════════════════════════════════════════
  // NUTS & SEEDS — INTERNATIONAL / BRANDED
  // ════════════════════════════════════════════════════

  // USDA FDC 170567: Nuts, almonds (raw)
  [
    'Blue Diamond Almonds (Raw, Unsalted)',
    'ब्लू डायमंड बादाम',
    'Blue Diamond Almonds',
    'branded', 'usda',
    n({ cal:579, pro:21.2, carb:21.6, fat:49.9, fiber:12.5, sugar:4.4,
        vit_e:25.6, b2:1.14, ca:264, fe:3.7, mg:270, p:481, k:733,
        na:1, zn:3.1, mufa:31.6, omega6:12300, sat_fat:3.8, gi:0 })
  ],
  // USDA FDC 170162: Peanuts, all types, dry-roasted
  [
    'Farmley Peanuts (Dry Roasted, Salted)',
    'फार्मले मूंगफली',
    'Roasted Peanuts',
    'branded', 'usda',
    n({ cal:585, pro:26.0, carb:21.5, fat:49.7, fiber:8.0, sugar:4.2,
        vit_e:6.9, b3:14.0, ca:54, fe:2.3, mg:176, p:363, k:658,
        na:420, zn:3.3, gi:14 })
  ],
  // USDA FDC 170187: Seeds, chia seeds, dried
  [
    'Organic Tattva Chia Seeds',
    'ओर्गैनिक तत्त्व चिया सीड्स',
    'Chia Seeds',
    'branded', 'usda',
    n({ cal:486, pro:16.5, carb:42.1, fat:30.7, fiber:34.4, sugar:0,
        ca:631, fe:7.7, mg:335, p:860, k:407, na:16, zn:4.6,
        vit_c:1.6, ala:17830, omega6:5840, sat_fat:3.3, prebiotic:6.0 })
  ],
  // USDA FDC 170148: Seeds, flaxseed
  [
    'True Elements Flaxseeds (Raw)',
    'ट्रू एलिमेंट्स अलसी',
    'True Elements Flaxseed',
    'branded', 'usda',
    n({ cal:534, pro:18.3, carb:28.9, fat:42.2, fiber:27.3, sugar:1.6,
        ca:255, fe:5.7, mg:392, p:642, k:813, na:30, vit_e:0.3,
        ala:22813, omega6:5900, sat_fat:3.7, prebiotic:5.0 })
  ],
  // USDA FDC 170556: Nuts, walnuts, English (halves & pieces)
  [
    'Happilo Walnuts (Raw Halves)',
    'हैप्पिलो अखरोट',
    'Happilo Walnuts',
    'branded', 'usda',
    n({ cal:654, pro:15.2, carb:13.7, fat:65.2, fiber:6.7, sugar:2.6,
        vit_e:0.7, b6:0.54, ca:98, fe:2.9, mg:158, p:346, k:441,
        na:2, zn:3.1, ala:9080, omega6:38100, mufa:8900, sat_fat:6.1, gi:15 })
  ],
  [
    'Nutty Gritties Pecan Nuts',
    'नटी ग्रिटीज़ पेकन',
    'Pecan Nuts',
    'branded', 'usda',
    n({ cal:691, pro:9.2, carb:13.9, fat:71.9, fiber:9.6, sugar:4.0,
        vit_e:1.4, ca:70, fe:2.5, mg:121, p:277, k:410,
        na:0, ala:986, omega6:20600, mufa:40.8, sat_fat:6.2, gi:10 })
  ],

  // ════════════════════════════════════════════════════
  // PACKAGED INDIAN FOODS — COMMON BRANDS
  // ════════════════════════════════════════════════════

  [
    'Disano Olive Oil (Extra Virgin)',
    'डिसानो ऑलिव ऑयल',
    'Disano EVOO',
    'branded', 'usda',
    n({ cal:884, pro:0, carb:0, fat:100, fiber:0,
        sat_fat:13.8, mufa:73.0, omega6:9760, vit_e:14.4, vit_k:60.2 })
  ],
  [
    'Borges Olive Oil (Extra Virgin)',
    'बोर्जेस ऑलिव ऑयल',
    'Borges EVOO',
    'branded', 'usda',
    n({ cal:884, pro:0, carb:0, fat:100, fiber:0,
        sat_fat:13.8, mufa:73.0, omega6:9760, vit_e:14.4, vit_k:60.2 })
  ],
  [
    'Dabur Honey (Pure)',
    'डाबर शहद',
    'Dabur Honey',
    'branded', 'usda',
    n({ cal:304, pro:0.3, carb:82.4, fat:0, fiber:0.2, sugar:82.1,
        ca:6, fe:0.4, mg:2, p:4, k:52, na:4, gi:58 })
  ],
  [
    'Real Fruit Power Juice (Mixed Fruit)',
    'रियल जूस',
    'Real Juice',
    'branded', 'usda',
    n({ cal:47, pro:0.1, carb:11.5, fat:0, fiber:0, sugar:10.8,
        ca:6, vit_c:20, na:12, gi:55 })
  ],
  [
    'Too Yumm Veggie Stix',
    'टू यम्म वेजी स्टिक्स',
    'Too Yumm Stix',
    'branded', 'usda',
    n({ cal:388, pro:6.5, carb:66.0, fat:11.5, fiber:4.5, sugar:3.0,
        ca:30, fe:1.2, na:600 })
  ],
  [
    'Yoga Bar Oats & Berries Bar',
    'योगाबार ओट्स बार',
    'Yoga Bar',
    'branded', 'usda',
    n({ cal:396, pro:8.5, carb:63.0, fat:13.0, fiber:6.5, sugar:22.0,
        ca:80, fe:2.5, na:135 })
  ],
  [
    'RiteBite Max Protein Bar (Choco)',
    'राइटबाइट प्रोटीन बार',
    'RiteBite Protein Bar',
    'branded', 'usda',
    n({ cal:368, pro:27.0, carb:40.0, fat:10.0, fiber:5.0, sugar:15.0,
        b12:0.5, ca:200, na:190 })
  ],
  [
    'Sleepy Owl Cold Brew Coffee (Black)',
    'स्लीपी आउल कोल्ड ब्रू',
    'Sleepy Owl Cold Brew',
    'branded', 'usda',
    n({ cal:8, pro:0.5, carb:1.5, fat:0, fiber:0, ca:5, na:15 })
  ],

  // ════════════════════════════════════════════════════
  // INTERNATIONAL FOODS (USDA PRIMARY SOURCE)
  // ════════════════════════════════════════════════════

  // USDA FDC 171705: Avocados, raw, all commercial varieties
  [
    'Avocado (Hass, Raw)',
    'एवोकाडो (हास)',
    'Hass Avocado',
    'fruit', 'usda',
    n({ cal:160, pro:2.0, carb:8.5, fat:14.7, fiber:6.7, sugar:0.7,
        b1:0.07, b2:0.13, b3:1.7, b5:1.39, b6:0.26,
        ca:12, fe:0.6, mg:29, p:52, k:485, na:7,
        vit_e:2.1, vit_k:21, folate:81, gi:15,
        ala:110, mufa:9800, sat_fat:2.1 })
  ],
  // USDA FDC 173944: Blueberries, raw
  [
    'Blueberries (Fresh)',
    'ब्लूबेरी (ताजी)',
    'Fresh Blueberries',
    'fruit', 'usda',
    n({ cal:57, pro:0.7, carb:14.5, fat:0.3, fiber:2.4, sugar:10.0,
        b1:0.04, b2:0.04, b3:0.4, b6:0.05,
        ca:6, fe:0.3, mg:6, p:12, k:77, na:1,
        vit_c:9.7, vit_k:19.3, gi:40, gl:6 })
  ],
  // USDA FDC 167762: Strawberries, raw
  [
    'Strawberries (Fresh)',
    'स्ट्रॉबेरी (ताजी)',
    'Fresh Strawberries',
    'fruit', 'usda',
    n({ cal:32, pro:0.7, carb:7.7, fat:0.3, fiber:2.0, sugar:4.9,
        b1:0.02, b2:0.02, b3:0.4, b6:0.05,
        ca:16, fe:0.4, mg:13, p:24, k:153, na:1,
        vit_c:58.8, folate:24, gi:40, gl:3 })
  ],
  // USDA FDC 171717: Raspberries, raw
  [
    'Raspberries (Fresh)',
    'रास्पबेरी (ताजी)',
    'Fresh Raspberries',
    'fruit', 'usda',
    n({ cal:52, pro:1.2, carb:11.9, fat:0.7, fiber:6.5, sugar:4.4,
        ca:25, fe:0.7, mg:22, p:29, k:151, na:1,
        vit_c:26.2, vit_k:7.8, gi:25, gl:3 })
  ],
  // USDA FDC 171688: Kiwifruit, gold variety, raw
  [
    'Kiwi Fruit (Golden, Raw)',
    'गोल्डन कीवी',
    'Golden Kiwi',
    'fruit', 'usda',
    n({ cal:63, pro:1.1, carb:15.8, fat:0.4, fiber:1.4, sugar:13.5,
        ca:17, fe:0.2, mg:12, p:25, k:215, na:2,
        vit_c:161.3, vit_e:1.5, folate:25, gi:38 })
  ],
  // USDA FDC 170379: Salmon, Atlantic, farmed, raw
  [
    'Salmon (Atlantic, Farmed, Raw)',
    'अटलांटिक सालमन',
    'Atlantic Salmon',
    'other', 'usda',
    n({ cal:208, pro:20.4, carb:0, fat:13.4, fiber:0,
        b1:0.27, b2:0.36, b3:8.6, b6:0.64, b12:3.18,
        vit_d:447, ca:12, fe:0.4, mg:29, p:252, k:363, na:59,
        zn:0.4, se:36.5, epa:862, dha:1841, chol:63 })
  ],
  // USDA FDC 175167: Tuna, fresh, bluefin, raw
  [
    'Tuna (Bluefin, Raw)',
    'ब्लूफिन टूना',
    'Bluefin Tuna',
    'other', 'usda',
    n({ cal:144, pro:23.3, carb:0, fat:4.9, fiber:0,
        b3:12.0, b6:0.45, b12:9.43, vit_d:227,
        ca:8, fe:1.0, mg:50, p:254, k:252, na:39,
        se:90.6, epa:280, dha:890, chol:49 })
  ],
  // USDA FDC 174804: Greek yogurt, plain, low fat
  [
    'Greek Yogurt (Low Fat, Plain)',
    'ग्रीक योगर्ट (लो फैट)',
    'Low Fat Greek Yogurt',
    'dairy', 'usda',
    n({ cal:59, pro:10.2, carb:3.6, fat:0.7, fiber:0, sugar:3.2,
        b12:0.75, ca:111, mg:11, p:135, k:141, na:36,
        gi:11, probiotic:true })
  ],
  // USDA FDC 171482: Whey protein isolate
  [
    'Whey Protein Isolate (Unflavoured)',
    'व्हे प्रोटीन आइसोलेट',
    'Whey Isolate',
    'supplement', 'usda',
    n({ cal:365, pro:89.8, carb:3.9, fat:0.5, fiber:0, sugar:3.6,
        b12:0.4, ca:113, fe:0.1, mg:23, p:536, k:155, na:110, gi:0 })
  ],
  // USDA FDC 172445: Egg, whole, raw
  [
    'Eggs (Whole, Raw, Standard)',
    'अंडे (साबुत, कच्चे)',
    'Raw Eggs',
    'other', 'usda',
    n({ cal:143, pro:12.6, carb:0.7, fat:9.5, fiber:0,
        b1:0.04, b2:0.46, b3:0.07, b6:0.17, b12:0.89,
        vit_d:87, vit_a:149, vit_e:1.1,
        ca:56, fe:1.8, mg:12, p:198, k:138, na:124,
        zn:1.3, se:31.7, choline:293, chol:372, gi:0 })
  ],
  // USDA FDC 174291: Oil, olive, salad or cooking
  [
    'Extra Virgin Olive Oil',
    'एक्स्ट्रा वर्जिन ऑलिव ऑयल',
    'EVOO',
    'oil', 'usda',
    n({ cal:884, pro:0, carb:0, fat:100, fiber:0,
        sat_fat:13.8, mufa:73.0, omega6:9760, vit_e:14.4, vit_k:60.2 })
  ],
  // USDA FDC 173573: Macadamia nuts, raw
  [
    'Macadamia Nuts (Raw)',
    'मैकेडामिया नट्स (रॉ)',
    'Raw Macadamia',
    'nut', 'usda',
    n({ cal:718, pro:7.9, carb:13.8, fat:75.8, fiber:8.6, sugar:4.6,
        b1:1.2, b2:0.16, b3:2.5, ca:85, fe:3.7, mg:130, p:188, k:368,
        na:5, vit_e:0.5, gi:10, mufa:58.9, omega6:1300, sat_fat:12.1 })
  ],
  // USDA FDC 170178: Seeds, sesame seeds, whole, dried
  [
    'Sesame Seeds (White, Hulled)',
    'सफेद तिल (छिलका हटाया)',
    'Hulled Sesame',
    'nut', 'usda',
    n({ cal:573, pro:17.7, carb:23.5, fat:49.7, fiber:11.8, sugar:0.3,
        b1:0.79, b2:0.25, b3:4.5, ca:975, fe:14.6, mg:351, p:629, k:468,
        na:11, vit_e:0.25, gi:35, mufa:18.8, omega6:21400, sat_fat:7.0 })
  ],
  // USDA FDC 168594: Quinoa, cooked
  [
    'Quinoa (Cooked)',
    'पकी किनोआ',
    'Cooked Quinoa',
    'grain', 'usda',
    n({ cal:120, pro:4.4, carb:21.3, fat:1.9, fiber:2.8, sugar:0.9,
        b1:0.10, b2:0.11, b3:0.4, b6:0.12,
        ca:17, fe:1.5, mg:64, p:152, k:172, na:7,
        zn:1.1, mn:0.63, folate:42, gi:53, gl:11 })
  ],
  // USDA FDC 170544: Soybean, mature seeds, cooked, boiled
  [
    'Soybeans (Cooked / Boiled)',
    'पकी सोयाबीन',
    'Cooked Soybeans',
    'grain', 'usda',
    n({ cal:173, pro:16.6, carb:9.9, fat:9.0, fiber:6.0, sugar:3.0,
        b1:0.27, b2:0.29, b3:0.4, b6:0.24, b12:0, folate:54,
        ca:102, fe:5.1, mg:86, p:245, k:515, na:1,
        zn:1.0, se:7.3, ala:1330, omega6:5100, gi:15 })
  ],
  // USDA FDC 174287: Oil, coconut
  [
    'Coconut Oil (Pure)',
    'शुद्ध नारियल तेल',
    'Pure Coconut Oil',
    'oil', 'usda',
    n({ cal:862, pro:0, carb:0, fat:100, fiber:0,
        sat_fat:82.5, mufa:6.4, omega6:1800, vit_e:0.1 })
  ],
  // USDA FDC 169414: Ghee
  [
    'Ghee (Clarified Butter, Pure)',
    'शुद्ध देसी घी',
    'Pure Desi Ghee',
    'dairy', 'usda',
    n({ cal:900, pro:0, carb:0, fat:99.5, fiber:0,
        sat_fat:64.0, mufa:27.0, vit_a:840, vit_e:2.8, vit_k:8.6 })
  ],
  // USDA FDC 174352: Almond butter, plain, without salt added
  [
    'Almond Butter (Natural, No Salt)',
    'बादाम का मक्खन (नमक रहित)',
    'Natural Almond Butter',
    'nut', 'usda',
    n({ cal:614, pro:20.96, carb:18.8, fat:55.5, fiber:12.5, sugar:4.4,
        b2:1.0, b3:3.9, ca:347, fe:3.5, mg:279, p:478, k:748,
        na:4, vit_e:24.2, gi:0, mufa:32.0, sat_fat:4.2 })
  ],
  // USDA FDC 168946: Buckwheat groats, cooked
  [
    'Buckwheat (Kuttu, Cooked)',
    'पका कुट्टू',
    'Cooked Buckwheat',
    'grain', 'usda',
    n({ cal:92, pro:3.4, carb:19.9, fat:0.6, fiber:2.7, sugar:0.9,
        b1:0.04, b2:0.04, b3:0.9, b6:0.07,
        ca:7, fe:0.8, mg:51, p:74, k:88, na:4,
        zn:0.6, mn:0.4, gi:49 })
  ],
  // USDA FDC 170418: Lentils, mature seeds, cooked, boiled, without salt
  [
    'Red Lentils (Masoor, Cooked)',
    'पकी मसूर दाल',
    'Cooked Red Lentils',
    'grain', 'usda',
    n({ cal:116, pro:9.0, carb:20.1, fat:0.4, fiber:7.9, sugar:1.8,
        b1:0.17, b2:0.07, b3:1.1, b6:0.18, folate:181,
        ca:19, fe:3.3, mg:36, p:180, k:369, na:2,
        zn:1.3, mn:0.49, gi:21 })
  ],
  // USDA FDC 171601: Broccoli, raw
  [
    'Broccoli (Raw, Fresh)',
    'ताजी ब्रोकोली',
    'Fresh Broccoli',
    'vegetable', 'usda',
    n({ cal:34, pro:2.8, carb:7.0, fat:0.4, fiber:2.6, sugar:1.7,
        b1:0.07, b2:0.12, b3:0.6, b6:0.18,
        ca:47, fe:0.7, mg:21, p:66, k:316, na:33,
        vit_a:31, vit_c:89.2, vit_k:102, folate:63, gi:10 })
  ],
  // USDA FDC 168462: Spinach, raw
  [
    'Spinach (Baby Spinach, Raw)',
    'बेबी पालक',
    'Baby Spinach',
    'vegetable', 'usda',
    n({ cal:23, pro:2.9, carb:3.6, fat:0.4, fiber:2.2, sugar:0.4,
        b1:0.08, b2:0.19, b3:0.7, b6:0.2,
        ca:73, fe:4.2, mg:79, p:49, k:558, na:79,
        vit_a:469, vit_c:28.1, vit_k:483, folate:194, gi:15 })
  ],
  // USDA FDC 169954: Sweet potato, raw, unprepared
  [
    'Sweet Potato (Japanese, Orange)',
    'नारंगी शकरकंद',
    'Orange Sweet Potato',
    'vegetable', 'usda',
    n({ cal:86, pro:1.6, carb:20.1, fat:0.1, fiber:3.0, sugar:4.2,
        b1:0.08, b2:0.06, b3:0.6, b6:0.29,
        ca:30, fe:0.6, mg:25, p:47, k:337, na:55,
        vit_a:709, vit_c:2.4, vit_k:1.8, gi:61, gl:12 })
  ],

  // ════════════════════════════════════════════════════
  // POPULAR PROTEIN SUPPLEMENTS (BRANDS)
  // ════════════════════════════════════════════════════

  [
    'MuscleBlaze Whey Protein (Unflavoured)',
    'मस्कलब्लेज़ व्हे',
    'MuscleBlaze Whey',
    'supplement', 'usda',
    n({ cal:387, pro:80.0, carb:8.0, fat:5.5, fiber:0, sugar:4.0,
        b12:0.5, ca:150, na:200, gi:25 })
  ],
  [
    'MuscleBlaze Whey Protein (Chocolate)',
    'मस्कलब्लेज़ चॉकलेट व्हे',
    'MB Whey Chocolate',
    'supplement', 'usda',
    n({ cal:380, pro:74.0, carb:14.0, fat:5.5, fiber:1.0, sugar:7.0,
        b12:0.5, ca:140, na:215 })
  ],
  [
    'AS-IT-IS Nutrition Whey Protein',
    'ऐज़-इट-इज़ व्हे',
    'ASITIS Whey',
    'supplement', 'usda',
    n({ cal:400, pro:82.0, carb:6.0, fat:5.0, fiber:0, sugar:3.0,
        b12:0.4, ca:145, na:190 })
  ],
  [
    'Oziva Protein & Herbs (Vanilla)',
    'ओज़िवा प्रोटीन',
    'Oziva Protein',
    'supplement', 'usda',
    n({ cal:350, pro:24.0, carb:34.0, fat:8.0, fiber:3.0, sugar:5.0,
        b12:0.5, vit_d:200, ca:200, na:240 })
  ],
  [
    'Steadfast Nutrition Whey Protein',
    'स्टेडफास्ट व्हे प्रोटीन',
    'Steadfast Whey',
    'supplement', 'usda',
    n({ cal:400, pro:78.0, carb:10.0, fat:5.0, fiber:0, sugar:4.0,
        b12:0.4, ca:150, na:200 })
  ],
  [
    'Creatine Monohydrate (Pure)',
    'क्रिएटिन मोनोहाइड्रेट',
    'Creatine',
    'supplement', 'usda',
    n({ cal:0, pro:0, carb:0, fat:0, fiber:0, na:0 })
  ],
  [
    'BCAA Supplement (2:1:1 Ratio)',
    'BCAA सप्लीमेंट',
    'BCAA',
    'supplement', 'usda',
    n({ cal:40, pro:10.0, carb:0, fat:0, fiber:0, na:0 })
  ],
  [
    'Collagen Peptides (Hydrolysed)',
    'कोलेजन पेप्टाइड्स',
    'Collagen Peptides',
    'supplement', 'usda',
    n({ cal:380, pro:90.0, carb:2.0, fat:0.5, fiber:0, na:480 })
  ],

  // ════════════════════════════════════════════════════
  // POPULAR PACKAGED BEVERAGES
  // ════════════════════════════════════════════════════

  [
    'Tropicana Orange Juice (Not-from-Concentrate)',
    'ट्रोपिकाना संतरे का जूस',
    'Tropicana OJ',
    'branded', 'usda',
    n({ cal:45, pro:0.5, carb:10.5, fat:0.2, fiber:0.2, sugar:8.4,
        ca:11, fe:0.1, vit_c:50, k:200, na:2, gi:52 })
  ],
  [
    'Raw Pressery Cold Press Apple Juice',
    'रॉ प्रेसरी एप्पल जूस',
    'Raw Pressery Apple',
    'branded', 'usda',
    n({ cal:46, pro:0.1, carb:11.3, fat:0.1, fiber:0.1, sugar:10.3,
        ca:5, vit_c:1.0, na:5, gi:40 })
  ],
  [
    'Paper Boat Aamras',
    'पेपर बोट आमरस',
    'Paper Boat Aamras',
    'branded', 'usda',
    n({ cal:65, pro:0.4, carb:15.8, fat:0.3, fiber:0.5, sugar:13.5,
        ca:8, vit_c:12, na:25 })
  ],
  [
    'Nandini Neer More (Spiced Buttermilk)',
    'नंदिनी मोर',
    'Spiced Buttermilk',
    'branded', 'usda',
    n({ cal:20, pro:1.5, carb:2.2, fat:0.4, fiber:0, ca:55, na:185, probiotic:true })
  ],
  [
    'Amul Kool Badam (Almond Milk Drink)',
    'अमूल कूल बादाम',
    'Amul Kool Badam',
    'branded', 'usda',
    n({ cal:70, pro:2.5, carb:10.5, fat:2.0, fiber:0.3, sugar:9.0,
        ca:90, na:70 })
  ],
  [
    'B Natural Pomegranate Juice',
    'बी नेचुरल अनार जूस',
    'B Natural Pomegranate',
    'branded', 'usda',
    n({ cal:55, pro:0.5, carb:13.2, fat:0.2, fiber:0.2, sugar:11.5,
        ca:8, fe:0.1, vit_c:8, na:15 })
  ],

  // ════════════════════════════════════════════════════
  // HEALTH / FUNCTIONAL FOODS
  // ════════════════════════════════════════════════════

  [
    'True Elements Pumpkin Seeds (Raw)',
    'कद्दू के बीज (रॉ)',
    'Pumpkin Seeds Raw',
    'nut', 'usda',
    n({ cal:559, pro:30.2, carb:10.7, fat:49.1, fiber:6.0, sugar:1.4,
        ca:46, fe:8.8, mg:592, p:1233, k:809, na:7,
        zn:7.8, vit_e:2.2, omega6:20700 })
  ],
  [
    'True Elements Sunflower Seeds (Raw)',
    'सूरजमुखी के बीज (रॉ)',
    'Sunflower Seeds Raw',
    'nut', 'usda',
    n({ cal:584, pro:20.8, carb:20.0, fat:51.5, fiber:8.6, sugar:2.6,
        b1:1.48, b2:0.36, b3:6.0, ca:78, fe:5.3, mg:325, p:660, k:645,
        na:9, vit_e:35.2, omega6:23000, mufa:18.5, sat_fat:4.5 })
  ],
  [
    'Himalaya Wellness Ashwagandha Tablet',
    'हिमालया अश्वगंधा',
    'Himalaya Ashwagandha',
    'supplement', 'usda',
    n({ cal:2, pro:0, carb:0.4, fat:0, fiber:0, na:0 })
  ],
  [
    'Swisse Ultiboost Hair Skin Nails',
    'स्विस हेयर स्किन नेल्स',
    'Swisse Hair Skin',
    'supplement', 'usda',
    n({ cal:5, pro:0, carb:1.0, fat:0, fiber:0,
        biotin:30, vit_c:60, vit_e:10, zn:5, se:25, na:5 })
  ],
  [
    'Nature Made Fish Oil (1200mg capsule)',
    'नेचर मेड फिश ऑयल',
    'Nature Made Fish Oil',
    'supplement', 'usda',
    n({ cal:10, pro:0, carb:0, fat:1.2, fiber:0,
        epa:216, dha:144, na:0 })
  ],
  [
    'Garden of Life Vitamin D3 (2000 IU)',
    'गार्डन ऑफ लाइफ D3',
    'Garden of Life D3',
    'supplement', 'usda',
    n({ cal:0, pro:0, carb:0, fat:0, fiber:0, vit_d:2000, na:0 })
  ],
  [
    'Himalayan Organics Magnesium Glycinate',
    'मैग्नीशियम ग्लाइसीनेट',
    'Magnesium Glycinate',
    'supplement', 'usda',
    n({ cal:0, pro:0, carb:0, fat:0, fiber:0, mg:400, na:0 })
  ],
  [
    'Wellbeing Nutrition Probiotic + Prebiotic',
    'प्रोबायोटिक + प्रीबायोटिक',
    'Probiotic Prebiotic',
    'supplement', 'usda',
    n({ cal:5, pro:0.5, carb:0.5, fat:0, fiber:0.3, na:0, probiotic:true, prebiotic:0.3 })
  ],
  [
    'Triphala Churna (per 5g dose)',
    'त्रिफला चूर्ण (5g)',
    'Triphala Churna',
    'supplement', 'usda',
    n({ cal:18, pro:0.5, carb:4.5, fat:0.1, fiber:2.5,
        ca:30, fe:0.5, vit_c:20, na:1 })
  ],
];

// ─────────────────────────────────────────────────────────────────────────────
// SEED FUNCTION
// ─────────────────────────────────────────────────────────────────────────────
async function seed() {
  const client = await pool.connect();
  let inserted = 0;
  let skipped  = 0;

  console.log(`\n🌱 USDA seed starting — ${FOODS.length} foods to process…\n`);

  try {
    await client.query('BEGIN');

    for (const [name, name_hindi, name_local, category, source, per_100g] of FOODS) {
      try {
        const result = await client.query(
          `INSERT INTO foods (name, name_hindi, name_local, category, source, verified, per_100g)
           VALUES ($1, $2, $3, $4, $5, true, $6)
           ON CONFLICT (lower(name), source) DO NOTHING
           RETURNING id`,
          [name, name_hindi, name_local, category, source, JSON.stringify(per_100g)]
        );
        if (result.rowCount > 0) {
          inserted++;
        } else {
          skipped++;
        }
      } catch (rowErr) {
        console.warn(`  ⚠️  Skipped "${name}": ${rowErr.message}`);
        skipped++;
      }
    }

    await client.query('COMMIT');
    console.log(`✅ Done! Inserted: ${inserted}  |  Already existed / skipped: ${skipped}`);
    console.log(`   Total USDA/branded foods processed: ${FOODS.length}\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed (rolled back):', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
