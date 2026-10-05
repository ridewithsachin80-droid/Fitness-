/**
 * services/safety.js — messages the member chat must NOT treat as a log.
 *
 * Checked BEFORE the AI sees the message. A member who types "chest pain
 * after my run" must get "call 112" in fixed, tested words, not whatever the
 * model writes, and not a food log. The AI prompts carry the same rules as a
 * second line of defence for wording these patterns miss.
 *
 * Six kinds, checked in this order (the most urgent first):
 *   self_harm   thoughts of suicide or self-harm
 *   emergency   chest pain or tightness, can't breathe, fainted
 *   eating      making oneself sick, laxatives or starving to lose weight
 *   medicine    stopping, skipping or changing a medicine or its dose
 *   low_kcal    planning to eat very little (under 1,000 kcal a day) or not
 *               eat for days
 *   pregnancy   the member says they are pregnant or breastfeeding
 *
 * English, Hinglish and a few common Kannada phrasings. Deliberately narrow:
 * "killer workout", "chest day", "took my thyronorm" and "800 kcal left" are
 * ordinary messages and must stay ordinary (test-safety.js holds both lists).
 *
 * Nothing is sent to the coach automatically. The replies for medicine,
 * low_kcal and pregnancy tell the member how to tell their coach, and a
 * message addressed to the coach ("tell my coach I'm pregnant") is NOT
 * intercepted for those three, so it reaches the coach as before. The two
 * urgent kinds are always answered, whoever the message is addressed to.
 *
 * Helplines checked 4 Oct 2026: Tele-MANAS (Government of India, free, 24x7,
 * many languages) 14416 or 1-800-891-4416; emergency 112; ambulance 108.
 */

const MED = String.raw`(?:medicines?|medications?|meds|tablets?|pills?|insulin(?!\s*(?:resist|sensitiv))|metformin|glycomet|thyronorm|thyroxine|eltroxin|levothyroxine|statins?|atorvastatin|rosuvastatin|telma|telmisartan|amlodipine|dawai|dawa|goli|maatre|mathre|dose|dosage)`;
const ME = String.raw`(?:my\s*self|myself)`;

