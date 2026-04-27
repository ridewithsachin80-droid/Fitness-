/**
 * seed-nin-india.js
 * Seeds the foods table with 500+ Indian foods from the NIN India (ICMR)
 * "Nutritive Value of Indian Foods" dataset.
 *
 * Run: node server/scripts/seed-nin-india.js
 * Safe to re-run — uses INSERT ... ON CONFLICT DO NOTHING.
 *
 * Nutrient values per 100g unless otherwise noted.
 * Sources: ICMR-NIN Nutritive Value of Indian Foods (2017 edition),
 *          Indian Food Composition Tables (IFCT 2017).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const pool = require('../db/pool');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — build a full per_100g JSONB object from compact input
// All fields default to 0 / false / null so every nutrient is always present
// ─────────────────────────────────────────────────────────────────────────────
function n(d = {}) {
  const fiber = d.fiber ?? 0;
  const totalCarb = d.carb ?? 0;
  return {
    // Macros
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
    // Fat types
    omega3_ala:    d.ala       ?? 0,
    omega3_epa:    d.epa       ?? 0,
    omega3_dha:    d.dha       ?? 0,
    omega6:        d.omega6    ?? 0,
    omega9_mufa:   d.mufa      ?? 0,
    // Vitamins
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
    // Minerals
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
    // Bioactives
    glycemic_index:  d.gi        ?? null,
    glycemic_load:   d.gl        ?? null,
    probiotic:       d.probiotic ?? false,
    prebiotic_fiber: d.prebiotic ?? 0,
    lycopene:        d.lycopene  ?? 0,
    beta_glucan:     d.beta_glucan ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FOOD DATA  — source: NIN India / ICMR IFCT 2017
// Format: [ name, name_hindi, name_local, category, nutrientData ]
// ─────────────────────────────────────────────────────────────────────────────
const FOODS = [

  // ════════════════════════════════════════════════════
  // CEREALS & MILLETS
  // ════════════════════════════════════════════════════
  ['Rice, Raw (Parboiled)',          'चावल (उबला)',    'Boiled Rice',         'grain', n({ cal:346, pro:6.4,  carb:78.2, fat:0.4, fiber:0.2, b1:0.21, b2:0.05, b3:3.8,  ca:9,  fe:1.0, mg:47,  p:141, k:150, na:9,   gi:72, gl:56 })],
  ['Rice, Raw (White)',              'चावल (सफेद)',    'White Rice',          'grain', n({ cal:346, pro:6.8,  carb:78.2, fat:0.5, fiber:0.2, b1:0.06, b2:0.05, b3:1.9,  ca:10, fe:0.7, mg:28,  p:115, k:115, na:5,   gi:73, gl:57 })],
  ['Rice, Raw (Red)',                'लाल चावल',       'Red Rice',            'grain', n({ cal:350, pro:7.0,  carb:76.5, fat:1.0, fiber:2.0, b1:0.3,  b2:0.06, b3:4.5,  ca:12, fe:1.5, mg:65,  p:180, k:165, na:4,   gi:55, gl:42 })],
  ['Rice, Raw (Brown)',              'भूरे चावल',      'Brown Rice',          'grain', n({ cal:362, pro:7.5,  carb:76.0, fat:2.2, fiber:3.5, b1:0.4,  b2:0.09, b3:5.1,  ca:23, fe:2.2, mg:143, p:264, k:268, na:7,   gi:50, gl:38 })],
  ['Rice, Cooked (White)',           'पका चावल',       'Cooked Rice',         'grain', n({ cal:130, pro:2.7,  carb:28.2, fat:0.3, fiber:0.4, b1:0.02, b2:0.01, b3:0.4,  ca:10, fe:0.2, mg:12,  p:43,  k:35,  na:1,   gi:73, gl:21 })],
  ['Rice Flakes (Poha)',             'पोहा',           'Poha',                'grain', n({ cal:369, pro:6.3,  carb:77.7, fat:1.2, fiber:1.4, b1:0.07, b2:0.04, b3:1.6,  ca:14, fe:20,  mg:55,  p:150, k:135, na:8,   gi:76, gl:59 })],
  ['Wheat, Whole',                   'गेहूँ',          'Gehun',               'grain', n({ cal:346, pro:11.8, carb:71.2, fat:1.5, fiber:1.9, b1:0.45, b2:0.17, b3:5.5,  ca:41, fe:5.3, mg:138, p:306, k:370, na:17,  gi:54, gl:39 })],
  ['Wheat, Refined (Maida)',         'मैदा',           'Maida',               'grain', n({ cal:348, pro:10.3, carb:73.9, fat:0.9, fiber:0.2, b1:0.12, b2:0.04, b3:1.2,  ca:23, fe:2.7, mg:20,  p:108, k:107, na:2,   gi:71, gl:52 })],
  ['Semolina (Sooji/Rava)',          'सूजी / रवा',     'Rava',                'grain', n({ cal:349, pro:10.4, carb:73.4, fat:0.9, fiber:0.5, b1:0.22, b2:0.06, b3:2.9,  ca:17, fe:2.9, mg:47,  p:136, k:186, na:1,   gi:66, gl:48 })],
  ['Ragi (Finger Millet)',           'रागी',           'Nachni',              'grain', n({ cal:328, pro:7.3,  carb:72.0, fat:1.3, fiber:3.6, b1:0.42, b2:0.19, b3:1.1,  ca:344, fe:3.9, mg:137, p:283, k:408, na:11,  gi:70, gl:51 })],
  ['Jowar (Sorghum)',                'ज्वार',          'Jola',                'grain', n({ cal:329, pro:10.4, carb:72.6, fat:1.9, fiber:1.6, b1:0.37, b2:0.13, b3:4.3,  ca:25, fe:4.1, mg:165, p:287, k:350, na:7,   gi:62, gl:45 })],
  ['Bajra (Pearl Millet)',           'बाजरा',          'Kambam',              'grain', n({ cal:361, pro:11.6, carb:67.5, fat:5.0, fiber:1.2, b1:0.33, b2:0.25, b3:2.3,  ca:42, fe:8.0, mg:137, p:296, k:307, na:10.9,gi:55, gl:37 })],
  ['Maize (Corn, Dry)',              'मक्का',          'Makki',               'grain', n({ cal:342, pro:8.8,  carb:66.2, fat:3.6, fiber:2.7, b1:0.42, b2:0.1,  b3:1.8,  ca:10, fe:2.3, mg:127, p:348, k:287, na:15,  gi:52, gl:34 })],
  ['Sweet Corn (Fresh)',             'मीठी मकई',       'Sweet Corn',          'grain', n({ cal:86,  pro:3.3,  carb:19.0, fat:1.3, fiber:2.7, b1:0.2,  b2:0.06, b3:1.7,  ca:2,  fe:0.5, mg:37,  p:89,  k:270, na:15,  gi:52, gl:10 })],
  ['Barley (Whole)',                 'जौ',             'Jav',                 'grain', n({ cal:336, pro:11.5, carb:69.6, fat:1.3, fiber:3.9, b1:0.47, b2:0.18, b3:5.1,  ca:26, fe:6.1, mg:133, p:264, k:280, na:34,  gi:25, gl:17, beta_glucan:5.0 })],
  ['Oats (Rolled)',                  'जई',             'Oats',                'grain', n({ cal:374, pro:13.2, carb:65.6, fat:7.6, fiber:11.5, b1:0.76, b2:0.14, b3:1.1, ca:52, fe:4.7, mg:177, p:523, k:429, na:6,   gi:55, gl:36, beta_glucan:4.0 })],
  ['Quinoa (Cooked)',                'किनोआ',          'Quinoa',              'grain', n({ cal:120, pro:4.4,  carb:21.3, fat:1.9, fiber:2.8, b1:0.1,  b2:0.11, b3:0.4,  ca:17, fe:1.5, mg:64,  p:152, k:172, na:7,   gi:53, gl:11 })],
  ['Buckwheat (Kuttu)',              'कुट्टू का आटा',  'Kuttu Atta',          'grain', n({ cal:343, pro:13.3, carb:71.5, fat:3.4, fiber:10.0, b1:0.1,  b2:0.43, b3:7.0, ca:18, fe:2.2, mg:231, p:347, k:460, na:1,   gi:54, gl:39 })],
  ['Vermicelli (Semiya)',            'सेंवई',          'Semiya',              'grain', n({ cal:358, pro:9.0,  carb:76.0, fat:1.0, fiber:0.5, b1:0.1,  b2:0.04, b3:1.0,  ca:10, fe:1.5, mg:20,  p:100, k:90,  na:5,   gi:65, gl:49 })],
  ['Bread (Whole Wheat)',            'होल व्हीट ब्रेड','Brown Bread',         'grain', n({ cal:252, pro:9.7,  carb:48.5, fat:3.6, fiber:6.0, b1:0.31, b2:0.14, b3:3.7,  ca:107, fe:3.6, mg:76,  p:213, k:248, na:472, gi:69, gl:34 })],
  ['Bread (White)',                  'सफेद ब्रेड',     'White Bread',         'grain', n({ cal:265, pro:8.0,  carb:51.0, fat:3.2, fiber:2.4, b1:0.2,  b2:0.1,  b3:2.9,  ca:151, fe:2.4, mg:23,  p:100, k:115, na:490, gi:75, gl:38 })],
  ['Chapati / Roti (Plain)',         'चपाती / रोटी',   'Roti',                'grain', n({ cal:297, pro:7.9,  carb:60.7, fat:3.7, fiber:1.9, b1:0.35, b2:0.1,  b3:3.8,  ca:32, fe:4.1, mg:75,  p:195, k:220, na:212, gi:62, gl:38 })],
  ['Chapati (Multigrain)',           'मल्टीग्रेन रोटी','Multigrain Roti',     'grain', n({ cal:278, pro:9.5,  carb:55.0, fat:4.0, fiber:5.0, b1:0.4,  b2:0.12, b3:4.0,  ca:55, fe:4.5, mg:95,  p:220, k:260, na:200, gi:52, gl:29 })],
  ['Idli (Steamed)',                 'इडली',           'Idli',                'grain', n({ cal:134, pro:3.9,  carb:28.0, fat:0.5, fiber:0.5, b1:0.06, b2:0.09, b3:0.7,  ca:25, fe:1.4, mg:28,  p:64,  k:95,  na:233, gi:70, gl:20, probiotic:true })],
  ['Dosa (Plain)',                   'दोसा',           'Dosa',                'grain', n({ cal:168, pro:3.8,  carb:24.0, fat:6.5, fiber:0.9, b1:0.1,  b2:0.06, b3:0.8,  ca:13, fe:1.1, mg:25,  p:80,  k:80,  na:260, gi:68, gl:16, probiotic:true })],
  ['Upma',                           'उपमा',           'Upma',                'grain', n({ cal:141, pro:3.2,  carb:22.0, fat:4.5, fiber:1.0, b1:0.1,  b2:0.06, b3:1.2,  ca:10, fe:1.0, mg:25,  p:70,  k:80,  na:250 })],
  ['Poha (Cooked)',                  'पका पोहा',       'Cooked Poha',         'grain', n({ cal:140, pro:2.5,  carb:30.0, fat:1.5, fiber:0.8, b1:0.05, b2:0.02, b3:0.8,  ca:8,  fe:8.0, mg:22,  p:60,  k:70,  na:190 })],
  ['Paratha (Plain)',                'पराठा',          'Paratha',             'grain', n({ cal:327, pro:8.0,  carb:51.0, fat:10.5, fiber:2.0, b1:0.25, b2:0.1, b3:2.8,  ca:45, fe:3.5, mg:70,  p:170, k:200, na:350, gi:62, gl:32 })],
  ['Poori (Fried)',                  'पूरी',           'Puri',                'grain', n({ cal:391, pro:8.0,  carb:42.0, fat:21.0, fiber:1.5, b1:0.2,  b2:0.05, b3:2.0, ca:20, fe:2.8, mg:45,  p:130, k:120, na:250 })],
  ['Uttapam',                        'उत्तपम',         'Uttapam',             'grain', n({ cal:150, pro:4.5,  carb:25.0, fat:4.0, fiber:1.5, b1:0.1,  b2:0.08, b3:0.9,  ca:35, fe:1.5, mg:30,  p:90,  k:120, na:280, probiotic:true })],
  ['Dhokla',                         'ढोकला',          'Dhokla',              'grain', n({ cal:162, pro:7.2,  carb:28.5, fat:3.2, fiber:1.5, b1:0.1,  b2:0.07, b3:0.9,  ca:55, fe:1.8, mg:38,  p:110, k:160, na:390, probiotic:true })],
  ['Sattu (Roasted Gram Flour)',     'सत्तू',          'Sattu',               'grain', n({ cal:406, pro:22.4, carb:65.2, fat:6.0, fiber:5.5, b1:0.5,  b2:0.19, b3:4.2,  ca:56, fe:8.6, mg:150, p:320, k:485, na:24,  gi:28 })],
  ['Besan (Chickpea Flour)',         'बेसन',           'Kadala Maavu',        'grain', n({ cal:387, pro:22.5, carb:57.8, fat:6.7, fiber:4.9, b1:0.48, b2:0.2,  b3:1.8,  ca:57, fe:7.7, mg:140, p:350, k:850, na:59,  gi:35, gl:20 })],
  ['Rice Flour',                     'चावल का आटा',   'Arisi Maavu',         'grain', n({ cal:366, pro:5.9,  carb:80.1, fat:1.4, fiber:2.4, b1:0.14, b2:0.04, b3:2.6,  ca:10, fe:0.4, mg:35,  p:98,  k:76,  na:0 })],

  // ════════════════════════════════════════════════════
  // PULSES & LEGUMES
  // ════════════════════════════════════════════════════
  ['Moong Dal (Split Yellow, Raw)',  'मूंग दाल',       'Payatham Paruppu',    'grain', n({ cal:334, pro:24.0, carb:56.7, fat:1.3, fiber:4.1, b1:0.47, b2:0.21, b3:2.4,  ca:73,  fe:8.5,  mg:189, p:405, k:983, na:28,  gi:25, gl:14, folate:159 })],
  ['Moong Dal (Whole Green)',        'साबुत मूंग',     'Whole Moong',         'grain', n({ cal:347, pro:24.0, carb:59.9, fat:1.2, fiber:7.6, b1:0.62, b2:0.23, b3:2.1,  ca:65,  fe:6.7,  mg:189, p:367, k:1246,na:15,  gi:25, gl:15 })],
  ['Moong Dal (Cooked)',             'पकी मूंग दाल',   'Cooked Moong Dal',    'grain', n({ cal:105, pro:7.0,  carb:19.0, fat:0.4, fiber:2.0, b1:0.06, b2:0.06, b3:0.9,  ca:27,  fe:1.4,  mg:48,  p:100, k:270, na:10 })],
  ['Masoor Dal (Red Lentil, Raw)',   'मसूर दाल',       'Mysore Paruppu',      'grain', n({ cal:343, pro:25.1, carb:59.0, fat:0.7, fiber:4.9, b1:0.48, b2:0.21, b3:2.3,  ca:68,  fe:7.6,  mg:122, p:454, k:955, na:30,  gi:21, gl:12, folate:204 })],
  ['Masoor Dal (Cooked)',            'पकी मसूर दाल',   'Cooked Masoor',       'grain', n({ cal:116, pro:9.0,  carb:20.1, fat:0.4, fiber:1.5, b1:0.08, b2:0.06, b3:1.2,  ca:22,  fe:2.0,  mg:35,  p:120, k:250, na:8 })],
  ['Chana Dal (Split Chickpea)',     'चना दाल',        'Kadalai Paruppu',     'grain', n({ cal:372, pro:20.8, carb:59.8, fat:5.6, fiber:1.7, b1:0.48, b2:0.15, b3:2.9,  ca:56,  fe:5.3,  mg:139, p:331, k:859, na:72,  gi:11, gl:6 })],
  ['Urad Dal (Split Black Lentil)',  'उड़द दाल',       'Ulundu Paruppu',      'grain', n({ cal:347, pro:24.0, carb:59.6, fat:1.4, fiber:0.9, b1:0.42, b2:0.2,  b3:2.0,  ca:154, fe:9.1,  mg:267, p:385, k:983, na:38,  gi:38, gl:23 })],
  ['Toor / Arhar Dal (Raw)',         'अरहर / तुअर दाल','Thuvaram Paruppu',    'grain', n({ cal:335, pro:22.3, carb:57.6, fat:1.7, fiber:1.5, b1:0.45, b2:0.19, b3:2.9,  ca:73,  fe:5.7,  mg:189, p:304, k:1392,na:38,  gi:22, gl:13 })],
  ['Toor Dal (Cooked)',              'पकी अरहर दाल',   'Cooked Toor Dal',     'grain', n({ cal:116, pro:6.8,  carb:20.0, fat:0.4, fiber:0.8, b1:0.06, b2:0.04, b3:0.9,  ca:20,  fe:1.6,  mg:48,  p:78,  k:290, na:5 })],
  ['Rajma (Kidney Beans, Raw)',      'राजमा',          'Rajma',               'grain', n({ cal:346, pro:22.9, carb:60.6, fat:1.5, fiber:4.3, b1:0.53, b2:0.22, b3:2.1,  ca:260, fe:8.2,  mg:163, p:407, k:1795,na:24,  gi:29, gl:17, folate:394 })],
  ['Rajma (Cooked)',                 'पका राजमा',      'Cooked Rajma',        'grain', n({ cal:127, pro:8.7,  carb:22.8, fat:0.5, fiber:3.5, b1:0.17, b2:0.06, b3:0.6,  ca:50,  fe:2.2,  mg:45,  p:135, k:403, na:2 })],
  ['Lobia (Black-Eyed Peas)',        'लोबिया',         'Karamani',            'grain', n({ cal:323, pro:24.1, carb:54.5, fat:1.5, fiber:5.0, b1:0.40, b2:0.22, b3:1.5,  ca:77,  fe:8.5,  mg:184, p:424, k:1112,na:58,  gi:33, gl:18 })],
  ['Kabuli Chana (White Chickpea)',  'काबुली चना',     'Kabuli Channa',       'grain', n({ cal:360, pro:17.4, carb:60.6, fat:6.0, fiber:9.9, b1:0.48, b2:0.21, b3:1.5,  ca:105, fe:4.3,  mg:115, p:366, k:875, na:24,  gi:28, gl:17 })],
  ['Chana (Bengal Gram, Whole)',     'काले चना',       'Kondakadalai',        'grain', n({ cal:360, pro:17.1, carb:60.9, fat:5.3, fiber:3.9, b1:0.48, b2:0.21, b3:1.5,  ca:202, fe:4.6,  mg:141, p:331, k:832, na:75 })],
  ['Soybean (Dry)',                  'सोयाबीन',        'Soybean',             'grain', n({ cal:432, pro:43.2, carb:20.9, fat:19.9, fiber:3.7, b1:0.87, b2:0.46, b3:2.5,  ca:240, fe:11.5, mg:280, p:704, k:1797,na:2,   gi:15, gl:3, omega3_ala:1330, omega6:9920 })],
  ['Green Peas (Fresh)',             'हरे मटर',        'Matar',               'grain', n({ cal:81,  pro:5.4,  carb:14.4, fat:0.4, fiber:5.1, b1:0.26, b2:0.13, b3:2.1,  ca:26,  fe:1.5,  mg:33,  p:108, k:244, na:5,   gi:48, gl:7, vit_c:40, folate:65 })],
  ['Horse Gram (Kulthi)',            'कुलथी',          'Kollu',               'grain', n({ cal:321, pro:22.0, carb:57.2, fat:0.5, fiber:5.3, b1:0.4,  b2:0.2,  b3:1.5,  ca:287, fe:7.0,  mg:150, p:311, k:986, na:33 })],
  ['Moth Bean (Matki)',              'मटकी',           'Moth Dal',            'grain', n({ cal:330, pro:23.6, carb:56.5, fat:1.7, fiber:4.5, b1:0.3,  b2:0.16, b3:2.1,  ca:202, fe:10.9, mg:206, p:350, k:900, na:20 })],
  ['Chickpea (Sprouted)',            'अंकुरित चना',    'Sprouted Chickpea',   'grain', n({ cal:134, pro:8.0,  carb:22.0, fat:3.0, fiber:4.5, b1:0.1,  b2:0.09, b3:0.9,  ca:68,  fe:3.1,  mg:67,  p:173, k:394, na:10, vit_c:6.5 })],
  ['Moong (Sprouted)',               'अंकुरित मूंग',   'Sprouted Moong',      'grain', n({ cal:30,  pro:3.0,  carb:5.2,  fat:0.2, fiber:1.8, b1:0.09, b2:0.12, b3:0.7,  ca:13,  fe:0.9,  mg:21,  p:50,  k:149, na:6,   vit_c:13.2 })],

  // ════════════════════════════════════════════════════
  // VEGETABLES (GREEN / LEAFY)
  // ════════════════════════════════════════════════════
  ['Spinach (Palak, Raw)',           'पालक',           'Palakura',            'vegetable', n({ cal:23,  pro:2.9,  carb:3.6,  fat:0.4, fiber:2.2, b1:0.08, b2:0.19, b3:0.6,  ca:73,  fe:4.2, mg:87,  p:52,  k:558, na:79,  vit_a:469, vit_c:28.1, vit_k:483, folate:194, gi:15 })],
  ['Fenugreek Leaves (Methi)',       'मेथी के पत्ते',  'Vendhaya Keerai',     'vegetable', n({ cal:49,  pro:4.4,  carb:6.0,  fat:0.9, fiber:1.1, b1:0.04, b2:0.1,  b3:0.8,  ca:395, fe:16.5, mg:62,  p:51,  k:458, na:76,  vit_a:504, vit_c:52, folate:57, gi:10 })],
  ['Mustard Greens (Sarson)',        'सरसों के पत्ते', 'Kadugu Keerai',       'vegetable', n({ cal:43,  pro:4.2,  carb:5.6,  fat:0.5, fiber:3.2, b1:0.06, b2:0.11, b3:0.8,  ca:155, fe:2.7, mg:32,  p:66,  k:384, na:20,  vit_a:378, vit_c:70, vit_k:257, folate:187 })],
  ['Amaranth Leaves (Chaulai)',      'चौलाई',          'Thandukeerai',        'vegetable', n({ cal:45,  pro:4.0,  carb:6.1,  fat:0.5, fiber:2.4, b1:0.05, b2:0.16, b3:1.0,  ca:395, fe:16.6, mg:55,  p:70,  k:611, na:20,  vit_a:292, vit_c:99 })],
  ['Drumstick Leaves (Moringa)',     'सहजन की पत्तियाँ','Murungai Keerai',    'vegetable', n({ cal:92,  pro:6.7,  carb:12.5, fat:1.7, fiber:2.0, b1:0.25, b2:0.66, b3:2.2,  ca:185, fe:4.0, mg:42,  p:112, k:337, na:9,   vit_a:378, vit_c:220, folate:18 })],
  ['Broccoli (Raw)',                 'ब्रोकोली',       'Broccoli',            'vegetable', n({ cal:34,  pro:2.8,  carb:7.0,  fat:0.4, fiber:2.6, b1:0.07, b2:0.12, b3:0.6,  ca:47,  fe:0.7, mg:21,  p:66,  k:316, na:33,  vit_a:31,  vit_c:89.2, vit_k:102, folate:63, gi:10 })],
  ['Cabbage (Raw)',                  'बंद गोभी',       'Muttaikose',          'vegetable', n({ cal:25,  pro:1.3,  carb:5.8,  fat:0.1, fiber:2.5, b1:0.06, b2:0.04, b3:0.2,  ca:40,  fe:0.6, mg:12,  p:26,  k:170, na:18,  vit_c:36.6, vit_k:76, folate:43, gi:10 })],
  ['Cauliflower (Raw)',              'फूल गोभी',       'Cauliflower',         'vegetable', n({ cal:25,  pro:1.9,  carb:5.0,  fat:0.3, fiber:2.0, b1:0.05, b2:0.06, b3:0.5,  ca:22,  fe:0.4, mg:15,  p:44,  k:299, na:30,  vit_c:48.2, vit_k:15.5, folate:57, gi:10 })],
  ['Carrot (Raw)',                   'गाजर',           'Carrot',              'vegetable', n({ cal:41,  pro:0.9,  carb:9.6,  fat:0.2, fiber:2.8, b1:0.07, b2:0.06, b3:0.7,  ca:33,  fe:0.3, mg:12,  p:35,  k:320, na:69,  vit_a:835, vit_c:5.9, gi:47, gl:4 })],
  ['Tomato (Raw)',                   'टमाटर',          'Tomato',              'vegetable', n({ cal:18,  pro:0.9,  carb:3.9,  fat:0.2, fiber:1.2, b1:0.04, b2:0.02, b3:0.6,  ca:10,  fe:0.3, mg:11,  p:24,  k:237, na:5,   vit_a:42,  vit_c:13.7, vit_k:7.9, lycopene:2573, gi:15 })],
  ['Cucumber (Raw)',                 'खीरा',           'Cucumber',            'vegetable', n({ cal:15,  pro:0.6,  carb:3.6,  fat:0.1, fiber:0.5, b1:0.03, b2:0.03, b3:0.1,  ca:16,  fe:0.3, mg:13,  p:24,  k:147, na:2,   vit_c:2.8, gi:15 })],
  ['Bitter Gourd (Karela)',          'करेला',          'Pavakkai',            'vegetable', n({ cal:17,  pro:1.0,  carb:3.7,  fat:0.2, fiber:2.8, b1:0.04, b2:0.04, b3:0.4,  ca:20,  fe:0.6, mg:17,  p:36,  k:296, na:5,   vit_c:84,  vit_a:6,   gi:14 })],
  ['Bottle Gourd (Lauki/Doodhi)',    'लौकी / दूधी',    'Sorakkai',            'vegetable', n({ cal:14,  pro:0.6,  carb:3.4,  fat:0.0, fiber:0.5, b1:0.03, b2:0.02, b3:0.3,  ca:26,  fe:0.2, mg:11,  p:13,  k:150, na:2,   vit_c:10,  gi:15 })],
  ['Bhindi (Lady Finger / Okra)',    'भिंडी',          'Vendaikkai',          'vegetable', n({ cal:33,  pro:1.9,  carb:7.5,  fat:0.2, fiber:3.2, b1:0.2,  b2:0.06, b3:1.0,  ca:82,  fe:0.8, mg:57,  p:63,  k:299, na:8,   vit_a:36,  vit_c:23.0, vit_k:53, folate:60, gi:20 })],
  ['Eggplant / Brinjal (Baingan)',   'बैंगन',          'Kathirikai',          'vegetable', n({ cal:25,  pro:1.0,  carb:5.9,  fat:0.2, fiber:3.0, b1:0.04, b2:0.04, b3:0.6,  ca:9,   fe:0.2, mg:14,  p:24,  k:229, na:2,   vit_c:2.2,  gi:15 })],
  ['Capsicum (Green Bell Pepper)',   'शिमला मिर्च',    'Capsicum',            'vegetable', n({ cal:20,  pro:0.9,  carb:4.6,  fat:0.2, fiber:1.7, b1:0.09, b2:0.03, b3:0.5,  ca:10,  fe:0.4, mg:10,  p:20,  k:175, na:4,   vit_c:80.4, vit_a:18,  vit_k:7.4, gi:15 })],
  ['Capsicum (Red Bell Pepper)',     'लाल शिमला मिर्च','Red Capsicum',        'vegetable', n({ cal:31,  pro:1.0,  carb:7.3,  fat:0.3, fiber:2.1, b1:0.05, b2:0.09, b3:1.0,  ca:7,   fe:0.4, mg:12,  p:26,  k:211, na:4,   vit_c:127.7, vit_a:157, lycopene:490, gi:15 })],
  ['Onion (Raw)',                    'प्याज',          'Vengayam',            'vegetable', n({ cal:40,  pro:1.1,  carb:9.3,  fat:0.1, fiber:1.7, b1:0.05, b2:0.02, b3:0.1,  ca:23,  fe:0.2, mg:10,  p:29,  k:146, na:4,   vit_c:7.4,  vit_b6:0.12, gi:10, prebiotic:3.0 })],
  ['Garlic (Raw)',                   'लहसुन',          'Poondu',              'vegetable', n({ cal:149, pro:6.4,  carb:33.1, fat:0.5, fiber:2.1, b1:0.2,  b2:0.11, b3:0.7,  ca:181, fe:1.7, mg:25,  p:153, k:401, na:17,  vit_c:31.2, vit_b6:1.24, gi:30 })],
  ['Ginger (Raw)',                   'अदरक',           'Inji',                'vegetable', n({ cal:80,  pro:1.8,  carb:17.8, fat:0.7, fiber:2.0, b1:0.03, b2:0.03, b3:0.7,  ca:16,  fe:0.6, mg:43,  p:34,  k:415, na:13,  vit_c:5.0, gi:15 })],
  ['Potato (Raw)',                   'आलू',            'Urulaikizhangu',      'vegetable', n({ cal:77,  pro:2.0,  carb:17.5, fat:0.1, fiber:2.2, b1:0.08, b2:0.03, b3:1.1,  ca:12,  fe:0.8, mg:23,  p:57,  k:425, na:6,   vit_c:19.7, vit_b6:0.3, gi:78, gl:14 })],
  ['Sweet Potato (Raw)',             'शकरकंद',         'Sakkaravalli',        'vegetable', n({ cal:86,  pro:1.6,  carb:20.1, fat:0.1, fiber:3.0, b1:0.08, b2:0.06, b3:0.6,  ca:30,  fe:0.6, mg:25,  p:47,  k:337, na:55,  vit_a:709, vit_c:2.4, vit_b6:0.29, gi:61, gl:12 })],
  ['Yam (Suran)',                    'जिमीकंद / सूरन', 'Senai Kilangu',       'vegetable', n({ cal:97,  pro:1.5,  carb:23.4, fat:0.2, fiber:4.1, b1:0.11, b2:0.03, b3:0.6,  ca:17,  fe:0.5, mg:21,  p:55,  k:816, na:9,   vit_c:17.1, gi:51, gl:12 })],
  ['Pumpkin (Kaddu, Raw)',           'कद्दू',          'Poosanikai',          'vegetable', n({ cal:26,  pro:1.0,  carb:6.5,  fat:0.1, fiber:0.5, b1:0.05, b2:0.11, b3:0.6,  ca:21,  fe:0.8, mg:12,  p:44,  k:340, na:1,   vit_a:426, vit_c:9.0, gi:75, gl:5 })],
  ['Ash Gourd (Petha)',              'पेठा',           'Neer Poosanikai',     'vegetable', n({ cal:13,  pro:0.4,  carb:3.0,  fat:0.1, fiber:1.0, b1:0.04, b2:0.01, b3:0.3,  ca:26,  fe:0.3, mg:10,  p:11,  k:129, na:3 })],
  ['Ridge Gourd (Turai)',            'तोरई',           'Peerkangai',          'vegetable', n({ cal:20,  pro:0.5,  carb:4.3,  fat:0.2, fiber:0.5, b1:0.04, b2:0.03, b3:0.3,  ca:18,  fe:0.3, mg:14,  p:28,  k:137, na:3,   vit_c:12 })],
  ['Cluster Beans (Gavar)',          'ग्वार फली',      'Kothavarangai',       'vegetable', n({ cal:16,  pro:3.2,  carb:10.8, fat:0.4, fiber:4.7, b1:0.09, b2:0.06, b3:0.5,  ca:130, fe:1.0, mg:43,  p:57,  k:153, na:5 })],
  ['Drumstick (Sehjan Phali)',       'सहजन की फली',    'Murungakkai',         'vegetable', n({ cal:26,  pro:2.5,  carb:3.7,  fat:0.1, fiber:2.0, b1:0.05, b2:0.07, b3:0.2,  ca:30,  fe:0.7, mg:45,  p:50,  k:461, na:42,  vit_c:141 })],
  ['Turnip (Shalgam)',               'शलगम',           'Turnip',              'vegetable', n({ cal:28,  pro:0.9,  carb:6.4,  fat:0.1, fiber:1.8, b1:0.04, b2:0.03, b3:0.4,  ca:30,  fe:0.3, mg:11,  p:27,  k:191, na:82,  vit_c:21.0, gi:62, gl:4 })],
  ['Radish (Mooli)',                 'मूली',           'Mullangi',            'vegetable', n({ cal:16,  pro:0.7,  carb:3.4,  fat:0.1, fiber:1.6, b1:0.01, b2:0.04, b3:0.3,  ca:25,  fe:0.3, mg:10,  p:20,  k:233, na:39,  vit_c:14.8 })],
  ['Beetroot (Raw)',                 'चुकंदर',         'Beetroot',            'vegetable', n({ cal:43,  pro:1.6,  carb:9.6,  fat:0.2, fiber:2.8, b1:0.03, b2:0.04, b3:0.3,  ca:16,  fe:0.8, mg:23,  p:40,  k:325, na:78,  vit_c:4.9,  folate:109, gi:61, gl:6 })],
  ['Lotus Root (Kamal Kakdi)',       'कमल ककड़ी',      'Thamarai Thandu',     'vegetable', n({ cal:74,  pro:2.6,  carb:17.2, fat:0.1, fiber:4.9, b1:0.16, b2:0.22, b3:0.4,  ca:45,  fe:1.2, mg:23,  p:100, k:556, na:45,  vit_c:44, gi:35 })],
  ['Baby Corn',                      'बेबी कॉर्न',     'Baby Corn',           'vegetable', n({ cal:26,  pro:1.8,  carb:5.4,  fat:0.2, fiber:1.5, ca:4,   fe:0.2, mg:10,  p:30,  k:100, na:4,   vit_c:5 })],
  ['Mushroom (Button)',              'मशरूम',          'Kalan',               'vegetable', n({ cal:22,  pro:3.1,  carb:3.3,  fat:0.3, fiber:1.0, b1:0.08, b2:0.32, b3:3.6,  ca:3,   fe:0.5, mg:9,   p:86,  k:318, na:5,   vit_d:1.0, vit_b12:0.04, gi:10 })],
  ['Jackfruit (Raw/Unripe)',         'कच्चा कटहल',     'Kathal',              'vegetable', n({ cal:95,  pro:1.7,  carb:23.3, fat:0.6, fiber:1.5, b1:0.03, b2:0.1,  b3:0.4,  ca:24,  fe:0.6, mg:29,  p:21,  k:303, na:2,   vit_c:13.7, gi:50 })],
  ['Colocasia (Arbi/Taro)',          'अरबी',           'Sepankilangu',        'vegetable', n({ cal:112, pro:1.5,  carb:26.5, fat:0.2, fiber:4.3, b1:0.1,  b2:0.03, b3:0.6,  ca:43,  fe:0.7, mg:33,  p:84,  k:591, na:11,  vit_c:4.5, gi:56 })],

  // ════════════════════════════════════════════════════
  // FRUITS
  // ════════════════════════════════════════════════════
  ['Banana (Ripe)',                  'केला',           'Vazhai Pazham',       'fruit', n({ cal:89,  pro:1.1,  carb:22.8, fat:0.3, fiber:2.6, sugar:12.2, b1:0.03, b2:0.07, b3:0.7, b6:0.37, ca:5,   fe:0.3, mg:27,  p:22,  k:358, na:1,   vit_c:8.7,  vit_b6:0.37, gi:51, gl:12 })],
  ['Apple (Raw)',                    'सेब',            'Apple',               'fruit', n({ cal:52,  pro:0.3,  carb:13.8, fat:0.2, fiber:2.4, sugar:10.4, b1:0.02, b2:0.03, b3:0.1, ca:6,   fe:0.1, mg:5,   p:11,  k:107, na:1,   vit_c:4.6,  gi:36, gl:5 })],
  ['Mango (Ripe)',                   'आम',             'Mambalam Pazham',     'fruit', n({ cal:60,  pro:0.8,  carb:15.0, fat:0.4, fiber:1.6, sugar:13.7, b1:0.03, b2:0.04, b3:0.7, ca:11,  fe:0.2, mg:10,  p:14,  k:168, na:2,   vit_a:54,  vit_c:36.4, gi:51, gl:8 })],
  ['Papaya (Ripe)',                  'पपीता',          'Papali Pazham',       'fruit', n({ cal:43,  pro:0.5,  carb:10.8, fat:0.3, fiber:1.7, sugar:7.8,  b1:0.02, b2:0.03, b3:0.4, ca:20,  fe:0.1, mg:21,  p:10,  k:182, na:8,   vit_a:47,  vit_c:61.8, lycopene:1800, gi:60, gl:6 })],
  ['Guava (Raw)',                    'अमरूद',          'Koyya Pazham',        'fruit', n({ cal:68,  pro:2.6,  carb:14.3, fat:1.0, fiber:5.4, sugar:8.9,  b1:0.07, b2:0.04, b3:1.1, ca:18,  fe:0.3, mg:22,  p:40,  k:417, na:2,   vit_c:228.3, vit_a:31, gi:27, gl:4 })],
  ['Orange (Raw)',                   'संतरा',          'Kamala Pazham',       'fruit', n({ cal:47,  pro:0.9,  carb:11.8, fat:0.1, fiber:2.4, sugar:9.4,  b1:0.09, b2:0.04, b3:0.4, ca:40,  fe:0.1, mg:10,  p:14,  k:181, na:0,   vit_c:53.2, folate:30, gi:40, gl:5 })],
  ['Lemon / Lime (Nimbu)',           'नींबू',          'Elumichai',           'fruit', n({ cal:29,  pro:1.1,  carb:9.3,  fat:0.3, fiber:2.8, sugar:2.5,  b1:0.04, b2:0.02, b3:0.1, ca:26,  fe:0.6, mg:8,   p:16,  k:138, na:2,   vit_c:53.0, gi:20 })],
  ['Pomegranate (Anar)',             'अनार',           'Mathalam Pazham',     'fruit', n({ cal:83,  pro:1.7,  carb:18.7, fat:1.2, fiber:4.0, sugar:13.7, b1:0.07, b2:0.05, b3:0.3, ca:10,  fe:0.3, mg:12,  p:36,  k:236, na:3,   vit_c:10.2, vit_k:16.4, gi:35, gl:7 })],
  ['Watermelon',                     'तरबूज',          'Tharboosakkai',       'fruit', n({ cal:30,  pro:0.6,  carb:7.6,  fat:0.2, fiber:0.4, sugar:6.2,  b1:0.03, b2:0.02, b3:0.2, ca:7,   fe:0.2, mg:10,  p:11,  k:112, na:1,   vit_a:28,  vit_c:8.1,  lycopene:4532, gi:72, gl:5 })],
  ['Grapes (Green)',                 'हरे अंगूर',      'Green Grapes',        'fruit', n({ cal:69,  pro:0.7,  carb:18.1, fat:0.2, fiber:0.9, sugar:15.5, ca:10,  fe:0.4, mg:7,   p:20,  k:191, na:2,   vit_c:3.2,  gi:46, gl:8 })],
  ['Pineapple (Raw)',                'अनानास',         'Anasi Pazham',        'fruit', n({ cal:50,  pro:0.5,  carb:13.1, fat:0.1, fiber:1.4, sugar:9.9,  b1:0.08, b2:0.03, b3:0.5, ca:13,  fe:0.3, mg:12,  p:8,   k:109, na:1,   vit_c:47.8, gi:59, gl:7 })],
  ['Strawberry',                     'स्ट्रॉबेरी',     'Strawberry',          'fruit', n({ cal:32,  pro:0.7,  carb:7.7,  fat:0.3, fiber:2.0, sugar:4.9,  b1:0.02, b2:0.02, b3:0.4, ca:16,  fe:0.4, mg:13,  p:24,  k:153, na:1,   vit_c:58.8, folate:24, gi:40, gl:3 })],
  ['Avocado (Raw)',                  'एवोकाडो',        'Avocado',             'fruit', n({ cal:160, pro:2.0,  carb:8.5,  fat:14.7, fiber:6.7, sugar:0.7, b1:0.07, b2:0.13, b3:1.7,  b5:1.39, b6:0.26, ca:12,  fe:0.6, mg:29,  p:52,  k:485, na:7,   vit_e:2.1, vit_k:21, folate:81, gi:15, ala:110, mufa:9800 })],
  ['Coconut (Fresh)',                'ताजा नारियल',    'Thengai',             'fruit', n({ cal:354, pro:3.3,  carb:15.2, fat:33.5, fiber:9.0, sugar:6.2,  ca:14,  fe:2.4, mg:32,  p:113, k:356, na:20,  sat_fat:29.7 })],
  ['Dates (Khajur)',                 'खजूर',           'Pericham Pazham',     'fruit', n({ cal:282, pro:2.5,  carb:75.0, fat:0.4, fiber:8.0, sugar:63.4, b1:0.05, b2:0.07, b3:1.6,  ca:64,  fe:1.0, mg:54,  p:62,  k:696, na:2,   gi:42, gl:32 })],
  ['Jackfruit (Ripe)',               'पका कटहल',       'Ripe Jackfruit',      'fruit', n({ cal:95,  pro:1.7,  carb:23.3, fat:0.6, fiber:1.5, sugar:19.1, ca:24,  fe:0.6, mg:29,  p:21,  k:303, na:2,   vit_c:13.7, gi:50 })],
  ['Litchi (Raw)',                   'लीची',           'Litchi Pazham',       'fruit', n({ cal:66,  pro:0.8,  carb:16.5, fat:0.4, fiber:1.3, sugar:15.2, ca:5,   fe:0.3, mg:10,  p:31,  k:171, na:1,   vit_c:71.5, gi:50 })],
  ['Sapota (Chikoo)',                'चीकू',           'Sapota Pazham',       'fruit', n({ cal:83,  pro:0.4,  carb:19.9, fat:1.1, fiber:5.3, sugar:14.7, ca:21,  fe:0.8, mg:12,  p:12,  k:193, na:12,  vit_c:14.7 })],
  ['Custard Apple (Sitaphal)',       'सीताफल',         'Seetha Pazham',       'fruit', n({ cal:94,  pro:2.1,  carb:23.6, fat:0.6, fiber:4.4, sugar:15.0, ca:30,  fe:0.4, mg:18,  p:21,  k:247, na:4,   vit_c:19.2 })],
  ['Amla (Indian Gooseberry)',       'आंवला',          'Nellikai',            'fruit', n({ cal:44,  pro:0.9,  carb:10.2, fat:0.6, fiber:4.3, sugar:5.7,  ca:50,  fe:1.2, mg:10,  p:27,  k:198, na:1,   vit_c:600, gi:15 })],

  // ════════════════════════════════════════════════════
  // DAIRY & EGGS
  // ════════════════════════════════════════════════════
  ['Cow Milk (Full Fat)',            'गाय का दूध',     'Pasumpaal',           'dairy', n({ cal:61,  pro:3.2,  carb:4.8,  fat:3.3, fiber:0, b1:0.04, b2:0.18, b3:0.1,  b12:0.45, ca:113, fe:0.1, mg:11,  p:84,  k:150, na:43,  sat_fat:2.1, gi:32, probiotic:false })],
  ['Buffalo Milk',                   'भैंस का दूध',    'Erumai Paal',         'dairy', n({ cal:97,  pro:3.7,  carb:5.2,  fat:7.0, fiber:0, b1:0.04, b2:0.11, b3:0.15, b12:0.36, ca:195, fe:0.2, mg:13,  p:114, k:178, na:52,  sat_fat:4.5 })],
  ['Skimmed Milk',                   'स्किम्ड दूध',    'Skim Milk',           'dairy', n({ cal:34,  pro:3.4,  carb:4.9,  fat:0.1, fiber:0, b1:0.04, b2:0.17, b3:0.1,  b12:0.45, ca:124, fe:0.1, mg:11,  p:95,  k:156, na:50,  gi:32 })],
  ['Toned Milk (2.5% fat)',          'टोंड दूध',       'Toned Milk',          'dairy', n({ cal:50,  pro:3.2,  carb:4.8,  fat:2.5, fiber:0, b1:0.04, b2:0.18, b3:0.1,  b12:0.45, ca:125, fe:0.1, mg:11,  p:90,  k:150, na:50 })],
  ['Paneer (Full Fat)',              'पनीर',           'Paneer',              'dairy', n({ cal:265, pro:18.3, carb:3.7,  fat:20.8, fiber:0, b1:0.01, b2:0.1,  b3:0.1,  b12:0.7,  ca:480, fe:0.2, mg:15,  p:300, k:95,  na:28,  sat_fat:13.2, gi:32 })],
  ['Paneer (Low Fat)',               'लो फैट पनीर',    'Low Fat Paneer',      'dairy', n({ cal:204, pro:18.0, carb:4.0,  fat:13.0, fiber:0, b1:0.01, b2:0.1,  b3:0.1,  b12:0.7,  ca:500, fe:0.2, mg:15,  p:310, k:100, na:30,  sat_fat:8.2, gi:32 })],
  ['Curd / Dahi (Full Fat)',         'दही',            'Thayir',              'dairy', n({ cal:98,  pro:3.1,  carb:3.4,  fat:8.0, fiber:0, b2:0.14, b12:0.37, ca:121, fe:0.1, mg:11,  p:95,  k:141, na:36,  gi:35, probiotic:true })],
  ['Curd (Low Fat / Skimmed)',       'कम वसा दही',     'Low Fat Dahi',        'dairy', n({ cal:56,  pro:3.5,  carb:5.8,  fat:1.5, fiber:0, b2:0.16, b12:0.46, ca:136, fe:0.1, mg:12,  p:105, k:155, na:46,  gi:35, probiotic:true })],
  ['Greek Yogurt (Strained Curd)',   'ग्रीक योगर्ट',   'Strained Yogurt',     'dairy', n({ cal:73,  pro:6.5,  carb:5.0,  fat:2.8, fiber:0, b2:0.23, b12:0.75, ca:111, fe:0.1, mg:11,  p:135, k:141, na:36,  gi:11, probiotic:true })],
  ['Ghee (Clarified Butter)',        'घी',             'Nei',                 'dairy', n({ cal:900, pro:0,    carb:0,    fat:99.5, fiber:0, b12:0.01, sat_fat:64.0, mufa:27.0, vit_a:840, vit_e:2.8 })],
  ['Butter (Salted)',                'मक्खन',          'Vennai',              'dairy', n({ cal:717, pro:0.9,  carb:0.1,  fat:81.1, fiber:0, b12:0.1,  ca:24,  fe:0.0, na:714, sat_fat:51.0, vit_a:684 })],
  ['Butter (Unsalted)',              'अनसाल्टेड मक्खन','Unsalted Butter',     'dairy', n({ cal:717, pro:0.9,  carb:0.1,  fat:81.1, fiber:0, b12:0.1,  ca:24,  fe:0.0, na:11,  sat_fat:51.0, vit_a:684 })],
  ['Cream (Heavy / Fresh)',          'क्रीम',          'Cream',               'dairy', n({ cal:340, pro:2.1,  carb:2.8,  fat:36.0, fiber:0, ca:65,  fe:0.1, na:38,  sat_fat:22.0 })],
  ['Cheese (Cheddar)',               'पनीर (चेडर)',    'Cheddar Cheese',      'dairy', n({ cal:402, pro:25.0, carb:1.3,  fat:33.1, fiber:0, b1:0.03, b2:0.36, b3:0.1,  b12:0.83, ca:721, fe:0.7, mg:28,  p:512, k:98,  na:621, sat_fat:21.1, gi:10 })],
  ['Khoa / Mawa',                    'खोया / मावा',    'Mawa',                'dairy', n({ cal:421, pro:14.6, carb:32.0, fat:29.0, fiber:0, ca:680, fe:0.3, mg:30,  p:380, k:210, na:200, b12:0.5, sat_fat:18.5 })],
  ['Eggs (Whole, Raw)',              'अंडे',           'Muttai',              'other', n({ cal:155, pro:12.6, carb:1.1,  fat:10.6, fiber:0, b1:0.07, b2:0.47, b3:0.1,  b6:0.17, b12:1.11, vit_d:87,  vit_a:149, vit_e:1.1, ca:56,  fe:1.8, mg:12,  p:198, k:138, na:124, zn:1.3, se:31.7, choline:294, chol:373, gi:0 })],
  ['Egg White (Raw)',                'अंडे का सफेद हिस्सा','Egg White',       'other', n({ cal:52,  pro:10.9, carb:0.7,  fat:0.2, fiber:0, b2:0.43, b12:0.1,  ca:7,   fe:0.1, mg:12,  p:15,  k:163, na:166, choline:1.3 })],
  ['Egg Yolk (Raw)',                 'अंडे की जर्दी',  'Egg Yolk',            'other', n({ cal:322, pro:15.9, carb:3.6,  fat:26.5, fiber:0, b1:0.18, b2:0.53, b3:0.2,  b12:3.11, vit_d:218, vit_a:381, vit_e:2.6, ca:129, fe:2.7, mg:5,   p:390, k:109, na:48,  zn:2.3, se:56, choline:820, chol:1085 })],

  // ════════════════════════════════════════════════════
  // FISH & MEAT (NIN India values)
  // ════════════════════════════════════════════════════
  ['Chicken Breast (Raw, Skinless)', 'चिकन ब्रेस्ट',  'Chicken Breast',      'other', n({ cal:165, pro:31.0, carb:0,    fat:3.6, fiber:0, b1:0.07, b2:0.11, b3:13.7, b6:0.9,  b12:0.3, vit_d:4,   ca:15,  fe:0.7, mg:29,  p:220, k:256, na:74,  zn:1.0, se:27.6, chol:85, gi:0 })],
  ['Chicken (Whole, With Skin)',     'साबुत चिकन',     'Chicken',             'other', n({ cal:239, pro:27.3, carb:0,    fat:13.6, fiber:0, b1:0.06, b2:0.1,  b3:9.6,  b6:0.63, b12:0.3, ca:15,  fe:1.3, mg:20,  p:174, k:240, na:82,  zn:1.8, se:21, chol:88 })],
  ['Fish — Rohu (Raw)',              'रोहू मछली',      'Rohu',                'other', n({ cal:97,  pro:16.7, carb:0,    fat:2.8, fiber:0, b1:0.08, b2:0.1,  b3:4.5,  b12:1.5, vit_d:40,  ca:680, fe:1.0, mg:28,  p:190, k:250, na:72,  zn:0.9, se:25, omega3_epa:200, omega3_dha:600, chol:55 })],
  ['Fish — Catla (Raw)',             'काटला मछली',     'Catla',               'other', n({ cal:105, pro:18.5, carb:0,    fat:3.2, fiber:0, b12:1.6, vit_d:50,  ca:520, fe:1.2, mg:30,  p:210, k:260, na:65,  omega3_epa:250, omega3_dha:700, chol:60 })],
  ['Fish — Pomfret (Raw)',           'पोम्फ्रेट',      'Vavval Meen',         'other', n({ cal:103, pro:18.5, carb:0,    fat:2.8, fiber:0, b12:2.1, vit_d:45,  ca:204, fe:0.8, mg:25,  p:210, k:400, na:75,  omega3_epa:350, omega3_dha:900, chol:55 })],
  ['Fish — Salmon (Raw)',            'सालमन मछली',     'Salmon',              'other', n({ cal:208, pro:20.4, carb:0,    fat:13.4, fiber:0, b1:0.27, b2:0.36, b3:8.6,  b6:0.64, b12:3.18, vit_d:447, ca:12,  fe:0.4, mg:29,  p:252, k:363, na:59,  zn:0.4, se:36.5, omega3_ala:0, omega3_epa:862, omega3_dha:1841, chol:63 })],
  ['Fish — Mackerel (Raw)',          'मैकरल मछली',     'Kanagarai',           'other', n({ cal:191, pro:19.0, carb:0,    fat:12.4, fiber:0, b12:9.0, vit_d:360,  ca:66,  fe:1.6, mg:60,  p:217, k:314, na:90,  omega3_epa:500, omega3_dha:1400, chol:70 })],
  ['Fish — Tuna (Raw)',              'टूना मछली',      'Choora Meen',         'other', n({ cal:130, pro:29.9, carb:0,    fat:0.5, fiber:0, b1:0.28, b2:0.25, b3:15.1, b12:9.43, vit_d:227, ca:31,  fe:1.0, mg:64,  p:323, k:444, na:45,  se:90.6, omega3_epa:280, omega3_dha:890, chol:49 })],
  ['Mutton/Goat Meat (Raw, Lean)',   'मटन',            'Aadu Erachi',         'other', n({ cal:109, pro:18.5, carb:0,    fat:3.6, fiber:0, b1:0.09, b2:0.25, b3:5.5,  b12:2.6, ca:13,  fe:2.7, mg:20,  p:190, k:310, na:72,  zn:3.8, se:9.6, chol:72 })],
  ['Liver — Chicken',                'चिकन लीवर',      'Chicken Liver',       'other', n({ cal:167, pro:24.3, carb:0.9,  fat:6.5, fiber:0, b1:0.31, b2:2.31, b3:9.2,  b6:0.75, b12:16.6, vit_a:3296, vit_c:27.9, folate:578, ca:11,  fe:9.8, mg:20,  p:297, k:230, na:71,  zn:4.3, se:54.6, chol:408 })],
  ['Prawn / Shrimp (Raw)',           'झींगा',          'Eral',                'other', n({ cal:99,  pro:20.1, carb:0.9,  fat:1.7, fiber:0, b1:0.03, b2:0.04, b3:3.3,  b12:1.4, vit_d:14,  ca:52,  fe:0.5, mg:35,  p:185, k:259, na:119, zn:1.1, se:38, chol:152 })],

  // ════════════════════════════════════════════════════
  // NUTS & SEEDS
  // ════════════════════════════════════════════════════
  ['Almonds (Raw)',                  'बादाम',          'Badam',               'nut', n({ cal:579, pro:21.2, carb:21.6, fat:49.9, fiber:12.5, b1:0.21, b2:1.14, b3:3.6,  ca:264, fe:3.7, mg:270, p:481, k:733, na:1,   vit_e:25.6, vit_b6:0.14, gi:0, mufa:31.6, omega6:12300, sat_fat:3.8 })],
  ['Cashew Nuts (Raw)',              'काजू',           'Mundiri',             'nut', n({ cal:553, pro:18.2, carb:30.2, fat:43.9, fiber:3.3, b1:0.42, b2:0.06, b3:1.1,  ca:37,  fe:6.7, mg:292, p:593, k:660, na:12,  vit_k:34.1, gi:25, mufa:23.8, omega6:7700 })],
  ['Walnuts (Raw)',                  'अखरोट',          'Akrot',               'nut', n({ cal:654, pro:15.2, carb:13.7, fat:65.2, fiber:6.7, b1:0.34, b2:0.15, b3:1.1,  ca:98,  fe:2.9, mg:158, p:346, k:441, na:2,   vit_e:0.7, vit_b6:0.54, gi:15, ala:9080, omega6:38100, mufa:8900, sat_fat:6.1 })],
  ['Peanuts / Groundnuts (Raw)',     'मूंगफली',        'Kadala',              'nut', n({ cal:567, pro:25.8, carb:16.1, fat:49.2, fiber:8.5, b1:0.64, b2:0.13, b3:12.1, ca:92,  fe:4.6, mg:168, p:376, k:705, na:18,  vit_e:8.3, vit_b6:0.35, folate:240, gi:14, mufa:24.5, omega6:15600, sat_fat:6.3 })],
  ['Peanuts (Roasted)',              'भुनी मूंगफली',   'Roasted Peanuts',     'nut', n({ cal:585, pro:26.0, carb:21.5, fat:49.7, fiber:8.0, b1:0.44, b2:0.1,  b3:14.0, ca:54,  fe:2.3, mg:176, p:363, k:658, na:18,  gi:14 })],
  ['Flaxseed (Alsi)',                'अलसी',           'Ali Virai',           'nut', n({ cal:534, pro:18.3, carb:28.9, fat:42.2, fiber:27.3, b1:1.64, b2:0.16, b3:3.1,  ca:255, fe:5.7, mg:392, p:642, k:813, na:30,  vit_e:0.3, gi:35, ala:22813, omega6:5900, sat_fat:3.7, prebiotic:5.0 })],
  ['Chia Seeds',                     'चिया के बीज',    'Chia',                'nut', n({ cal:486, pro:16.5, carb:42.1, fat:30.7, fiber:34.4, b1:0.62, b2:0.17, b3:8.8,  ca:631, fe:7.7, mg:335, p:860, k:407, na:16,  vit_c:1.6, gi:1, ala:17830, omega6:5840, sat_fat:3.3, prebiotic:6.0 })],
  ['Sesame Seeds (Til)',             'तिल',            'Ellu',                'nut', n({ cal:573, pro:17.7, carb:23.5, fat:49.7, fiber:11.8, b1:0.79, b2:0.25, b3:4.5,  ca:975, fe:14.6, mg:351, p:629, k:468, na:11,  vit_e:0.25, gi:35, mufa:18.8, omega6:21400, sat_fat:7.0 })],
  ['Sunflower Seeds',                'सूरजमुखी के बीज','Sunflower Seeds',     'nut', n({ cal:584, pro:20.8, carb:20.0, fat:51.5, fiber:8.6, b1:1.48, b2:0.36, b3:6.0,  ca:78,  fe:5.3, mg:325, p:660, k:645, na:9,   vit_e:35.2, gi:35, omega6:23000, mufa:18.5, sat_fat:4.5 })],
  ['Pumpkin Seeds (Magaz)',          'कद्दू के बीज',   'Magaz',               'nut', n({ cal:559, pro:30.2, carb:10.7, fat:49.1, fiber:6.0, b1:0.27, b2:0.15, b3:4.4,  ca:46,  fe:8.8, mg:592, p:1233,k:809, na:7,   zn:7.8, vit_e:2.2, gi:25, omega6:20700 })],
  ['Macadamia Nuts',                 'मैकेडामिया नट', 'Macadamia',           'nut', n({ cal:718, pro:7.9,  carb:13.8, fat:75.8, fiber:8.6, b1:1.2,  b2:0.16, b3:2.5,  ca:85,  fe:3.7, mg:130, p:188, k:368, na:5,   vit_e:0.5, gi:10, mufa:58.9, omega6:1300, sat_fat:12.1 })],
  ['Pecan Nuts',                     'पेकन नट',        'Pecan',               'nut', n({ cal:691, pro:9.2,  carb:13.9, fat:71.9, fiber:9.6, b1:0.66, b2:0.13, b3:1.2,  ca:70,  fe:2.5, mg:121, p:277, k:410, na:0,   vit_e:1.4, gi:10, mufa:40.8, ala:986, omega6:20600, sat_fat:6.2 })],
  ['Pistachios (Raw)',               'पिस्ता',         'Pista',               'nut', n({ cal:562, pro:20.2, carb:27.5, fat:45.4, fiber:10.3, b1:0.87, b2:0.16, b3:1.3,  ca:105, fe:3.9, mg:121, p:490, k:1025,na:1,   vit_e:2.3, vit_b6:1.7, folate:51, gi:15, mufa:23.3, omega6:13200 })],
  ['Hazelnut (Filbert)',             'हेज़लनट',        'Hazelnut',            'nut', n({ cal:628, pro:14.9, carb:16.7, fat:60.8, fiber:9.7, b1:0.64, b2:0.11, b3:1.8,  ca:114, fe:4.7, mg:163, p:290, k:680, na:0,   vit_e:15.3, gi:15, mufa:45.7, ala:87, omega6:7900 })],
  ['Coconut (Dried / Desiccated)',   'सूखा नारियल',    'Kopra',               'nut', n({ cal:592, pro:6.9,  carb:24.2, fat:56.4, fiber:15.6, ca:26,  fe:3.3, mg:90,  p:206, k:543, na:37,  sat_fat:50.0 })],
  ['Fox Nuts (Makhana)',             'मखाना',          'Makhana',             'nut', n({ cal:347, pro:9.7,  carb:76.9, fat:0.1, fiber:14.5, b1:0.2,  ca:60,  fe:1.4, mg:67,  p:200, k:500, na:1,   gi:38, prebiotic:2.0 })],

  // ════════════════════════════════════════════════════
  // OILS & FATS
  // ════════════════════════════════════════════════════
  ['Groundnut Oil (Peanut Oil)',     'मूंगफली का तेल', 'Kadala Ennai',        'oil', n({ cal:884, pro:0, carb:0, fat:100, fiber:0, sat_fat:16.9, mufa:45.0, omega6:31400, vit_e:15.7 })],
  ['Mustard Oil',                    'सरसों का तेल',   'Kadugu Ennai',        'oil', n({ cal:884, pro:0, carb:0, fat:100, fiber:0, sat_fat:11.6, mufa:60.0, ala:5900, omega6:14500, vit_e:5.1 })],
  ['Coconut Oil',                    'नारियल तेल',     'Thengai Ennai',       'oil', n({ cal:862, pro:0, carb:0, fat:100, fiber:0, sat_fat:82.5, mufa:6.4, omega6:1800, vit_e:0.1 })],
  ['Sunflower Oil',                  'सूरजमुखी तेल',   'Sunflower Oil',       'oil', n({ cal:884, pro:0, carb:0, fat:100, fiber:0, sat_fat:10.6, mufa:19.5, omega6:65700, vit_e:41.1 })],
  ['Sesame Oil (Til Tel)',           'तिल का तेल',     'Ellu Ennai',          'oil', n({ cal:884, pro:0, carb:0, fat:100, fiber:0, sat_fat:14.2, mufa:39.7, omega6:41300, vit_e:1.4 })],
  ['Rice Bran Oil',                  'चावल की भूसी का तेल','Rice Bran Oil',   'oil', n({ cal:884, pro:0, carb:0, fat:100, fiber:0, sat_fat:19.7, mufa:39.3, omega6:33400, vit_e:32.3, ala:1610 })],
  ['Olive Oil (Extra Virgin)',       'जैतून का तेल',   'Jaitoon Tel',         'oil', n({ cal:884, pro:0, carb:0, fat:100, fiber:0, sat_fat:13.8, mufa:73.0, omega6:9760, vit_e:14.4, vit_k:60.2 })],
  ['Flaxseed Oil (Alsi Tel)',        'अलसी का तेल',    'Alsi Tel',            'oil', n({ cal:884, pro:0, carb:0, fat:100, fiber:0, sat_fat:9.0, mufa:20.0, ala:53300, omega6:12700, vit_e:0.5 })],
  ['Butter (Cooking)',               'मक्खन (खाना पकाने)','Cooking Butter',   'oil', n({ cal:717, pro:0.9, carb:0.1, fat:81.1, fiber:0, sat_fat:51.4, mufa:21.0, na:643, vit_a:684, vit_e:2.3 })],
  ['Vanaspati (Hydrogenated Fat)',   'वनस्पति',        'Vanaspati',           'oil', n({ cal:900, pro:0, carb:0, fat:100, fiber:0, sat_fat:33.0, trans_fat:20.0 })],

  // ════════════════════════════════════════════════════
  // SPICES & CONDIMENTS
  // ════════════════════════════════════════════════════
  ['Turmeric Powder (Haldi)',        'हल्दी',          'Manjal',              'other', n({ cal:354, pro:7.8,  carb:64.9, fat:9.9, fiber:21.1, b1:0.16, b2:0.22, b3:5.1,  ca:168, fe:41.4, mg:193, p:268, k:2525,na:38,  vit_c:25.9, gi:15 })],
  ['Cumin (Jeera)',                  'जीरा',           'Seeragam',            'other', n({ cal:375, pro:17.8, carb:44.2, fat:22.3, fiber:10.5, b1:0.63, b2:0.37, b3:4.6,  ca:931, fe:66.4, mg:366, p:499, k:1788,na:168 })],
  ['Coriander Seeds (Dhania)',       'धनिया',          'Kotthamalli',         'other', n({ cal:298, pro:12.4, carb:54.9, fat:17.8, fiber:41.9, b1:0.24, b2:0.29, b3:2.1,  ca:709, fe:16.3, mg:330, p:409, k:1267,na:35 })],
  ['Black Pepper (Kali Mirch)',      'काली मिर्च',     'Milagu',              'other', n({ cal:251, pro:10.4, carb:64.0, fat:3.3, fiber:25.3, b1:0.11, b2:0.18, b3:1.1,  ca:443, fe:9.7, mg:171, p:158, k:1329,na:20,  vit_c:0, vit_k:163.7 })],
  ['Red Chili Powder (Lal Mirch)',   'लाल मिर्च पाउडर','Milagai Podi',       'other', n({ cal:314, pro:12.0, carb:49.7, fat:14.3, fiber:27.2, b1:0.33, b2:0.92, b3:8.7,  ca:148, fe:17.3, mg:152, p:293, k:2009,na:30,  vit_a:952, vit_c:76.4 })],
  ['Cardamom (Elaichi)',             'इलायची',         'Elakkai',             'other', n({ cal:311, pro:10.8, carb:68.5, fat:6.7, fiber:28.0, ca:383, fe:13.97, mg:229, p:178, k:1119,na:18,  vit_c:21.0 })],
  ['Fenugreek Seeds (Methi Dana)',   'मेथी के बीज',    'Vendhayam',           'other', n({ cal:323, pro:23.0, carb:58.4, fat:6.4, fiber:24.6, b1:0.32, b2:0.37, b3:1.6,  ca:176, fe:33.5, mg:191, p:296, k:770, na:67 })],
  ['Cinnamon (Dalchini)',            'दालचीनी',        'Pattai',              'other', n({ cal:247, pro:4.0,  carb:80.6, fat:1.2, fiber:53.1, b1:0.02, b2:0.04, b3:1.3,  ca:1002,fe:8.3, mg:60,  p:64,  k:431, na:10,  vit_c:3.8, vit_k:31.2 })],
  ['Asafoetida (Hing)',              'हींग',           'Perungayam',          'other', n({ cal:297, pro:4.0,  carb:67.8, fat:1.0, fiber:4.1, ca:690, fe:39.4, mg:0,   p:0,   k:0,   na:0 })],
  ['Mustard Seeds (Rai)',            'राई',            'Kadugu',              'other', n({ cal:508, pro:26.1, carb:28.1, fat:36.2, fiber:12.2, b1:0.81, b2:0.26, b3:4.7,  ca:266, fe:9.9, mg:370, p:828, k:738, na:13 })],
  ['Dry Ginger Powder (Saunth)',     'सौंठ',           'Chukku',              'other', n({ cal:347, pro:8.9,  carb:70.4, fat:6.0, fiber:14.1, b1:0.05, b2:0.17, b3:9.6,  ca:116, fe:19.8, mg:184, p:168, k:1320,na:32 })],
  ['Cloves (Laung)',                 'लौंग',           'Kirambu',             'other', n({ cal:274, pro:6.0,  carb:65.5, fat:13.0, fiber:33.9, b1:0.16, b2:0.22, b3:1.5,  ca:632, fe:11.8, mg:259, p:104, k:1020,na:277, vit_c:11.7, vit_k:141.8 })],
  ['Bay Leaves (Tej Patta)',         'तेज पत्ता',      'Brinji Ilai',         'other', n({ cal:313, pro:7.6,  carb:74.6, fat:8.4, fiber:26.3, ca:834, fe:43.0, mg:120, p:113, k:529, na:23,  vit_c:46.5, vit_a:309 })],
  ['Apple Cider Vinegar (ACV)',      'सेब का सिरका',   'ACV',                 'other', n({ cal:22,  pro:0,    carb:0.9,  fat:0, fiber:0, ca:7,   fe:0.1, mg:1,   p:8,   k:73,  na:5,   gi:0 })],
  ['Coconut Sugar',                  'नारियल चीनी',    'Coconut Sugar',       'other', n({ cal:375, pro:0,    carb:100,  fat:0, fiber:0, sugar:75.0, ca:39, fe:0.7, mg:29,  p:79,  k:1030,na:5,   gi:35, gl:35 })],
  ['Jaggery (Gur)',                  'गुड़',           'Vellam',              'other', n({ cal:383, pro:0.4,  carb:98.0, fat:0.1, fiber:0, sugar:94.0, ca:80,  fe:2.5, mg:79,  p:40,  k:1056,na:30,  gi:84, gl:82 })],
  ['Honey',                          'शहद',            'Then',                'other', n({ cal:304, pro:0.3,  carb:82.4, fat:0, fiber:0.2, sugar:82.1, ca:6,   fe:0.4, mg:2,   p:4,   k:52,  na:4,   gi:58, gl:48 })],
  ['Sugar (White)',                  'चीनी',           'Sakkarai',            'other', n({ cal:387, pro:0,    carb:100,  fat:0, fiber:0, sugar:100, gi:68, gl:68 })],

  // ════════════════════════════════════════════════════
  // NUTRITIONAL YEAST & FERMENTED
  // ════════════════════════════════════════════════════
  ['Nutritional Yeast',              'पोषण खमीर',      'Nutritional Yeast',   'supplement', n({ cal:325, pro:50.0, carb:38.5, fat:5.0, fiber:25.0, b1:10.0, b2:10.0, b3:55.0, b6:10.0, b12:20.0, folate:2500, ca:30, fe:6.0, mg:90, p:1000, k:2000, na:60, zn:6.0, se:100 })],
  ['Tempeh',                         'टेम्पेह',        'Tempeh',              'other', n({ cal:193, pro:18.5, carb:9.4,  fat:10.8, fiber:0, b1:0.08, b2:0.36, b3:2.6, b12:0.1, ca:111, fe:2.7, mg:81, p:266, k:412, na:9, probiotic:true })],
  ['Kimchi',                         'किम्ची',         'Kimchi',              'other', n({ cal:15,  pro:1.1,  carb:2.4,  fat:0.5, fiber:1.6, b1:0.03, b2:0.06, b3:0.5, b12:0.0, vit_c:18, ca:33, fe:0.5, mg:12, p:26, k:198, na:747, probiotic:true })],
  ['Kanji (Fermented Rice Water)',   'काँजी',          'Kanji',               'other', n({ cal:16,  pro:0.5,  carb:3.5,  fat:0.1, fiber:0, ca:5,   fe:0.3, na:5,   probiotic:true })],

  // ════════════════════════════════════════════════════
  // BEVERAGES
  // ════════════════════════════════════════════════════
  ['Coconut Water (Tender)',         'नारियल पानी',    'Illaneer',            'fruit', n({ cal:19,  pro:0.7,  carb:3.7,  fat:0.2, fiber:1.1, sugar:2.6, b1:0.03, b2:0.06, b3:0.1, ca:24, fe:0.3, mg:25, p:20, k:250, na:105, vit_c:2.4, gi:3 })],
  ['Buttermilk (Chaas)',             'छाछ',            'Mor',                 'dairy', n({ cal:40,  pro:3.3,  carb:4.9,  fat:0.9, fiber:0, b2:0.15, b12:0.37, ca:116, fe:0.1, mg:11, p:93, k:151, na:257, probiotic:true })],
  ['Lassi (Sweet)',                  'लस्सी',          'Sweet Lassi',         'dairy', n({ cal:88,  pro:3.0,  carb:12.0, fat:3.5, fiber:0, b12:0.3, ca:110, fe:0.1, na:55, gi:45 })],
  ['Green Tea (Brewed)',             'हरी चाय',        'Green Tea',           'other', n({ cal:1,   pro:0,    carb:0.2,  fat:0, fiber:0, ca:0, fe:0, na:0, vit_c:0, gi:0 })],
  ['Black Coffee (No Sugar)',        'ब्लैक कॉफी',     'Black Coffee',        'other', n({ cal:2,   pro:0.3,  carb:0,    fat:0, fiber:0, ca:2,  fe:0.1, mg:3, p:3, k:49, na:2 })],
  ['Masala Chai (With Milk)',        'मसाला चाय',      'Masala Chai',         'dairy', n({ cal:48,  pro:1.9,  carb:5.2,  fat:2.0, fiber:0, b12:0.24, ca:64, fe:0.1, na:30, gi:40 })],

  // ════════════════════════════════════════════════════
  // COOKED DISHES & PREPARED FOODS
  // ════════════════════════════════════════════════════
  ['Dal (Toor Dal Cooked, Plain)',   'पकी दाल (अरहर)', 'Cooked Dal',          'grain', n({ cal:116, pro:6.8,  carb:20.0, fat:0.4, fiber:0.8, b1:0.06, b2:0.04, b3:0.9,  ca:20, fe:1.6, mg:48, p:78, k:290, na:5 })],
  ['Dal (Mixed, Restaurant Style)', 'मिक्स दाल',      'Mixed Dal',           'grain', n({ cal:135, pro:7.5,  carb:20.5, fat:3.5, fiber:2.0, ca:38, fe:2.0, mg:55, p:120, k:310, na:350 })],
  ['Sambar',                         'सांभर',          'Sambar',              'grain', n({ cal:46,  pro:2.5,  carb:7.5,  fat:1.2, fiber:2.0, ca:25, fe:1.2, mg:22, p:55, k:200, na:280 })],
  ['Rasam',                          'रसम',            'Rasam',               'other', n({ cal:18,  pro:0.6,  carb:3.5,  fat:0.5, fiber:0.5, ca:10, fe:0.4, na:350 })],
  ['Curd Rice (Thayir Sadam)',       'दही चावल',       'Thayir Sadam',        'grain', n({ cal:138, pro:3.8,  carb:22.5, fat:4.0, fiber:0.5, ca:80, fe:0.3, na:250, probiotic:true, gi:60 })],
  ['Khichdi (Moong Dal + Rice)',     'खिचड़ी',         'Khichdi',             'grain', n({ cal:116, pro:4.5,  carb:22.0, fat:1.2, fiber:1.5, ca:25, fe:1.5, mg:35, p:85, k:130, na:280, gi:51 })],
  ['Palak Paneer',                   'पालक पनीर',      'Saag Paneer',         'other', n({ cal:145, pro:7.5,  carb:5.5,  fat:11.0, fiber:2.0, ca:210, fe:2.5, mg:45, p:175, k:280, na:320, vit_a:230 })],
  ['Rajma Chawal',                   'राजमा चावल',     'Rajma Chawal',        'other', n({ cal:152, pro:6.5,  carb:28.5, fat:1.8, fiber:3.5, ca:45, fe:2.5, mg:55, p:130, k:320, na:380 })],
  ['Chicken Curry (Medium)',         'चिकन करी',       'Chicken Curry',       'other', n({ cal:180, pro:18.0, carb:4.5,  fat:10.5, fiber:1.0, ca:25, fe:1.5, mg:25, p:170, k:310, na:450 })],
  ['Fish Curry (Coconut Based)',     'मछली करी',       'Meen Kulambu',        'other', n({ cal:155, pro:15.0, carb:5.0,  fat:9.0, fiber:1.5, ca:180, fe:1.5, mg:35, p:195, k:290, na:480 })],
  ['Egg Bhurji (Scrambled Egg)',     'अंडा भुर्जी',    'Muttai Bhurji',       'other', n({ cal:185, pro:13.0, carb:2.5,  fat:14.0, fiber:0.5, ca:65, fe:1.8, mg:15, p:195, k:155, na:380, b12:1.0 })],
  ['Aloo Gobi (Dry)',                'आलू गोभी',       'Aloo Gobi',           'other', n({ cal:82,  pro:2.2,  carb:12.5, fat:3.2, fiber:2.5, ca:32, fe:0.6, mg:18, p:50, k:290, na:310 })],
  ['Baingan Bharta',                 'बैंगन भर्ता',    'Kathirikkai Gothsu',  'other', n({ cal:75,  pro:2.0,  carb:8.5,  fat:4.0, fiber:3.5, ca:20, fe:0.5, mg:18, p:45, k:250, na:330 })],
  ['Paneer Bhurji',                  'पनीर भुर्जी',    'Paneer Bhurji',       'other', n({ cal:195, pro:11.5, carb:4.5,  fat:15.0, fiber:0.5, ca:280, fe:0.5, mg:20, p:185, k:115, na:350 })],

  // ════════════════════════════════════════════════════
  // SWEETS & DESSERTS (for tracking purposes)
  // ════════════════════════════════════════════════════
  ['Gulab Jamun (1 pc ~40g)',        'गुलाब जामुन',    'Gulab Jamun',         'other', n({ cal:358, pro:5.5,  carb:55.0, fat:13.5, fiber:0.5, sugar:45.0, ca:110, fe:0.5, na:200, gi:80 })],
  ['Kheer (Rice Pudding)',           'खीर',            'Payasam',             'other', n({ cal:143, pro:4.0,  carb:22.5, fat:4.5, fiber:0.2, sugar:18.0, ca:130, fe:0.2, na:55, gi:60 })],
  ['Rasgulla',                       'रसगुल्ला',       'Rasgolla',            'other', n({ cal:186, pro:7.5,  carb:28.0, fat:5.5, fiber:0, sugar:25.0, ca:220, fe:0.3, na:80, gi:72 })],
  ['Ladoo (Besan)',                  'लड्डू (बेसन)',   'Besan Ladoo',         'other', n({ cal:480, pro:9.0,  carb:58.0, fat:24.0, fiber:2.0, sugar:45.0, ca:60, fe:2.5, na:100, gi:70 })],
  ['Halwa (Sooji)',                  'हलवा (सूजी)',    'Sooji Halwa',         'other', n({ cal:320, pro:4.5,  carb:48.0, fat:13.0, fiber:0.5, sugar:32.0, ca:25, fe:1.5, na:80, gi:70 })],

  // ════════════════════════════════════════════════════
  // POPULAR BRANDED / PACKAGED INDIAN FOODS
  // ════════════════════════════════════════════════════
  ['Amul Butter (Salted)',           'अमूल बटर',       'Amul Butter',         'branded', n({ cal:720, pro:0.9, carb:0.1, fat:81.0, fiber:0, sat_fat:51.0, na:650, vit_a:600 })],
  ['Amul Milk (Full Cream)',         'अमूल दूध',       'Amul Full Cream',     'branded', n({ cal:61,  pro:3.2, carb:4.6, fat:3.5, fiber:0, ca:120, b12:0.4, na:48 })],
  ['Amul Dahi (Curd)',               'अमूल दही',       'Amul Dahi',           'branded', n({ cal:60,  pro:3.5, carb:4.2, fat:3.2, fiber:0, ca:120, b12:0.35, na:43, probiotic:true })],
  ['Nandini Curd',                   'नंदिनी दही',     'Nandini Dahi',        'branded', n({ cal:58,  pro:3.5, carb:4.5, fat:2.8, fiber:0, ca:120, b12:0.35, na:43, probiotic:true })],
  ['MTR Ready-to-Eat Upma',         'MTR उपमा',       'MTR Upma',            'branded', n({ cal:135, pro:2.8, carb:22.0, fat:4.2, fiber:0.8, ca:15, fe:0.8, na:540 })],
  ['Maggi Noodles (Cooked)',         'मैगी नूडल्स',   'Maggi',               'branded', n({ cal:165, pro:4.0, carb:28.0, fat:4.5, fiber:0.5, ca:20, fe:0.8, na:580 })],
  ['Haldiram Namkeen (Bhujia)',      'हल्दीराम भुजिया','Bhujia',              'branded', n({ cal:522, pro:15.0, carb:55.0, fat:27.0, fiber:3.0, ca:75, fe:3.5, na:850 })],
  ['Britannia Whole Wheat Bread',   'ब्रिटानिया ब्रेड','Brown Bread',        'branded', n({ cal:248, pro:9.5, carb:47.0, fat:3.5, fiber:5.5, ca:100, fe:3.2, na:460, gi:69 })],
  ['Parle-G Biscuit',               'पारले-जी बिस्किट','Parle G',            'branded', n({ cal:448, pro:6.7, carb:76.4, fat:13.5, fiber:0.5, sugar:25.0, ca:40, fe:1.5, na:300, gi:80 })],
  ['Complan (Chocolate)',            'कॉम्प्लान',      'Complan',             'branded', n({ cal:382, pro:18.5, carb:56.0, fat:9.5, fiber:0, ca:720, fe:7.2, b12:1.2, vit_d:200, na:250 })],
  ['Ensure (Vanilla)',               'एन्श्योर',       'Ensure',              'branded', n({ cal:355, pro:13.5, carb:52.0, fat:10.5, fiber:0, ca:700, fe:8.0, b12:1.5, vit_d:300, na:350 })],
  ['Saffola Active Oil (Blend)',     'सफोला तेल',      'Saffola Oil',         'branded', n({ cal:884, pro:0, carb:0, fat:100, fiber:0, sat_fat:7.6, mufa:20.0, omega6:55000, vit_e:15.0 })],
  ['Tata Salt (Iodized)',            'टाटा नमक',       'Tata Salt',           'branded', n({ cal:0, pro:0, carb:0, fat:0, fiber:0, na:38758 })],
  ['Kissan Mixed Fruit Jam',         'किसान जैम',      'Fruit Jam',           'branded', n({ cal:241, pro:0.3, carb:59.8, fat:0.1, fiber:0.5, sugar:55.0, ca:20, na:50, gi:55 })],

  // ════════════════════════════════════════════════════
  // PROTEIN SUPPLEMENTS / POWDERS
  // ════════════════════════════════════════════════════
  ['Whey Protein (Unflavoured)',     'व्हे प्रोटीन',   'Whey Protein',        'supplement', n({ cal:400, pro:80.0, carb:8.0,  fat:5.0, fiber:0, ca:150, na:200, b12:0.5, gi:25 })],
  ['Whey Protein (Chocolate)',       'व्हे प्रोटीन (चॉकलेट)','Whey Choco',  'supplement', n({ cal:390, pro:75.0, carb:12.0, fat:5.0, fiber:1.0, ca:140, na:210, b12:0.5 })],
  ['Plant Protein Powder',          'प्लांट प्रोटीन', 'Plant Protein',       'supplement', n({ cal:380, pro:72.0, carb:15.0, fat:6.0, fiber:5.0, ca:120, fe:5.0, na:290 })],
  ['Creatine Monohydrate',          'क्रिएटिन',       'Creatine',            'supplement', n({ cal:0, pro:0, carb:0, fat:0, fiber:0 })],
  ['BCAA Powder',                   'BCAA',           'BCAA',                'supplement', n({ cal:40, pro:10.0, carb:0, fat:0, fiber:0 })],

  // ════════════════════════════════════════════════════
  // BEVERAGES & MISC (ADDITIONAL)
  // ════════════════════════════════════════════════════
  ['Almond Milk (Unsweetened)',      'बादाम का दूध',   'Almond Milk',         'dairy', n({ cal:13,  pro:0.4,  carb:0.3,  fat:1.0, fiber:0.3, ca:173, vit_d:41, vit_e:7.3, na:75 })],
  ['Soy Milk (Unsweetened)',         'सोया मिल्क',     'Soy Milk',            'dairy', n({ cal:33,  pro:3.3,  carb:1.6,  fat:1.8, fiber:0.4, ca:25,  vit_d:41, b12:0, na:51 })],
  ['Oat Milk (Unsweetened)',         'ओट मिल्क',       'Oat Milk',            'dairy', n({ cal:42,  pro:1.0,  carb:7.0,  fat:0.8, fiber:0.5, ca:120, vit_d:41, na:67, beta_glucan:0.8 })],
  ['Protein Bar (Generic)',          'प्रोटीन बार',    'Protein Bar',         'branded', n({ cal:380, pro:25.0, carb:40.0, fat:12.0, fiber:5.0, ca:200, na:200 })],
  ['Granola (Honey Oat)',            'ग्रेनोला',       'Granola',             'grain', n({ cal:471, pro:10.5, carb:64.0, fat:20.0, fiber:6.7, sugar:24.0, ca:50, fe:3.4, mg:95, p:220, k:305, na:38, gi:51 })],
  ['Muesli (No Sugar)',             'म्यूसली',        'Muesli',              'grain', n({ cal:363, pro:10.0, carb:68.0, fat:6.5, fiber:8.0, sugar:12.0, ca:55, fe:4.5, mg:80, p:200, k:280, na:50, gi:50 })],
  ['Cornflakes',                    'कॉर्नफ्लेक्स',   'Cornflakes',          'grain', n({ cal:357, pro:7.5,  carb:84.2, fat:0.4, fiber:1.2, sugar:10.0, ca:7, fe:8.8, na:499, gi:81 })],
  ['Protein Shake (Prepared)',      'प्रोटीन शेक',    'Protein Shake',       'branded', n({ cal:130, pro:20.0, carb:8.0,  fat:2.5, fiber:1.0, ca:200, na:150 })],


  // ════════════════════════════════════════════════════
  // MORE CEREALS / GRAINS
  // ════════════════════════════════════════════════════
  ['Little Millet (Samai)',          'समाई',           'Samai',               'grain', n({ cal:341, pro:7.7,  carb:65.6, fat:4.7, fiber:7.7, b1:0.30, b2:0.09, b3:3.2,  ca:17,  fe:9.3,  mg:92,  p:220, k:296, na:6 })],
  ['Kodo Millet (Varagu)',           'कोदो',           'Varagu',              'grain', n({ cal:309, pro:8.3,  carb:65.9, fat:1.4, fiber:9.0, b1:0.15, b2:0.09, b3:2.0,  ca:27,  fe:0.5,  mg:147, p:188, k:188, na:6 })],
  ['Foxtail Millet (Kangni)',        'कंगनी',          'Thinai',              'grain', n({ cal:351, pro:12.3, carb:63.2, fat:4.3, fiber:8.0, b1:0.59, b2:0.11, b3:3.2,  ca:31,  fe:2.8,  mg:81,  p:290, k:250, na:4 })],
  ['Proso Millet (Chena)',           'चेना',           'Panivaragu',          'grain', n({ cal:341, pro:12.5, carb:70.4, fat:1.1, fiber:2.2, b1:0.20, b2:0.08, b3:4.5,  ca:14,  fe:0.8,  mg:114, p:206, k:195, na:5 })],
  ['Barnyard Millet (Jhangora)',     'झंगोरा',         'Kuthiraivali',        'grain', n({ cal:307, pro:6.2,  carb:65.5, fat:2.9, fiber:12.6, b1:0.33, b2:0.1,  b3:4.2, ca:20,  fe:5.0,  mg:82,  p:280, k:210, na:6 })],
  ['Amaranth Grain',                 'राजगीरा',        'Rajgira',             'grain', n({ cal:371, pro:13.6, carb:65.3, fat:7.0, fiber:6.7, b1:0.12, b2:0.23, b3:0.9,  ca:159, fe:7.6,  mg:248, p:557, k:508, na:4,   gi:35 })],
  ['Sago (Sabudana)',                'साबूदाना',       'Javvarisi',           'grain', n({ cal:352, pro:0.2,  carb:88.7, fat:0.0, fiber:0.6, b1:0.01, ca:16,  fe:1.6,  mg:10,  p:7,   k:16,  na:1,   gi:80 })],
  ['Noodles (Rice, Dry)',            'चावल के नूडल्स', 'Rice Noodles',        'grain', n({ cal:364, pro:5.9,  carb:81.6, fat:0.6, fiber:1.8, ca:11, fe:0.5, mg:18, p:57, k:30, na:10, gi:61 })],
  ['Pasta (Whole Wheat, Dry)',       'होल व्हीट पास्ता','Pasta',              'grain', n({ cal:348, pro:13.0, carb:67.9, fat:2.5, fiber:7.1, b1:0.29, b2:0.14, b3:4.4, ca:38, fe:3.6, mg:105, p:257, k:360, na:6, gi:37 })],
  ['Pasta (Refined, Dry)',           'सफेद पास्ता',    'Maida Pasta',         'grain', n({ cal:371, pro:12.5, carb:74.7, fat:1.5, fiber:2.5, b1:0.24, b2:0.1,  b3:1.9, ca:21, fe:2.7, mg:47, p:189, k:186, na:6, gi:50 })],
  ['Rice Cakes (Puffed)',            'मुरमुरे',        'Pori',                'grain', n({ cal:399, pro:7.8,  carb:88.1, fat:0.5, fiber:0.8, b1:0.1, ca:5,  fe:1.1, mg:25, p:80, k:65, na:318, gi:87 })],
  ['Popcorn (Plain, Air-popped)',    'पॉपकॉर्न',       'Popcorn',             'grain', n({ cal:387, pro:12.9, carb:77.8, fat:4.5, fiber:14.5, b1:0.15, b2:0.05, b3:1.3, ca:7, fe:3.2, mg:144, p:358, k:329, na:8, gi:65 })],
  ['Tapioca (Cassava, Raw)',         'कसावा',          'Maravalli Kilangu',   'grain', n({ cal:160, pro:1.4,  carb:38.1, fat:0.3, fiber:1.8, b1:0.09, b2:0.05, b3:0.9, ca:16, fe:0.3, mg:21, p:27, k:271, na:14, vit_c:20.6, gi:67 })],
  ['Rice Vermicelli (Idiyappam)',    'इडियप्पम',       'Idiyappam',           'grain', n({ cal:350, pro:5.8,  carb:80.2, fat:0.3, fiber:1.8, ca:9,  fe:0.4, mg:15, p:55, k:40, na:12, gi:60 })],
  ['Moong Dal Cheela',               'मूंग चीला',      'Pesarattu',           'grain', n({ cal:155, pro:9.5,  carb:24.0, fat:3.5, fiber:2.5, ca:40, fe:2.0, mg:55, p:130, k:280, na:290, gi:35 })],

  // ════════════════════════════════════════════════════
  // MORE VEGETABLES
  // ════════════════════════════════════════════════════
  ['Chilli (Green, Raw)',            'हरी मिर्च',      'Pachai Milagai',      'vegetable', n({ cal:40,  pro:2.0,  carb:9.5,  fat:0.2, fiber:1.5, b1:0.09, b2:0.09, b3:0.9,  ca:18,  fe:1.2,  mg:25,  p:58,  k:340, na:7,   vit_c:242, vit_a:59 })],
  ['Curry Leaves (Kadi Patta)',      'करी पत्ता',      'Karuveppilai',        'vegetable', n({ cal:108, pro:6.1,  carb:18.7, fat:1.0, fiber:6.4, b1:0.08, b2:0.21, b3:2.3,  ca:810, fe:0.9,  mg:44,  p:57,  k:491, na:0,   vit_a:286, vit_c:4 })],
  ['Coriander Leaves (Hara Dhania)','हरा धनिया',      'Kothamalli',          'vegetable', n({ cal:23,  pro:2.1,  carb:3.7,  fat:0.5, fiber:2.8, b1:0.07, b2:0.16, b3:1.1,  ca:67,  fe:1.8,  mg:26,  p:48,  k:521, na:46,  vit_a:337, vit_c:27, vit_k:310 })],
  ['Mint Leaves (Pudina)',           'पुदीना',         'Pudina',              'vegetable', n({ cal:70,  pro:3.8,  carb:14.9, fat:0.9, fiber:8.0, b1:0.08, b2:0.17, b3:1.2,  ca:243, fe:5.1,  mg:80,  p:73,  k:569, na:31,  vit_a:212, vit_c:31.8, vit_k:551 })],
  ['Snake Gourd (Padwal)',           'परवल',           'Pudalangai',          'vegetable', n({ cal:18,  pro:0.5,  carb:3.3,  fat:0.3, fiber:0.8, b1:0.04, b2:0.03, b3:0.4,  ca:26,  fe:0.7,  mg:18,  p:24,  k:150, na:3 })],
  ['Pointed Gourd (Parwal)',         'परवल',           'Kovakkai',            'vegetable', n({ cal:20,  pro:2.0,  carb:2.2,  fat:0.3, fiber:3.0, b1:0.05, b2:0.06, b3:0.5,  ca:30,  fe:1.7,  mg:16,  p:40,  k:83,  na:3,   vit_c:29 })],
  ['Ivy Gourd (Tindora)',            'टिंडोरा',        'Kovakkai',            'vegetable', n({ cal:17,  pro:1.2,  carb:3.1,  fat:0.1, fiber:1.6, b1:0.08, b2:0.08, b3:0.5,  ca:40,  fe:1.4,  mg:17,  p:30,  k:93,  na:2 })],
  ['Fiddlehead Fern (Lingda)',       'लिंगड़ा',        'Lingda',              'vegetable', n({ cal:34,  pro:4.6,  carb:5.5,  fat:0.4, fiber:3.0, b1:0.02, b2:0.21, b3:4.9,  ca:32,  fe:1.3,  mg:34,  p:101, k:370, na:1,   vit_c:26.6, vit_a:181 })],
  ['Broad Beans (Sem/Val)',          'सेम की फली',     'Avarakkai',           'vegetable', n({ cal:46,  pro:4.0,  carb:8.4,  fat:0.4, fiber:4.2, b1:0.09, b2:0.09, b3:0.6,  ca:63,  fe:1.9,  mg:43,  p:73,  k:280, na:9,   vit_c:20.3 })],
  ['Jackbean / Sword Bean',          'सफेद राजमा',     'Sword Bean',          'vegetable', n({ cal:22,  pro:1.8,  carb:3.0,  fat:0.2, fiber:3.0, ca:40,  fe:0.6,  mg:25,  p:35,  k:180, na:3 })],
  ['Spring Onion / Scallion',        'हरी प्याज',      'Spring Onion',        'vegetable', n({ cal:32,  pro:1.8,  carb:7.3,  fat:0.2, fiber:2.6, b1:0.06, b2:0.08, b3:0.5,  ca:72,  fe:1.5,  mg:20,  p:37,  k:276, na:16,  vit_a:50,  vit_c:18.8, vit_k:207 })],
  ['Celery',                         'अजमोद',          'Celery',              'vegetable', n({ cal:16,  pro:0.7,  carb:3.0,  fat:0.2, fiber:1.6, b1:0.02, b2:0.06, b3:0.3,  ca:40,  fe:0.2,  mg:11,  p:24,  k:260, na:80,  vit_a:22,  vit_c:3.1,  vit_k:29.3 })],
  ['Zucchini / Courgette',           'ज़ुकिनी',        'Zucchini',            'vegetable', n({ cal:17,  pro:1.2,  carb:3.1,  fat:0.3, fiber:1.0, b1:0.05, b2:0.09, b3:0.5,  ca:16,  fe:0.4,  mg:18,  p:38,  k:261, na:8,   vit_c:17.9, vit_a:10 })],
  ['French Beans (String Beans)',    'फ्रेंच बींस',    'French Beans',        'vegetable', n({ cal:31,  pro:1.8,  carb:7.0,  fat:0.2, fiber:3.4, b1:0.08, b2:0.1,  b3:0.7,  ca:37,  fe:1.0,  mg:25,  p:38,  k:211, na:6,   vit_c:12.2, vit_k:14.4 })],
  ['Kolrabi (Ganth Gobi)',           'गांठ गोभी',      'Noolkol',             'vegetable', n({ cal:27,  pro:1.7,  carb:6.2,  fat:0.1, fiber:3.6, b1:0.05, b2:0.02, b3:0.4,  ca:24,  fe:0.4,  mg:19,  p:46,  k:350, na:20,  vit_c:62.0, gi:15 })],
  ['Chinese Cabbage (Bok Choy)',     'बोक चोय',        'Bok Choy',            'vegetable', n({ cal:13,  pro:1.5,  carb:2.2,  fat:0.2, fiber:1.0, b1:0.04, b2:0.07, b3:0.5,  ca:105, fe:0.8,  mg:19,  p:37,  k:252, na:65,  vit_a:223, vit_c:45, vit_k:45.5 })],
  ['Kale',                           'केल',            'Kale',                'vegetable', n({ cal:49,  pro:4.3,  carb:8.8,  fat:0.9, fiber:3.6, b1:0.11, b2:0.13, b3:1.0,  ca:150, fe:1.5,  mg:47,  p:92,  k:491, na:38,  vit_a:241, vit_c:120, vit_k:817, folate:141 })],
  ['Arugula (Rocket Leaves)',        'अरुगुला',        'Arugula',             'vegetable', n({ cal:25,  pro:2.6,  carb:3.7,  fat:0.7, fiber:1.6, b1:0.04, b2:0.09, b3:0.3,  ca:160, fe:1.5,  mg:47,  p:52,  k:369, na:27,  vit_a:119, vit_c:15, vit_k:109 })],
  ['Watercress',                     'वाटरक्रेस',      'Watercress',          'vegetable', n({ cal:11,  pro:2.3,  carb:1.3,  fat:0.1, fiber:0.5, b1:0.09, b2:0.12, b3:0.2,  ca:120, fe:0.2,  mg:21,  p:60,  k:330, na:41,  vit_a:160, vit_c:43, vit_k:250 })],
  ['Leek',                           'लीक',            'Leek',                'vegetable', n({ cal:61,  pro:1.5,  carb:14.2, fat:0.3, fiber:1.8, b1:0.06, b2:0.03, b3:0.4,  ca:59,  fe:2.1,  mg:28,  p:35,  k:180, na:20,  vit_a:83,  vit_c:12, vit_k:47 })],

  // ════════════════════════════════════════════════════
  // MORE FRUITS
  // ════════════════════════════════════════════════════
  ['Kiwi Fruit',                     'कीवी',           'Kiwi',                'fruit', n({ cal:61,  pro:1.1,  carb:14.7, fat:0.5, fiber:3.0, sugar:9.0, b1:0.03, b2:0.03, b3:0.3, ca:34,  fe:0.3,  mg:17,  p:34,  k:312, na:3,   vit_c:92.7, vit_e:1.5, vit_k:40.3, gi:50 })],
  ['Blueberry',                      'ब्लूबेरी',       'Blueberry',           'fruit', n({ cal:57,  pro:0.7,  carb:14.5, fat:0.3, fiber:2.4, sugar:10.0, b1:0.04, b2:0.04, b3:0.4, ca:6,   fe:0.3,  mg:6,   p:12,  k:77,  na:1,   vit_c:9.7,  vit_k:19.3, gi:40 })],
  ['Raspberry',                      'रास्पबेरी',      'Raspberry',           'fruit', n({ cal:52,  pro:1.2,  carb:11.9, fat:0.7, fiber:6.5, sugar:4.4, b1:0.03, b2:0.04, b3:0.6, ca:25,  fe:0.7,  mg:22,  p:29,  k:151, na:1,   vit_c:26.2, vit_k:7.8, gi:25 })],
  ['Blackberry',                     'ब्लैकबेरी',      'Blackberry',          'fruit', n({ cal:43,  pro:1.4,  carb:9.6,  fat:0.5, fiber:5.3, sugar:4.9, b1:0.02, b2:0.03, b3:0.6, ca:29,  fe:0.6,  mg:20,  p:22,  k:162, na:1,   vit_c:21.0, vit_k:19.8 })],
  ['Fig (Fresh, Anjeer)',            'अंजीर (ताजा)',   'Fresh Fig',           'fruit', n({ cal:74,  pro:0.8,  carb:19.2, fat:0.3, fiber:2.9, sugar:16.3, b1:0.06, b2:0.05, b3:0.4, ca:35,  fe:0.4,  mg:17,  p:14,  k:232, na:1,   vit_c:2.0, vit_k:4.7 })],
  ['Fig (Dried, Anjeer)',            'अंजीर (सूखा)',   'Dry Fig',             'fruit', n({ cal:249, pro:3.3,  carb:63.9, fat:0.9, fiber:9.8, sugar:47.9, b1:0.09, b2:0.08, b3:0.6, ca:162, fe:2.0,  mg:68,  p:67,  k:680, na:10,  gi:61, gl:38 })],
  ['Apricot (Khubani, Fresh)',       'खुबानी (ताजी)', 'Khubani',             'fruit', n({ cal:48,  pro:1.4,  carb:11.1, fat:0.4, fiber:2.0, sugar:9.2, b1:0.03, b2:0.04, b3:0.6, ca:13,  fe:0.4,  mg:10,  p:23,  k:259, na:1,   vit_a:96, vit_c:10.0, gi:34 })],
  ['Peach (Aadoo)',                  'आड़ू',           'Peach',               'fruit', n({ cal:39,  pro:0.9,  carb:9.5,  fat:0.3, fiber:1.5, sugar:8.4, b1:0.02, b2:0.03, b3:0.8, ca:6,   fe:0.3,  mg:9,   p:20,  k:190, na:0,   vit_a:16,  vit_c:6.6, gi:42 })],
  ['Plum (Aloo Bukhara)',            'आलू बुखारा',     'Plum',                'fruit', n({ cal:46,  pro:0.7,  carb:11.4, fat:0.3, fiber:1.4, sugar:9.9, b1:0.03, b2:0.03, b3:0.4, ca:6,   fe:0.2,  mg:7,   p:16,  k:157, na:0,   vit_a:17,  vit_c:9.5, gi:39 })],
  ['Jackfruit Seeds (Kathal Beej)',  'कटहल के बीज',    'Kathal Beej',         'fruit', n({ cal:98,  pro:6.6,  carb:18.4, fat:0.4, fiber:1.5, b1:0.3, b2:0.1, b3:4.0, ca:50, fe:1.5, mg:54, p:200, k:500, na:2, vit_c:0.4 })],
  ['Tamarind (Imli, Pulp)',          'इमली',           'Puli',                'fruit', n({ cal:239, pro:2.8,  carb:62.5, fat:0.6, fiber:5.1, sugar:57.4, b1:0.43, b2:0.15, b3:1.9, ca:74,  fe:2.8,  mg:92,  p:113, k:628, na:28,  vit_c:3.5 })],

  // ════════════════════════════════════════════════════
  // MORE FISH & SEAFOOD
  // ════════════════════════════════════════════════════
  ['Sardines (Raw)',                 'सार्डिन',        'Mathi Meen',          'other', n({ cal:208, pro:24.6, carb:0, fat:11.5, fiber:0, b1:0.03, b2:0.23, b3:5.6, b12:8.94, vit_d:193, ca:382, fe:2.9, mg:39, p:490, k:397, na:307, omega3_epa:473, omega3_dha:509, chol:142 })],
  ['Fish — Hilsa (Raw)',             'हिल्सा / इलिश', 'Mathi',               'other', n({ cal:273, pro:19.4, carb:0, fat:21.8, fiber:0, b12:4.2, vit_d:200, ca:180, fe:1.0, mg:32, p:225, k:380, na:82, omega3_epa:700, omega3_dha:1200, chol:85 })],
  ['Crab (Steamed)',                 'केकड़ा',         'Nandu',               'other', n({ cal:97,  pro:19.5, carb:0, fat:1.8, fiber:0, b12:9.78, vit_d:0, ca:59, fe:0.5, mg:42, p:259, k:329, na:395, chol:78 })],
  ['Squid / Calamari',               'स्क्विड',        'Kanava',              'other', n({ cal:92,  pro:15.6, carb:3.1, fat:1.4, fiber:0, b12:1.3, vit_d:0, ca:32, fe:0.7, mg:33, p:221, k:246, na:282, chol:233, omega3_epa:200, omega3_dha:330 })],
  ['Mussel (Raw)',                   'शंबुक',          'Kadal Kaaligai',      'other', n({ cal:86,  pro:11.9, carb:3.7, fat:2.2, fiber:0, b12:12.0, vit_d:16, ca:26, fe:3.95, mg:37, p:197, k:320, na:286, omega3_epa:376, omega3_dha:506, chol:28 })],
  ['Fish — Tilapia (Raw)',           'तिलापिया',       'Tilapia',             'other', n({ cal:96,  pro:20.1, carb:0, fat:1.7, fiber:0, b12:1.58, vit_d:60, ca:10, fe:0.6, mg:27, p:170, k:302, na:56, omega3_epa:100, omega3_dha:220, chol:50 })],
  ['Fish — Sole / Flounder (Raw)',   'सोल मछली',       'Sole',                'other', n({ cal:91,  pro:18.8, carb:0, fat:1.2, fiber:0, b12:1.36, vit_d:64, ca:24, fe:0.3, mg:29, p:191, k:304, na:81, omega3_epa:100, omega3_dha:150, chol:48 })],
  ['Fish — Bangda (Indian Mackerel)','बांगड़ा',        'Bangda',              'other', n({ cal:150, pro:18.5, carb:0, fat:8.5, fiber:0, b12:10.0, vit_d:350, ca:45, fe:1.2, mg:35, p:220, k:315, na:72, omega3_epa:520, omega3_dha:1200, chol:65 })],
  ['Lobster (Cooked)',               'झींगा मछली',     'Lobster',             'other', n({ cal:98,  pro:20.5, carb:1.3, fat:0.6, fiber:0, b12:2.06, vit_d:0, ca:61, fe:0.4, mg:42, p:192, k:332, na:381, omega3_epa:150, omega3_dha:360, chol:95 })],
  ['Fish — Rawas (Indian Salmon)',   'रावस',           'Rawas',               'other', n({ cal:156, pro:23.0, carb:0, fat:6.5, fiber:0, b12:4.0, vit_d:350, ca:18, fe:0.5, mg:28, p:240, k:360, na:55, omega3_epa:450, omega3_dha:1100, chol:55 })],

  // ════════════════════════════════════════════════════
  // MORE NUTS & SEEDS
  // ════════════════════════════════════════════════════
  ['Hemp Seeds',                     'भांग के बीज',    'Hemp Seeds',          'nut', n({ cal:553, pro:31.6, carb:8.7,  fat:48.8, fiber:4.0, b1:1.28, b2:0.33, b3:9.2, ca:70,  fe:7.95, mg:700, p:1650,k:1200,na:5,   vit_e:0.8, ala:8708, omega6:28600, omega3_epa:0, gi:15 })],
  ['Poppy Seeds (Khus Khus)',        'खसखस',           'Khus Khus',           'nut', n({ cal:525, pro:17.9, carb:28.1, fat:41.6, fiber:19.5, b1:0.85, b2:0.1, b3:0.9, ca:1438,fe:9.8,  mg:347, p:870, k:719, na:26,  vit_c:1.0 })],
  ['Melon Seeds (Magaz/Chaar Magaz)','मगज',            'Magaz',               'nut', n({ cal:557, pro:28.8, carb:20.0, fat:45.6, fiber:3.0, ca:50, fe:7.5, mg:535, p:730, k:648, na:14, vit_e:1.5 })],
  ['Lotus Seeds (Makhana, Roasted)', 'भुना मखाना',     'Roasted Makhana',     'nut', n({ cal:374, pro:9.7,  carb:80.0, fat:0.5, fiber:14.5, b1:0.2, ca:60, fe:1.4, mg:67, p:200, k:500, na:1, gi:38 })],
  ['Tahini (Sesame Paste)',          'तिल की चटनी',    'Tahini',              'nut', n({ cal:592, pro:17.0, carb:21.2, fat:53.8, fiber:9.3, b1:0.4, b2:0.24, b3:5.4, ca:426, fe:8.9, mg:274, p:774, k:414, na:31 })],
  ['Almond Butter',                  'बादाम मक्खन',    'Almond Butter',       'nut', n({ cal:614, pro:20.96, carb:18.8, fat:55.5, fiber:12.5, b1:0.06, b2:1.0, b3:3.9, ca:347, fe:3.5, mg:279, p:478, k:748, na:4, vit_e:24.2 })],
  ['Peanut Butter (Natural)',        'मूंगफली का मक्खन','Peanut Butter',      'nut', n({ cal:588, pro:25.1, carb:20.1, fat:50.4, fiber:6.0, b1:0.15, b2:0.19, b3:13.1, ca:43, fe:1.9, mg:170, p:358, k:649, na:6, vit_e:9.1, gi:14 })],
  ['Dried Coconut (Copra)',          'खोपरा',          'Kopparai Thengai',    'nut', n({ cal:659, pro:6.9,  carb:23.7, fat:64.5, fiber:16.3, b1:0.06, b2:0.03, b3:0.9, ca:26,  fe:3.3,  mg:90,  p:206, k:543, na:37,  sat_fat:57.2 })],

  // ════════════════════════════════════════════════════
  // MORE BRANDED / PACKAGED
  // ════════════════════════════════════════════════════
  ['Epigamia Greek Yoghurt (Plain)',  'एपिगामिया ग्रीक योगर्ट','Greek Yogurt', 'branded', n({ cal:73,  pro:6.5, carb:5.0,  fat:2.8, fiber:0, b12:0.5, ca:111, na:36, gi:11, probiotic:true })],
  ['Epigamia Greek Yoghurt (Mango)', 'एपिगामिया ग्रीक योगर्ट मैंगो','Mango Yogurt','branded',n({ cal:89, pro:4.0,  carb:14.0, fat:2.0, fiber:0, ca:100, na:40 })],
  ['Epigamia Protein Curd',          'एपिगामिया प्रोटीन कर्ड','Protein Curd', 'branded', n({ cal:80,  pro:8.5, carb:5.5,  fat:2.5, fiber:0, ca:130, na:45, probiotic:true })],
  ['Amul Taaza (Toned Milk)',         'अमूल ताजा',      'Amul Taaza',          'branded', n({ cal:58,  pro:3.0, carb:4.4,  fat:3.0, fiber:0, ca:110, na:50, b12:0.4 })],
  ['Amul Kool Koko (Choco Milk)',     'अमूल कूल',       'Amul Kool',           'branded', n({ cal:74,  pro:3.0, carb:11.5, fat:1.5, fiber:0, ca:110, na:60, sugar:10.5 })],
  ['Nandini Milk (Full Cream)',       'नंदिनी मिल्क',   'Nandini Milk',        'branded', n({ cal:61,  pro:3.2, carb:4.6,  fat:3.3, fiber:0, ca:115, na:48, b12:0.4 })],
  ['Mother Dairy Curd (500g)',        'मदर डेयरी दही',  'Mother Dairy Dahi',   'branded', n({ cal:60,  pro:3.5, carb:4.5,  fat:2.8, fiber:0, ca:120, na:43, probiotic:true })],
  ['Saffola Oats (Original)',         'सफोला ओट्स',     'Saffola Oats',        'branded', n({ cal:390, pro:13.5, carb:62.0, fat:9.5, fiber:10.0, ca:45, fe:4.5, na:400, beta_glucan:4.0 })],
  ['Tata Sampann Moong Dal',          'टाटा संपन्न मूंग दाल','Tata Sampann',  'branded', n({ cal:334, pro:24.0, carb:56.7, fat:1.3, fiber:4.1, ca:73, fe:8.5, na:28 })],
  ['Aashirvaad Atta (Whole Wheat)',   'आशीर्वाद आटा',   'Aashirvaad Atta',     'branded', n({ cal:346, pro:12.0, carb:72.0, fat:1.5, fiber:2.0, ca:40, fe:5.0, na:17, gi:54 })],
  ['Fortune Chakki Fresh Atta',       'फॉर्चून आटा',    'Fortune Atta',        'branded', n({ cal:345, pro:12.0, carb:72.0, fat:1.5, fiber:1.8, ca:38, fe:4.8, na:15 })],
  ['Horlicks Classic Malt',           'हॉर्लिक्स',      'Horlicks',            'branded', n({ cal:378, pro:9.0, carb:77.5, fat:4.5, fiber:0, ca:400, fe:7.2, vit_d:200, b12:1.0, na:260 })],
  ['Bournvita (5 Star Magic)',        'बोर्नविटा',      'Bournvita',           'branded', n({ cal:372, pro:5.5, carb:83.5, fat:2.3, fiber:0, ca:325, fe:6.6, vit_d:125, b12:1.0, na:245 })],
  ['Milo (Nestle)',                   'माइलो',          'Milo',                'branded', n({ cal:379, pro:7.9, carb:77.0, fat:5.7, fiber:0, ca:570, fe:12.5, vit_d:233, na:325 })],
  ['Protinex (Original)',             'प्रोटिनेक्स',    'Protinex',            'branded', n({ cal:370, pro:55.0, carb:27.5, fat:7.5, fiber:0, ca:500, fe:7.0, vit_d:200, b12:2.0, na:300 })],
  ['Too Yumm Multigrain Chips',       'टू यम्म चिप्स', 'Multigrain Chips',    'branded', n({ cal:425, pro:9.0, carb:73.0, fat:12.0, fiber:5.0, ca:40, na:650 })],
  ['Haldiram Aloo Bhujia',            'हल्दीराम आलू भुजिया','Aloo Bhujia',    'branded', n({ cal:510, pro:9.5, carb:56.5, fat:27.5, fiber:3.5, ca:75, na:900 })],
  ['Parle Monaco Crackers',           'पार्ले मोनाको',  'Monaco',              'branded', n({ cal:452, pro:9.0, carb:70.8, fat:15.5, fiber:1.5, ca:45, na:750 })],
  ['McVities Digestive Biscuits',     'डाइजेस्टिव बिस्किट','Digestive',       'branded', n({ cal:471, pro:9.0, carb:64.0, fat:20.0, fiber:4.0, ca:85, fe:2.5, na:460, gi:62 })],
  ['Quaker Oats (Rolled)',            'क्वेकर ओट्स',   'Quaker Oats',         'branded', n({ cal:374, pro:12.5, carb:67.7, fat:6.9, fiber:10.0, ca:50, fe:4.3, mg:138, na:2, beta_glucan:4.0 })],
  ['Kellogg\'s Corn Flakes',         'कॉर्न फ्लेक्स',  'Kelloggs Cornflakes', 'branded', n({ cal:357, pro:7.5, carb:83.6, fat:0.9, fiber:1.2, sugar:10.0, ca:7, fe:8.8, na:499, gi:81 })],
  ['Kellogg\'s Muesli (No Sugar)',    'केलॉग म्यूसली',  'Kelloggs Muesli',     'branded', n({ cal:340, pro:10.0, carb:64.0, fat:6.5, fiber:7.0, ca:55, fe:4.5, na:70, gi:50 })],

  // ════════════════════════════════════════════════════
  // ADDITIONAL PREPARED FOODS / SNACKS
  // ════════════════════════════════════════════════════
  ['Panipuri Shell (Dry)',            'पानी पुरी पापड़','Golgappa',            'grain', n({ cal:412, pro:9.0, carb:80.0, fat:6.0, fiber:2.5, ca:40, fe:3.0, na:400 })],
  ['Bhel Puri',                       'भेल पुरी',       'Bhel',                'grain', n({ cal:170, pro:4.0, carb:28.0, fat:5.5, fiber:2.5, ca:30, fe:1.8, na:320 })],
  ['Vada Pav',                        'वड़ा पाव',       'Vada Pav',            'grain', n({ cal:280, pro:6.5, carb:38.5, fat:11.5, fiber:2.5, ca:55, fe:2.0, na:580 })],
  ['Samosa (1 pc)',                   'समोसा',          'Samosa',              'grain', n({ cal:262, pro:4.5, carb:30.0, fat:14.0, fiber:2.0, ca:25, fe:1.8, na:380 })],
  ['Pakora (Onion / Vegetable)',      'पकोड़ा',         'Pakora',              'grain', n({ cal:262, pro:5.5, carb:25.0, fat:15.5, fiber:2.5, ca:55, fe:2.5, na:420 })],
  ['Murukku',                         'मुरुक्कू',       'Murukku',             'grain', n({ cal:490, pro:8.5, carb:65.0, fat:22.0, fiber:3.0, ca:40, fe:3.5, na:550 })],
  ['Chakli',                          'चकली',           'Chakli',              'grain', n({ cal:478, pro:9.0, carb:62.5, fat:21.5, fiber:3.5, ca:45, fe:4.0, na:530 })],
  ['Roasted Chana (Bengal Gram)',     'भुना चना',       'Fried Gram',          'grain', n({ cal:390, pro:18.0, carb:61.5, fat:6.5, fiber:5.0, ca:50, fe:5.5, mg:95, p:260, k:540, na:18, gi:25 })],
  ['Chana Jor Garam',                 'चना जोर गरम',   'Chana Jor Garam',     'grain', n({ cal:398, pro:16.5, carb:65.0, fat:7.5, fiber:4.5, ca:90, fe:5.0, na:550 })],
  ['Banana Chips',                    'केले के चिप्स', 'Banana Chips',        'grain', n({ cal:519, pro:2.3, carb:58.4, fat:33.6, fiber:7.7, ca:17, fe:1.3, mg:64, k:536, na:6 })],
  ['Prawn Crackers',                  'झींगा पापड़',    'Prawn Crackers',      'other', n({ cal:460, pro:7.5, carb:73.5, fat:16.0, fiber:0.5, ca:40, na:640 })],
  ['Rice Papad (Appalam)',            'अप्पलम',         'Appalam',             'grain', n({ cal:360, pro:10.0, carb:72.0, fat:2.5, fiber:1.5, ca:35, na:3500 })],
  ['Moong Dal Khichdi',               'मूंग दाल खिचड़ी','Moong Khichdi',      'grain', n({ cal:110, pro:5.5, carb:20.5, fat:1.0, fiber:2.0, ca:30, fe:1.8, mg:40, na:280, gi:45 })],
  ['Pav Bhaji',                       'पाव भाजी',       'Pav Bhaji',           'grain', n({ cal:205, pro:5.5, carb:30.5, fat:7.5, fiber:3.5, ca:55, fe:1.5, vit_c:20, na:520 })],
  ['Chole (Chickpea Curry)',          'छोले',           'Chole',               'grain', n({ cal:145, pro:7.5, carb:24.0, fat:3.5, fiber:5.0, ca:60, fe:3.0, mg:48, na:350 })],
  ['Dal Makhani',                     'दाल मखनी',       'Dal Makhani',         'grain', n({ cal:163, pro:8.0, carb:20.5, fat:5.8, fiber:3.5, ca:75, fe:3.5, na:420 })],
  ['Butter Chicken (Murgh Makhani)', 'बटर चिकन',       'Butter Chicken',      'other', n({ cal:190, pro:16.5, carb:7.5, fat:11.0, fiber:1.0, ca:40, fe:1.5, na:480 })],
  ['Biryani (Chicken)',               'चिकन बिरयानी',   'Chicken Biryani',     'other', n({ cal:213, pro:13.5, carb:28.0, fat:5.5, fiber:1.0, ca:35, fe:1.5, na:490 })],
  ['Pulao (Vegetable)',               'सब्जी पुलाव',    'Veg Pulao',           'grain', n({ cal:173, pro:3.5, carb:32.0, fat:3.5, fiber:1.5, ca:20, fe:0.8, na:380, gi:65 })],
  ['Paneer Tikka (Grilled)',          'पनीर टिक्का',    'Paneer Tikka',        'other', n({ cal:220, pro:14.0, carb:6.5, fat:15.5, fiber:1.0, ca:330, fe:0.5, na:420 })],
  ['Raita (Plain Boondi)',            'रायता',          'Raita',               'dairy', n({ cal:68,  pro:3.0, carb:6.5, fat:3.5, fiber:0.5, ca:110, na:220, probiotic:true })],

  // ════════════════════════════════════════════════════
  // ADDITIONAL MISC (DIABETES / HEALTH FOODS)
  // ════════════════════════════════════════════════════
  ['Bitter Melon Juice (Karela)',    'करेला जूस',      'Karela Juice',        'other', n({ cal:6,   pro:0.4, carb:1.2, fat:0.1, fiber:0.5, ca:5, fe:0.2, vit_c:30, na:3 })],
  ['Coconut Milk (Full Fat)',        'नारियल का दूध',  'Coconut Milk',        'other', n({ cal:230, pro:2.3, carb:5.5, fat:23.8, fiber:2.2, ca:16, fe:3.3, mg:37, p:100, k:263, na:15, sat_fat:21.1 })],
  ['Coconut Milk (Light)',           'पतला नारियल दूध','Light Coconut Milk',  'other', n({ cal:77,  pro:0.8, carb:1.6, fat:7.2, fiber:0, ca:10, fe:0.8, mg:12, na:12, sat_fat:6.6 })],
  ['Psyllium Husk (Isabgol)',        'इसबगोल',         'Isabgol',             'supplement', n({ cal:200, pro:2.0, carb:85.0, fat:0.5, fiber:80.0, ca:30, na:10, gi:10, prebiotic:5.0, beta_glucan:0.5 })],
  ['Wheat Germ',                     'गेहूं का कीटाणु','Wheat Germ',          'grain', n({ cal:382, pro:23.1, carb:51.8, fat:9.7, fiber:13.2, b1:1.88, b2:0.49, b3:6.8, b6:1.3, ca:39, fe:6.3, mg:239, p:842, k:892, na:12, vit_e:15.1, folate:281, zn:12.3 })],
  ['Amla Powder (Dried)',            'आंवला पाउडर',    'Amla Powder',         'supplement', n({ cal:274, pro:2.0, carb:65.4, fat:0.5, fiber:32.0, ca:116, fe:1.0, mg:50, p:76, k:570, na:4, vit_c:1800, gi:10 })],
  ['Moringa Powder',                 'सहजन पाउडर',     'Moringa Powder',      'supplement', n({ cal:205, pro:27.1, carb:38.2, fat:2.3, fiber:19.2, ca:2003, fe:28.2, mg:368, p:204, k:1324, na:9, vit_a:1130, vit_c:17.3, b12:0, gi:15 })],
  ['Ashwagandha Powder',             'अश्वगंधा',       'Ashwagandha',         'supplement', n({ cal:245, pro:3.9, carb:49.9, fat:0.3, fiber:32.3, ca:23, fe:3.3, mg:0, na:6 })],
  ['Turmeric Milk (Haldi Doodh)',    'हल्दी दूध',      'Golden Milk',         'dairy', n({ cal:70,  pro:3.0, carb:7.5, fat:3.2, fiber:0.3, ca:110, fe:0.2, na:50, probiotic:false })],
  ['Curd with Flaxseed',             'अलसी वाला दही',  'Flaxseed Dahi',       'dairy', n({ cal:130, pro:4.5, carb:5.0, fat:9.5, fiber:5.0, ca:130, fe:0.8, ala:4500, na:38, probiotic:true })],
  ['Green Moong Salad',              'हरे मूंग का सलाद','Moong Salad',        'grain', n({ cal:45,  pro:4.2, carb:7.5, fat:0.3, fiber:2.5, ca:25, fe:1.5, vit_c:5, na:120 })],
  ['Vegetable Soup (Clear)',         'सब्जी सूप',      'Veg Soup',            'other', n({ cal:25,  pro:1.5, carb:4.5, fat:0.5, fiber:1.5, ca:20, fe:0.5, vit_a:80, na:380 })],
  ['Oatmeal (Cooked with Water)',    'पके ओट्स',       'Porridge',            'grain', n({ cal:71,  pro:2.5, carb:12.0, fat:1.4, fiber:1.7, ca:10, fe:0.9, mg:26, na:49, gi:55, beta_glucan:0.8 })],
  ['Overnight Oats',                 'ओवरनाइट ओट्स',  'Overnight Oats',      'grain', n({ cal:145, pro:5.5, carb:24.5, fat:3.0, fiber:3.0, ca:70, fe:1.5, mg:45, na:80, gi:50, probiotic:true })],
  ['Fruit Salad (Mixed)',            'फलों का सलाद',   'Fruit Salad',         'fruit', n({ cal:55,  pro:0.8, carb:14.0, fat:0.2, fiber:2.0, sugar:11.0, ca:15, fe:0.3, vit_c:30, gi:45 })],
  ['Vegetable Raita',                'वेजिटेबल रायता', 'Veg Raita',           'dairy', n({ cal:55,  pro:2.8, carb:6.0, fat:2.5, fiber:0.8, ca:105, na:190, probiotic:true })],
  ['Sprouts Salad (Mixed)',          'अंकुरित अनाज सलाद','Sprouts Salad',     'grain', n({ cal:80,  pro:6.5, carb:13.5, fat:0.5, fiber:4.0, ca:40, fe:2.0, vit_c:15, na:95 })],

  // ════════════════════════════════════════════════════
  // SOUTH INDIAN REGIONAL FOODS
  // ════════════════════════════════════════════════════
  ['Pongal (Ven Pongal)',            'वेण पोंगल',      'Ven Pongal',          'grain', n({ cal:162, pro:5.0, carb:26.5, fat:4.5, fiber:1.5, ca:20, fe:1.0, mg:35, na:310 })],
  ['Curd Rice (Mosaranna)',          'मोसरन्ना',        'Mosaranna',           'grain', n({ cal:130, pro:3.5, carb:22.0, fat:3.5, fiber:0.5, ca:80, fe:0.2, na:245, probiotic:true })],
  ['Rasam (Tomato)',                 'टमाटर रसम',      'Thakkali Rasam',      'other', n({ cal:22,  pro:0.8, carb:4.5, fat:0.6, fiber:0.8, ca:15, fe:0.5, vit_c:8, na:400 })],
  ['Kootu (Mixed Vegetables)',       'कूटू',           'Kootu',               'other', n({ cal:95,  pro:3.0, carb:12.0, fat:4.5, fiber:4.0, ca:45, fe:1.2, na:280 })],
  ['Avial',                          'अवियल',          'Avial',               'other', n({ cal:102, pro:2.5, carb:10.5, fat:5.5, fiber:3.5, ca:55, fe:0.8, vit_c:15, na:290 })],
  ['Appam (Rice Hopper)',            'अप्पम',          'Appam',               'grain', n({ cal:145, pro:3.0, carb:29.5, fat:2.0, fiber:0.8, ca:18, fe:0.8, na:210, gi:65, probiotic:true })],
  ['Puttu',                          'पुट्टू',         'Puttu',               'grain', n({ cal:228, pro:4.8, carb:45.5, fat:3.2, fiber:2.0, ca:20, fe:1.5, na:220 })],
  ['Kerala Parotta',                 'परोटा',          'Parotta',             'grain', n({ cal:310, pro:7.0, carb:52.0, fat:8.5, fiber:1.5, ca:25, fe:2.0, na:350 })],
  ['Pesarattu (Green Moong Dosa)',   'पेसरट्टू',       'Pesarattu',           'grain', n({ cal:148, pro:8.0, carb:24.0, fat:2.5, fiber:3.0, ca:35, fe:2.0, na:255, gi:35 })],
  ['Bisibelebath',                   'बिसी बेले भात',  'Bisibelebath',        'grain', n({ cal:165, pro:6.0, carb:29.5, fat:3.5, fiber:2.5, ca:40, fe:2.0, mg:45, na:390 })],

  // ════════════════════════════════════════════════════
  // NORTH INDIAN REGIONAL FOODS
  // ════════════════════════════════════════════════════
  ['Makki Ki Roti',                  'मक्के की रोटी',  'Makki Roti',          'grain', n({ cal:305, pro:7.5, carb:62.5, fat:3.5, fiber:5.0, ca:22, fe:2.5, mg:65, na:200, gi:60 })],
  ['Sarson Ka Saag',                 'सरसों का साग',   'Sarson Saag',         'vegetable', n({ cal:58, pro:3.5, carb:7.5, fat:2.0, fiber:4.0, ca:145, fe:2.5, vit_a:365, vit_c:65, na:380 })],
  ['Rajasthani Dal Baati',           'दाल बाटी',       'Dal Baati',           'grain', n({ cal:290, pro:9.0, carb:42.5, fat:9.5, fiber:3.0, ca:55, fe:3.5, na:480 })],
  ['Kadhi (Yogurt Curry)',           'कढ़ी',           'Kadhi',               'dairy', n({ cal:85,  pro:3.0, carb:9.5, fat:4.0, fiber:0.5, ca:90, fe:0.5, na:390, probiotic:false })],
  ['Besan Chilla',                   'बेसन चिल्ला',    'Besan Chilla',        'grain', n({ cal:185, pro:8.5, carb:24.0, fat:6.5, fiber:3.5, ca:55, fe:3.0, mg:50, na:350, gi:35 })],
  ['Aloo Paratha',                   'आलू पराठा',      'Aloo Paratha',        'grain', n({ cal:327, pro:7.0, carb:53.5, fat:9.5, fiber:2.5, ca:40, fe:3.0, na:425 })],
  ['Gobi Paratha',                   'गोभी पराठा',     'Gobi Paratha',        'grain', n({ cal:318, pro:7.5, carb:51.5, fat:9.5, fiber:3.0, ca:45, fe:3.0, na:415 })],
  ['Chole Bhature',                  'छोले भटूरे',     'Chole Bhature',       'grain', n({ cal:295, pro:9.5, carb:44.0, fat:9.5, fiber:5.0, ca:75, fe:4.0, na:520 })],
  ['Kadhi Pakora',                   'कढ़ी पकोड़ा',    'Kadhi Pakora',        'other', n({ cal:108, pro:4.5, carb:12.5, fat:4.5, fiber:1.0, ca:110, fe:1.0, na:480 })],
  ['Dum Aloo (Kashmiri)',            'दम आलू',         'Dum Aloo',            'other', n({ cal:140, pro:2.5, carb:19.5, fat:6.0, fiber:2.5, ca:35, fe:1.0, na:420 })],

  // ════════════════════════════════════════════════════
  // BENGALI / EAST INDIAN
  // ════════════════════════════════════════════════════
  ['Hilsa Curry (Shorshe Ilish)',    'सरसों हिल्सा',   'Shorshe Ilish',       'other', n({ cal:240, pro:18.0, carb:5.0, fat:17.0, fiber:1.0, ca:55, fe:1.5, na:450, omega3_epa:600, omega3_dha:1000 })],
  ['Macher Jhol (Fish Curry)',       'माछेर झोल',      'Macher Jhol',         'other', n({ cal:145, pro:14.0, carb:5.5, fat:7.5, fiber:1.5, ca:95, fe:1.5, na:410 })],
  ['Mishti Doi (Sweet Curd)',        'मिष्टी दोई',     'Mishti Doi',          'dairy', n({ cal:110, pro:3.5, carb:18.0, fat:2.5, fiber:0, ca:115, na:55, gi:50 })],
  ['Sondesh',                        'संदेश',          'Sondesh',             'other', n({ cal:280, pro:8.0, carb:40.0, fat:10.0, fiber:0, ca:280, na:85 })],
  ['Luchi',                          'लुची',           'Luchi',               'grain', n({ cal:375, pro:7.5, carb:44.0, fat:18.5, fiber:0.8, ca:20, fe:1.5, na:250 })],

  // ════════════════════════════════════════════════════
  // GUJRATI / WESTERN INDIAN
  // ════════════════════════════════════════════════════
  ['Thepla',                         'थेपला',          'Thepla',              'grain', n({ cal:292, pro:9.5, carb:44.5, fat:8.5, fiber:4.5, ca:60, fe:4.0, na:380, gi:55 })],
  ['Handvo',                         'हांडवो',         'Handvo',              'grain', n({ cal:185, pro:8.5, carb:28.5, fat:5.0, fiber:4.0, ca:75, fe:2.5, na:420, probiotic:true })],
  ['Khaman Dhokla',                  'खमन ढोकला',      'Khaman',              'grain', n({ cal:162, pro:7.2, carb:28.5, fat:3.2, fiber:1.5, ca:55, fe:1.8, na:390, probiotic:true })],
  ['Undhiyu',                        'उंधियू',         'Undhiyu',             'other', n({ cal:145, pro:4.5, carb:18.5, fat:6.0, fiber:5.0, ca:70, fe:2.0, na:380 })],
  ['Fafda',                          'फाफड़ा',          'Fafda',               'grain', n({ cal:430, pro:12.5, carb:55.0, fat:17.5, fiber:3.0, ca:45, na:650 })],

  // ════════════════════════════════════════════════════
  // DRINKS / JUICES (for tracking)
  // ════════════════════════════════════════════════════
  ['Orange Juice (Fresh)',           'संतरे का जूस',   'Orange Juice',        'fruit', n({ cal:45,  pro:0.7, carb:10.4, fat:0.2, fiber:0.2, sugar:8.4, ca:11, fe:0.2, vit_c:50.0, folate:30, gi:52 })],
  ['Mango Juice (Fresh)',            'आम का जूस',      'Mango Juice',         'fruit', n({ cal:60,  pro:0.5, carb:15.0, fat:0.2, fiber:0.3, sugar:13.5, ca:10, vit_a:50, vit_c:28, gi:55 })],
  ['Pomegranate Juice',              'अनार का रस',     'Anar Juice',          'fruit', n({ cal:83,  pro:1.5, carb:18.5, fat:0.3, fiber:0.1, sugar:12.6, ca:11, fe:0.3, k:214, vit_c:10, gi:53 })],
  ['Watermelon Juice',               'तरबूज का जूस',   'Watermelon Juice',    'fruit', n({ cal:25,  pro:0.5, carb:6.2, fat:0.1, fiber:0.1, sugar:5.5, ca:5, vit_c:8, lycopene:4500, gi:72 })],
  ['Sugarcane Juice (Fresh)',        'गन्ने का रस',    'Ganna Juice',         'other', n({ cal:56,  pro:0.3, carb:14.0, fat:0.1, fiber:0, sugar:13.8, ca:10, fe:0.2, mg:13, k:162, na:3, gi:43 })],
  ['Amla Juice (Fresh)',             'आंवला जूस',      'Amla Juice',          'fruit', n({ cal:25,  pro:0.5, carb:6.0, fat:0.1, fiber:0.5, ca:20, fe:0.5, vit_c:450, gi:15 })],
  ['Buttermilk (Thin Chaas)',        'पतली छाछ',       'Thin Chaas',          'dairy', n({ cal:20,  pro:1.5, carb:2.2, fat:0.4, fiber:0, ca:55, na:185, probiotic:true })],
  ['Turmeric Tea (Anti-Inflam.)',    'हल्दी चाय',      'Turmeric Tea',        'other', n({ cal:5,   pro:0.2, carb:1.0, fat:0.1, fiber:0.3, ca:5, na:3, gi:0 })],
  ['Ginger Tea (Adrak Chai)',        'अदरक चाय',       'Ginger Tea',          'other', n({ cal:8,   pro:0.2, carb:1.8, fat:0.1, fiber:0.2, ca:3, na:2 })],
  ['Jeera Water',                    'जीरा पानी',      'Cumin Water',         'other', n({ cal:3,   pro:0.1, carb:0.5, fat:0.0, fiber:0.1, ca:2, na:0 })],

  // ════════════════════════════════════════════════════
  // ADDITIONAL SUPPLEMENTS
  // ════════════════════════════════════════════════════
  ['Flaxseed Oil Capsule (1g)',      'अलसी तेल कैप्सूल','Flaxseed Oil Capsule','supplement', n({ cal:9, pro:0, carb:0, fat:1.0, fiber:0, ala:533, omega6:133, na:0 })],
  ['Omega-3 Fish Oil (1g capsule)', 'ओमेगा-3 फिश ऑयल','Fish Oil Capsule',    'supplement', n({ cal:9, pro:0, carb:0, fat:1.0, fiber:0, omega3_epa:180, omega3_dha:120, na:0 })],
  ['Curcumin Supplement (500mg)',    'कर्क्यूमिन',     'Curcumin',            'supplement', n({ cal:0, pro:0, carb:0, fat:0, fiber:0, na:0 })],
  ['Magnesium Glycinate (400mg)',    'मैग्नीशियम',     'Magnesium',           'supplement', n({ cal:0, pro:0, carb:0, fat:0, fiber:0, mg:400, na:0 })],
  ['Zinc Supplement (25mg)',         'जिंक सप्लीमेंट', 'Zinc',                'supplement', n({ cal:0, pro:0, carb:0, fat:0, fiber:0, zn:25, na:0 })],
  ['Iron Supplement (60mg)',         'आयरन सप्लीमेंट', 'Iron Supplement',     'supplement', n({ cal:0, pro:0, carb:0, fat:0, fiber:0, fe:60, vit_c:30, na:0 })],
  ['Probiotics (1 capsule)',         'प्रोबायोटिक',    'Probiotic Capsule',   'supplement', n({ cal:5, pro:0.5, carb:0.5, fat:0, fiber:0, na:0, probiotic:true })],
  ['Collagen Peptides (10g)',        'कोलेजन',         'Collagen',            'supplement', n({ cal:35, pro:9.0, carb:0, fat:0, fiber:0, na:35 })],
  ['Ashwagandha (600mg capsule)',    'अश्वगंधा कैप्सूल','Ashwagandha Cap',    'supplement', n({ cal:2, pro:0, carb:0.4, fat:0, fiber:0, na:0 })],
  ['Triphala Churna (per 5g)',       'त्रिफला चूर्ण',  'Triphala',            'supplement', n({ cal:18, pro:0.5, carb:4.5, fat:0.1, fiber:2.5, ca:30, fe:0.5, vit_c:20, na:1 })],

  // ════════════════════════════════════════════════════
  // FERMENTED / PROBIOTIC FOODS
  // ════════════════════════════════════════════════════
  ['Kefir',                          'केफिर',          'Kefir',               'dairy', n({ cal:61,  pro:3.8, carb:4.5, fat:3.3, fiber:0, b12:0.34, ca:120, na:40, probiotic:true })],
  ['Kombucha',                       'कोम्बुचा',       'Kombucha',            'other', n({ cal:9,   pro:0.1, carb:2.2, fat:0, fiber:0, ca:4, na:8, probiotic:true })],
  ['Natto (Fermented Soybean)',      'नाटो',           'Natto',               'other', n({ cal:211, pro:17.7, carb:14.4, fat:11.0, fiber:5.4, b1:0.27, b2:0.23, b3:0.7, b12:0, ca:217, fe:8.6, mg:103, p:174, k:729, na:2, vit_k:1000, probiotic:true })],
  ['Kanji (Fermented, Traditional)', 'काँजी पेय',      'Traditional Kanji',   'other', n({ cal:18,  pro:0.6, carb:4.0, fat:0.1, fiber:0.3, ca:8, fe:0.5, na:120, probiotic:true })],
  ['Ambali (Ragi Fermented)',        'अंबली',          'Ambali',              'grain', n({ cal:72,  pro:2.2, carb:15.5, fat:0.3, fiber:1.5, ca:70, fe:1.0, na:80, probiotic:true })],
  ['Idli (Brown Rice)',              'ब्राउन राइस इडली','Brown Rice Idli',    'grain', n({ cal:120, pro:4.0, carb:24.5, fat:0.5, fiber:1.5, ca:28, fe:1.8, na:200, probiotic:true })],

  // ════════════════════════════════════════════════════
  // FINAL BATCH — EXTRA FOODS
  // ════════════════════════════════════════════════════
  ['Mango (Alphonso, Ripe)',         'अल्फांसो आम',    'Hapus',               'fruit', n({ cal:74,  pro:0.8, carb:17.5, fat:0.5, fiber:1.8, sugar:15.8, ca:14, fe:0.3, vit_a:89, vit_c:41, gi:51 })],
  ['Sugarcane (Raw)',                'गन्ना',          'Sugarcane',           'other', n({ cal:40,  pro:0.2, carb:10.0, fat:0.1, fiber:0.2, ca:11, fe:0.2, mg:9, k:140, na:2 })],
  ['Kokum (Dried)',                  'कोकम',           'Kodampuli',           'other', n({ cal:102, pro:1.2, carb:25.0, fat:0.6, fiber:6.0, ca:25, fe:1.5, vit_c:5 })],
  ['Drumstick Flower',               'सहजन का फूल',   'Murungai Poo',        'vegetable', n({ cal:70, pro:6.7, carb:11.5, fat:0.6, fiber:1.0, ca:144, fe:1.8, vit_c:22 })],
  ['Moringa Pods (Raw)',              'सहजन फली',      'Murungakkai',         'vegetable', n({ cal:37, pro:2.1, carb:8.5, fat:0.2, fiber:3.2, ca:30, fe:0.5, vit_c:141, k:461 })],
  ['Lotus Seeds (Raw)',              'ताजे मखाना',     'Thamarai Virai',      'nut', n({ cal:89,  pro:4.1, carb:17.3, fat:0.5, fiber:1.2, ca:44, fe:2.7, mg:56, p:168, k:367, na:1 })],
  ['Water Chestnut (Singhara)',      'सिंघाड़ा',       'Singhara',            'other', n({ cal:97,  pro:2.0, carb:23.0, fat:0.1, fiber:3.0, ca:11, fe:0.5, vit_b6:0.3, k:584, na:14 })],
  ['Jack Fruit Chips',               'कटहल के चिप्स', 'Jackfruit Chips',     'branded', n({ cal:506, pro:3.0, carb:72.0, fat:23.0, fiber:5.0, ca:15, na:380 })],
  ['Banana Stem (Vazhaithandu)',     'केले का तना',    'Vazhaithandu',        'vegetable', n({ cal:31,  pro:0.9, carb:7.3, fat:0.0, fiber:5.7, ca:28, fe:0.7, mg:25, p:15, k:365, na:24, vit_c:5 })],
  ['Raw Mango (Green)',              'कच्चा आम',       'Raw Mango',           'fruit', n({ cal:60,  pro:0.7, carb:14.8, fat:0.4, fiber:1.6, ca:10, fe:0.1, vit_c:46.4, gi:30 })],
  ['Gondhoraj Lemon',                'गंधराज नींबू',   'Gondhoraj',           'fruit', n({ cal:30,  pro:1.1, carb:9.5, fat:0.3, fiber:3.0, ca:28, fe:0.7, vit_c:55, na:2 })],
  ['Star Fruit (Kamrakh)',           'कमरख',           'Thambaratham',        'fruit', n({ cal:31,  pro:1.0, carb:6.7, fat:0.3, fiber:2.8, sugar:3.9, ca:3, fe:0.1, vit_c:34.4 })],
  ['Bael Fruit (Wood Apple)',        'बेल',            'Vilvam',              'fruit', n({ cal:137, pro:1.8, carb:31.8, fat:0.3, fiber:2.9, ca:85, fe:0.6, vit_c:8, gi:45 })],
  ['Phalsa Berry',                   'फालसा',          'Falsa',               'fruit', n({ cal:67,  pro:1.4, carb:14.7, fat:0.7, fiber:4.5, ca:129, fe:4.1, vit_c:10 })],
  ['Karonda (Carissa Berries)',      'करोंदा',         'Kalaka',              'fruit', n({ cal:42,  pro:0.5, carb:10.0, fat:0.5, fiber:2.5, ca:30, fe:39.1, vit_c:9 })],
  ['Tendu Fruit (Kendu)',            'तेंदू',          'Tendu',               'fruit', n({ cal:70,  pro:0.8, carb:16.8, fat:0.3, fiber:3.5, ca:35, fe:0.8 })],
  ['Mahua Flower (Dried)',           'महुआ',           'Mahua',               'other', n({ cal:339, pro:1.2, carb:83.4, fat:0.7, fiber:2.4, ca:200, fe:2.2 })],
  ['Chironji (Charoli)',             'चिरौंजी',        'Charoli',             'nut', n({ cal:539, pro:14.5, carb:24.5, fat:44.5, fiber:8.5, ca:79, fe:7.5, mg:100, na:3 })],
  ['Phool Makhana (Fried in Ghee)', 'भुना मखाना (घी)','Fried Makhana',       'nut', n({ cal:398, pro:9.7, carb:81.0, fat:4.5, fiber:14.5, ca:60, fe:1.4, na:5, gi:38 })],


  // ════════════════════════════════════════════════════
  // SUPPLEMENTS (PADMINI-SPECIFIC) + EXTRAS
  // ════════════════════════════════════════════════════
  ['Vitamin B12 Injection (1000mcg)','विटामिन B12 इंजेक्शन','B12 Injection',   'supplement', n({ cal:0, pro:0, carb:0, fat:0, fiber:0, b12:1000, na:0 })],
  ['Vitamin D3 60000 IU (Weekly)',   'विटामिन D3 60000 IU','D3 60000 IU',      'supplement', n({ cal:0, pro:0, carb:0, fat:0, fiber:0, vit_d:60000, na:0 })],
  ['Fish Oil (Muscleze Gold, 1g)',   'मस्कलज फिश ऑयल','Muscleze Fish Oil','supplement', n({ cal:9, pro:0, carb:0, fat:1.0, fiber:0, omega3_epa:180, omega3_dha:120, na:0 })],
  ['Multivitamin (22 Nutrients)',    'मल्टीविटामिन',     'Multivitamin',       'supplement', n({ cal:5, pro:0, carb:1.0, fat:0, fiber:0, vit_a:900, vit_c:90, vit_d:600, vit_e:15, vit_k:120, b1:1.2, b2:1.3, b3:16, b6:1.7, b12:2.4, folate:400, biotin:30, b5:5, ca:200, fe:8, mg:100, zn:8, se:55, cu:0.9, mn:2.3, na:10 })],
  ['Electrolyte Powder (Sugar-Free)','इलेक्ट्रोलाइट पाउडर','Electrolyte',    'supplement', n({ cal:10, pro:0, carb:2.5, fat:0, fiber:0, na:460, k:200, mg:24, ca:20 })],
  ['Flaxseed Oil (1 tsp / 5ml)',    'अलसी का तेल (1 चम्मच)','Flaxseed Oil Tsp','supplement', n({ cal:44, pro:0, carb:0, fat:5.0, fiber:0, ala:2665, omega6:635, na:0 })],
  ['Tofu (Firm)',                    'फर्म टोफू',        'Firm Tofu',          'other',      n({ cal:76,  pro:8.1,  carb:1.9,  fat:4.8, fiber:0.3, ca:350, fe:5.4, mg:30, p:97,  k:121, na:7,   gi:15 })],
  ['Soy Chunks (Textured Protein)',  'सोया चंक्स',       'Soya Chunks',        'other',      n({ cal:336, pro:52.4, carb:33.0, fat:0.5, fiber:13.0, ca:350, fe:20.0, mg:150, p:700, na:24 })],
  ['Oatmeal (Cooked, Water)',        'पके ओट्स',         'Oat Porridge',       'grain',      n({ cal:71,  pro:2.5,  carb:12.0, fat:1.4, fiber:1.7, ca:10, fe:0.9, mg:26, na:49, gi:55, beta_glucan:0.8 })],
  ['Psyllium Husk (Isabgol, 5g)',   'इसबगोल',           'Isabgol 5g',         'supplement', n({ cal:10, pro:0.1, carb:4.25, fat:0.02, fiber:4.0, na:0.5, prebiotic:2.5 })],
  ['Moringa Powder (per 5g)',        'सहजन पाउडर',       'Moringa 5g',         'supplement', n({ cal:10, pro:1.4, carb:1.9, fat:0.1, fiber:1.0, ca:100, fe:1.4, vit_a:57, vit_c:0.9, na:0.5 })],
  ['Soy Milk (Fortified)',           'फोर्टिफाइड सोया मिल्क','Fortified Soy Milk','dairy',  n({ cal:54,  pro:3.3,  carb:6.3, fat:1.8, fiber:0.4, ca:299, vit_d:119, b12:2.07, na:51 })],
  ['Kefir (Plain)',                  'केफिर',            'Plain Kefir',        'dairy',      n({ cal:61,  pro:3.8,  carb:4.5, fat:3.3, fiber:0, b12:0.34, ca:120, na:40, probiotic:true })],
  ['Coconut Water (Fresh)',          'ताजा नारियल पानी', 'Fresh Coconut Water','fruit',      n({ cal:19,  pro:0.7,  carb:3.7, fat:0.2, fiber:1.1, ca:24, mg:25, k:250, na:105, vit_c:2.4, gi:3 })],
  ['Tender Coconut Malai',          'नारियल मलाई',      'Coconut Malai',      'fruit',      n({ cal:180, pro:1.8,  carb:8.0, fat:16.5, fiber:3.5, ca:10, fe:1.0, mg:15, na:15, sat_fat:14.5 })],
  ['Miso Paste (Soybean)',          'मिसो',             'Miso Paste',         'other',      n({ cal:199, pro:11.7, carb:26.5, fat:6.0, fiber:5.4, ca:57, fe:2.5, mg:48, na:3728 })],
  ['Kombucha (Plain)',              'कोम्बुचा',          'Kombucha',           'other',      n({ cal:9,   pro:0.1,  carb:2.2, fat:0, fiber:0, ca:4, na:8, probiotic:true })],
  ['Ambali (Fermented Ragi)',       'अंबली',             'Ambali Drink',       'grain',      n({ cal:72,  pro:2.2,  carb:15.5, fat:0.3, fiber:1.5, ca:70, fe:1.0, na:80, probiotic:true })],
  ['Water Chestnut (Singhara)',     'सिंघाड़ा',          'Singhara',           'other',      n({ cal:97,  pro:2.0,  carb:23.0, fat:0.1, fiber:3.0, ca:11, fe:0.5, k:584, na:14 })],
  ['Gondh (Edible Gum)',            'गोंद',              'Edible Gum',         'other',      n({ cal:345, pro:0.5,  carb:84.0, fat:0.5, fiber:8.0, ca:50, fe:2.0, na:5 })],
  ['Kokum (Dried)',                 'कोकम',              'Kokum',              'other',      n({ cal:102, pro:1.2,  carb:25.0, fat:0.6, fiber:6.0, ca:25, fe:1.5, vit_c:5 })],
  ['Raw Mango (Kairi, Green)',      'कच्चा आम (कैरी)',  'Raw Mango',          'fruit',      n({ cal:60,  pro:0.7,  carb:14.8, fat:0.4, fiber:1.6, ca:10, fe:0.1, vit_c:46.4, gi:30 })],
  ['Amla Candy (Murabba)',          'आंवला मुरब्बा',    'Amla Murabba',       'other',      n({ cal:247, pro:0.5,  carb:62.0, fat:0.2, fiber:3.0, ca:40, fe:0.6, vit_c:120, na:30 })],
  ['Wheat Germ (2 tbsp)',           'गेहूं का कीटाणु', 'Wheat Germ',         'grain',      n({ cal:76,  pro:4.6,  carb:10.4, fat:1.9, fiber:2.6, b1:0.38, b2:0.10, b3:1.4, ca:8, fe:1.3, mg:48, p:168, k:178, na:2, vit_e:3.0, folate:56, zn:2.5 })],
  ['Chironji Nuts (Charoli Seeds)', 'चिरौंजी के बीज',  'Charoli',            'nut',        n({ cal:539, pro:14.5, carb:24.5, fat:44.5, fiber:8.5, ca:79, fe:7.5, mg:100, na:3 })],
  ['Banana Stem (Vazhaithandu)',    'केले का तना',      'Banana Stem',        'vegetable',  n({ cal:31,  pro:0.9,  carb:7.3, fat:0.0, fiber:5.7, ca:28, fe:0.7, mg:25, p:15, k:365, na:24, vit_c:5 })],
  ['Suva Bhaji (Dill Leaves)',      'सोआ की पत्तियाँ', 'Soa Keerai',         'vegetable',  n({ cal:43,  pro:3.5,  carb:7.0, fat:1.1, fiber:2.1, ca:208, fe:6.6, vit_a:386, vit_c:85, na:61 })],
  ['Bathua Saag (Pigweed)',         'बथुआ',             'Bathua',             'vegetable',  n({ cal:30,  pro:3.7,  carb:4.2, fat:0.4, fiber:0.9, ca:150, fe:4.2, vit_a:306, vit_c:35, na:7 })],
  ['Lal Saag (Red Amaranth)',       'लाल शाक',          'Lal Saag',           'vegetable',  n({ cal:42,  pro:3.9,  carb:6.0, fat:0.4, fiber:2.3, ca:397, fe:16.6, vit_a:285, vit_c:99, na:20 })],
  ['Ambat Chukka (Sorrel Greens)',  'खट्टी चुक्का',    'Gongura',            'vegetable',  n({ cal:26,  pro:2.3,  carb:5.3, fat:0.3, fiber:1.2, ca:95, fe:4.3, vit_a:131, vit_c:48, na:12 })],
  ['Kantola (Spine Gourd)',         'कंटोला',           'Spiny Gourd',        'vegetable',  n({ cal:17,  pro:1.5,  carb:3.3, fat:0.1, fiber:1.5, ca:12, fe:0.9, vit_c:11, na:5 })],
  ['Kokum Sharbat',                 'कोकम शर्बत',       'Kokum Sharbat',      'other',      n({ cal:62,  pro:0.2,  carb:15.5, fat:0.1, fiber:0.3, ca:8, fe:0.3, vit_c:3, na:15 })],
  ['Nolen Gur (Date Palm Jaggery)', 'नोलेन गुड़',       'Nolen Gur',          'other',      n({ cal:350, pro:0.5,  carb:90.0, fat:0.0, fiber:0, sugar:85.0, ca:50, fe:1.5, mg:40, k:400, na:15, gi:55 })],
  ['Stevia (Natural Sweetener)',    'स्टेविया',          'Stevia',             'other',      n({ cal:3,   pro:0.1,  carb:0.9, fat:0, fiber:0.3, na:0, gi:0, gl:0 })],
  ['Sabudana Papad',                'साबूदाना पापड़',   'Sabudana Papad',     'grain',      n({ cal:382, pro:0.5,  carb:93.5, fat:0.2, fiber:0.3, ca:12, fe:1.0, na:350 })],
  ['Rice Papad (Appalam)',          'चावल का पापड़',    'Appalam',            'grain',      n({ cal:360, pro:10.0, carb:72.0, fat:2.5, fiber:1.5, ca:35, na:3500 })],
  ['Peri-Peri Masala Mix',          'पेरी-पेरी मसाला', 'Peri Peri Mix',      'other',      n({ cal:145, pro:3.5,  carb:25.0, fat:4.0, fiber:5.0, ca:90, fe:3.5, na:2800 })],
  ['Chat Masala (per 5g)',          'चाट मसाला',        'Chaat Masala',       'other',      n({ cal:15,  pro:0.4,  carb:3.0, fat:0.5, fiber:0.8, ca:22, fe:1.0, na:2200 })],
  ['Garam Masala (per 5g)',         'गरम मसाला',        'Garam Masala',       'other',      n({ cal:17,  pro:0.5,  carb:3.0, fat:0.7, fiber:1.2, ca:50, fe:1.5, na:10 })],
  ['Saunf (Fennel Seeds)',          'सौंफ',             'Sombu',              'other',      n({ cal:345, pro:15.8, carb:52.3, fat:14.9, fiber:39.8, ca:1196, fe:18.5, mg:385, k:1694, na:88 })],
  ['Ajwain (Carom Seeds)',          'अजवाइन',           'Omam',               'other',      n({ cal:305, pro:17.1, carb:43.0, fat:25.0, fiber:21.2, ca:667, fe:16.5, mg:258, na:10 })],
  ['Kalonji (Nigella Seeds)',       'कलौंजी',           'Karun Jeeragam',     'other',      n({ cal:333, pro:17.8, carb:44.2, fat:22.3, fiber:10.5, ca:931, fe:66.4, mg:366, na:168 })],
  ['Jeera Water (per glass)',       'जीरा पानी',        'Jeera Water',        'other',      n({ cal:3,   pro:0.1,  carb:0.5, fat:0, fiber:0.1, ca:2, na:0 })],
  ['Ginger Lemon Tea',              'अदरक नींबू चाय',  'Ginger Lemon Tea',   'other',      n({ cal:12,  pro:0.2,  carb:3.0, fat:0.1, fiber:0.3, ca:5, vit_c:8, na:2 })],
  ['Turmeric Latte (Haldi Doodh)',  'हल्दी लट्टे',      'Golden Latte',       'dairy',      n({ cal:70,  pro:3.0,  carb:7.5, fat:3.2, fiber:0.3, ca:110, fe:0.2, na:50 })],
  ['Overnight Oats (with Milk)',    'ओवरनाइट ओट्स (दूध)','Oats with Milk',   'grain',      n({ cal:160, pro:7.0,  carb:26.0, fat:3.5, fiber:3.5, ca:145, fe:1.5, mg:55, na:80, gi:50, probiotic:false })],
  ['Paneer Bhurji (Low Oil)',       'पनीर भुर्जी',      'Low Oil Paneer Bhurji','other',    n({ cal:180, pro:12.5, carb:4.5, fat:13.0, fiber:0.5, ca:290, fe:0.4, na:310 })],
  ['Dal Khichdi (Toor + Rice)',     'तुअर दाल खिचड़ी', 'Toor Dal Khichdi',   'grain',      n({ cal:118, pro:5.0,  carb:22.0, fat:1.5, fiber:1.5, ca:22, fe:1.5, mg:40, na:290, gi:45 })],
  ['Sprouts Salad (Raw Mixed)',     'अंकुरित सलाद',     'Mixed Sprout Salad', 'grain',      n({ cal:80,  pro:6.5,  carb:13.5, fat:0.5, fiber:4.0, ca:42, fe:1.8, vit_c:15, na:95 })],
  ['Vegetable Raita',               'सब्जी रायता',      'Veg Raita',          'dairy',      n({ cal:55,  pro:2.8,  carb:6.0, fat:2.5, fiber:0.8, ca:105, na:190, probiotic:true })],
  ['Curd Rice (Thayir Sadam)',      'थायिर सादम',       'Thayir Sadam',       'grain',      n({ cal:138, pro:3.8,  carb:22.5, fat:4.0, fiber:0.5, ca:80, fe:0.3, na:250, probiotic:true, gi:60 })],
  ['Green Smoothie (Spinach+Banana)','ग्रीन स्मूदी',   'Green Smoothie',     'other',      n({ cal:80,  pro:1.8,  carb:18.5, fat:0.5, fiber:2.5, ca:65, fe:1.2, vit_a:200, vit_c:20, k:400, na:50 })],
  ['Protein Smoothie (Whey+Milk)',  'प्रोटीन स्मूदी',  'Protein Smoothie',   'other',      n({ cal:165, pro:18.0, carb:14.0, fat:3.5, fiber:0.5, ca:230, na:185, b12:0.9 })],
  ['Aam Panna (Raw Mango Drink)',   'आम पना',           'Aam Panna',          'other',      n({ cal:55,  pro:0.5,  carb:13.8, fat:0.2, fiber:0.8, ca:8, fe:0.2, vit_c:12, na:8 })],

  ['Mango (Totapuri, Raw)',          'तोतापुरी आम',      'Totapuri Mango',     'fruit',      n({ cal:52,  pro:0.7,  carb:13.0, fat:0.3, fiber:1.5, sugar:11.5, ca:10, fe:0.1, vit_c:28, gi:51 })],
  ['Grapes (Black)',                 'काले अंगूर',       'Black Grapes',       'fruit',      n({ cal:67,  pro:0.6,  carb:17.2, fat:0.4, fiber:0.9, sugar:14.2, ca:10, fe:0.4, mg:7,  k:191, na:2, vit_c:4.0, gi:46 })],
  ['Sapodilla (Chikoo/Sapota)',      'चीकू',             'Sapota',             'fruit',      n({ cal:83,  pro:0.4,  carb:19.9, fat:1.1, fiber:5.3, sugar:14.7, ca:21, fe:0.8, mg:12, k:193, na:12, vit_c:14.7 })],
  ['Mulberry (Shahtoot)',            'शहतूत',            'Shahtoot',           'fruit',      n({ cal:43,  pro:1.4,  carb:9.8,  fat:0.4, fiber:1.7, sugar:8.1,  ca:39, fe:1.9, mg:18, k:194, na:10, vit_c:36.4 })],
  ['Palmyra Palm Fruit (Nungu)',     'ताड़ का फल',       'Nungu',              'fruit',      n({ cal:43,  pro:0.8,  carb:10.9, fat:0.1, fiber:1.0, sugar:9.0,  ca:27, fe:1.0, mg:30, k:212, na:1,  vit_c:5 })],
  ['Carambola (Star Fruit)',         'करमल / स्टार फ्रूट','Thambaratham',      'fruit',      n({ cal:31,  pro:1.0,  carb:6.7,  fat:0.3, fiber:2.8, sugar:3.9,  ca:3,  fe:0.1, vit_c:34.4, gi:25 })],
  ['Phalsa Berry (Indian Berry)',    'फालसा',            'Falsa',              'fruit',      n({ cal:67,  pro:1.4,  carb:14.7, fat:0.7, fiber:4.5, ca:129, fe:4.1, vit_c:10 })],
  ['Sugarcane Juice (Raw, 200ml)',   'गन्ने का रस (200ml)','Ganna Juice 200ml','other',      n({ cal:112, pro:0.6,  carb:28.0, fat:0.2, fiber:0, sugar:27.6, ca:20, fe:0.4, mg:26, k:324, na:6, gi:43 })],
  ['Jaggery Syrup (Gur Sharbat)',   'गुड़ शरबत',        'Gur Sharbat',        'other',      n({ cal:82,  pro:0.1,  carb:21.0, fat:0, fiber:0, sugar:20.8, ca:20, fe:0.6, mg:20, k:264, na:8, gi:65 })],
  ['Bael Sharbat (Wood Apple)',      'बेल का शरबत',      'Bael Juice',         'other',      n({ cal:56,  pro:0.7,  carb:13.5, fat:0.1, fiber:1.2, ca:34, fe:0.3, vit_c:4, gi:45 })],
  ['Pickle (Mixed Veg, Oil-based)',  'मिक्स अचार',       'Mixed Achar',        'other',      n({ cal:155, pro:1.2,  carb:11.5, fat:13.0, fiber:3.0, ca:30, fe:1.2, na:2500 })],
  ['Urad Dal Vada',                  'उड़द दाल वड़ा',    'Medu Vada',          'grain',      n({ cal:215, pro:7.5,  carb:22.5, fat:11.0, fiber:1.5, ca:55, fe:2.5, mg:50, na:400, gi:40 })],


];

// ─────────────────────────────────────────────────────────────────────────────
// SEED FUNCTION
// ─────────────────────────────────────────────────────────────────────────────
async function seed() {
  const client = await pool.connect();
  let inserted = 0;
  let skipped  = 0;

  console.log(`\n🌱 NIN India seed starting — ${FOODS.length} foods to process…\n`);

  try {
    await client.query('BEGIN');

    for (const [name, name_hindi, name_local, category, per_100g] of FOODS) {
      try {
        const result = await client.query(
          `INSERT INTO foods (name, name_hindi, name_local, category, source, verified, per_100g)
           VALUES ($1, $2, $3, $4, 'nin', true, $5)
           ON CONFLICT (lower(name), source) DO NOTHING
           RETURNING id`,
          [name, name_hindi, name_local, category, JSON.stringify(per_100g)]
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
    console.log(`   Total in DB after seed: ${inserted + skipped} NIN foods processed\n`);
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