const RULES = [
  { kind: 'self_harm', urgent: true, res: [
    new RegExp(String.raw`\b(?:kill|hurt|harm|cut|cutting|hurting|harming|killing)\s+${ME}\b`, 'i'),
    /\bsuicid/i,
    /\bself[\s-]?harm/i,
    /\b(?:want|wanna|going)\s+to\s+die\b/i,
    /\bwish\s+i\s+(?:was|were)\s+dead\b/i,
    /\bbetter\s+off\s+dead\b/i,
    /\bend\s+(?:my\s+life|it\s+all)\b/i,
    /\b(?:no\s+reason|nothing)\s+to\s+live\s+for\b/i,
    /\bdon'?t\s+want\s+to\s+(?:live|be\s+alive)\b/i,
    /\b(?:marna|mar\s*jana|mar\s*jaana)\s+(?:chahta|chahti|chahte)\b/i,
    /\bjeena\s+nahi[n]?\s+(?:chahta|chahti|chahte)\b/i,
    /\b(?:khudkushi|aatmahatya|atmahatya|aatmahatye|atmahatye)\b/i,
    /\b(?:saayabeku|sayabeku|saaybeku|saybeku)\b/i,
  ]},
  { kind: 'emergency', urgent: true, res: [
    /\bchest\s+(?:pain|tight|tightness|pressure|heavy|heaviness|hurts?|is\s+hurting)\b/i,
    /\bchest\s+(?:feels?|is|has\s+been|got)\s+(?:very\s+|really\s+|so\s+)?(?:tight|heavy|painful|pressed)\b/i,
    /\b(?:pain|tightness|pressure|heaviness)\s+in\s+(?:my\s+)?chest\b/i,
    /\bheart\s+(?:pain|attack)\b/i,
    /\b(?:can'?t|cannot|unable\s+to|not\s+able\s+to)\s+breathe\b/i,
    /\b(?:fainted|passed\s+out|blacked\s+out|collapsed)\b/i,
    /\b(?:seene|seena|sine|chhati|chati|chaati)\s+(?:(?:mein|me|main)\s+)?dard\b/i,
    /\bsaans\s+(?:nahi|nahin)\s+(?:aa|le)\b/i,
    /\bede\s*(?:novu|noovu|nova)\b/i,
  ]},
  { kind: 'eating', urgent: false, res: [
    new RegExp(String.raw`\b(?:make|made|making)\s+${ME}\s+(?:vomit|throw\s+up|sick|puke)\b`, 'i'),
    /\b(?:vomit|vomiting|throw\s+up|throwing\s+up|threw\s+up)\s+(?:on\s+purpose|deliberately|to\s+lose)\b/i,
    /\blaxatives?\b[^.?!]{0,40}\b(?:lose|weight|after\s+(?:eating|meals?))\b/i,
    new RegExp(String.raw`\bstarv(?:e|ing)\s+${ME}\b`, 'i'),
    /\bpurg(?:e|ing)\b/i,
  ]},
  { kind: 'medicine', urgent: false, res: [
    new RegExp(String.raw`\b(?:stop|stopping|skip|skipping|quit|reduce|lower|increase|change|double|halve|cut\s+down|leave|chhod|chod|band\s+kar)\b[^.?!]{0,30}\b${MED}\b`, 'i'),
    new RegExp(String.raw`\b${MED}\b[^.?!]{0,30}\b(?:stop|band|chhod|chod|kam\s+kar|skip|reduce)\b`, 'i'),
    new RegExp(String.raw`\b(?:should|can|shall|could)\s+i\b[^.?!]{0,40}\b${MED}\b`, 'i'),
    new RegExp(String.raw`\b(?:how\s+much|which|what)\s+${MED}\b`, 'i'),
  ]},
  { kind: 'low_kcal', urgent: false, test: (t) => {
    const m = t.match(/\b(\d{3})\s*(?:k?cals?|calories)\b/i);
    if (m && Number(m[1]) < 1000 && /\b(?:only|just|want\s+to|wanna|going\s+to|plan(?:ning)?\s+to|should\s+i|can\s+i|try)\b/i.test(t)
        && /\b(?:a|per|each|every)\s+day\b|\bdaily\b|\bdin\b|\bperday\b/i.test(t)) return true;
    if (/\b(?:fast|fasting|not\s+eat|no\s+food|without\s+food|stop\s+eating|skip\s+(?:all\s+)?(?:my\s+)?meals)\b[^.?!]{0,30}\b(?:\d+|two|three|four|five|six|seven)\s*(?:days?|din)\b/i.test(t)) return true;
    return /\b(?:stop\s+eating\s+(?:completely|altogether|entirely|food)|eat\s+nothing|not\s+eat\s+anything|skip\s+all\s+(?:my\s+)?meals|khana\s+(?:band|chhod|chod)|khana\s+nahi[n]?\s+(?:khaunga|khaungi|khana))\b/i.test(t);
  }},
  { kind: 'pregnancy', urgent: false, res: [
    /\b(?:i\s+am|i'm|im|i've\s+been|i\s+have\s+been|main|mai|nanu)\b[^.?!]{0,20}\b(?:pregnant|garbhini)\b/i,
    /\bpregnant\s+(?:hu|hoon|hun|hoo|aagideeni|aagidini)\b/i,
    /\b(?:i\s+am|i'm|im)\s+(?:breast\s*feeding|lactating|expecting(?:\s+a\s+baby)?)\b/i,
    /\bpregnancy\s+test\b[^.?!]{0,15}\bpositive\b/i,
  ]},
];

const TO_COACH = /\b(?:tell|ask|message|inform|let|update|send)\b[^.?!]{0,10}\b(?:my\s+)?coach\b|\bcoach\s+(?:ko|ge|ige)\b/i;

const REPLIES = {
  self_harm:
    "I'm really sorry you're going through this, and I'm glad you said it. Please talk to someone right now. " +
    "Tele-MANAS is the free government helpline, open 24x7 on 14416 (or 1-800-891-4416), in Kannada, Hindi, English and other languages. " +
    "If you might act on these thoughts or are in danger, call 112 now. If you can, ask someone you trust to be with you.",
  emergency:
    "Please stop and don't wait this out. Chest pain, tightness or pressure, pain spreading to your arm, jaw or back, " +
    "trouble breathing, sweating or fainting can be a heart emergency. Call 112, or 108 for an ambulance, now, " +
    "or have someone take you to the nearest hospital. Muscle soreness a day after a chest workout is different, " +
    "but if you're not sure which this is, get checked today. Nothing was logged.",
  eating:
    "Thank you for telling me. Making yourself sick, using laxatives or starving yourself to control weight can harm your body, " +
    "and it's not something to carry alone. Please talk to your doctor, or call Tele-MANAS on 14416 (free, 24x7) to talk it through " +
    "with a counsellor. Your coach can also make your plan feel more manageable.",
  medicine:
    "Changes to a medicine, its dose or its timing need your doctor. I can't advise on them, and your FitLife plan never replaces a prescription. " +
    "Keep taking it as prescribed until you've spoken to your doctor. If it affects your plan, type \"tell my coach…\" and I'll pass it on.",
  low_kcal:
    "Going that low, or without food for days, isn't safe to do on your own. It costs muscle and energy, and the weight usually comes back. " +
    "Your coach sets your targets so you lose fat steadily. If you want faster progress, type \"tell my coach…\" and I'll pass it on.",
  pregnancy:
    "Thank you for letting me know. Pregnancy and breastfeeding need a plan made for them: please don't cut calories, fast or start hard new " +
    "workouts until your doctor agrees. Type \"tell my coach I'm pregnant\" and I'll pass it on, so your coach can change your plan.",
};

/**
 * @param {string} message
 * @returns {{ kind: string, urgent: boolean, reply: string } | null}
 */
function checkSafety(message) {
  const t = String(message || '').replace(/[’‘]/g, "'").slice(0, 2000);
  if (!t.trim()) return null;
  const toCoach = TO_COACH.test(t);
  for (const r of RULES) {
    if (!r.urgent && toCoach) continue;
    const hit = r.test ? r.test(t) : r.res.some(re => re.test(t));
    if (hit) return { kind: r.kind, urgent: r.urgent, reply: REPLIES[r.kind] };
  }
  return null;
}

module.exports = { checkSafety, REPLIES, KINDS: RULES.map(r => r.kind) };
