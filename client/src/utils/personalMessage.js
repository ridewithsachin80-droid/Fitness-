/**
 * personalMessage.js — send a member a message from the coach's own number.
 *
 * ── Why this exists alongside the automated channels ────────────────────────
 *
 * The WhatsApp Business API sends from a business number using a template Meta
 * approved weeks earlier. It is the right tool at a few hundred members, and
 * the wrong one at a few dozen: a templated nudge to someone who knows Sachin
 * personally reads like a bank notification and makes the product feel less
 * personal than it actually is.
 *
 * A click-to-chat link costs nothing, needs no approval, works today, and
 * arrives in the member's existing conversation with their coach — where they
 * will actually reply. The trade-off is that it is one tap of the coach's
 * time per member and there is no delivery receipt.
 *
 * The message text is pre-filled and editable before sending, so the coach can
 * add a sentence rather than firing a form letter.
 */

/** Indian mobile numbers, in the 91XXXXXXXXXX form wa.me expects. */
export function waNumber(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return null;
}

/**
 * wa.me opens the WhatsApp app on a phone and WhatsApp Web on a desktop, so
 * one link covers a coach working from either.
 */
export function whatsappLink(phone, text) {
  const n = waNumber(phone);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

/**
 * The sms: scheme differs between platforms — iOS wants &body=, Android and
 * everything else want ?body=. Getting this wrong silently drops the message
 * text and opens an empty compose window.
 */
export function smsLink(phone, text) {
  const n = waNumber(phone);
  if (!n) return null;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '');
  return `sms:+${n}${isIOS ? '&' : '?'}body=${encodeURIComponent(text)}`;
}

const first = name => String(name || '').trim().split(/\s+/)[0] || 'there';

/**
 * The app's own address, taken from wherever the coach is currently running it.
 *
 * Reading window.location.origin rather than hard-coding the domain means the
 * link is always right — production, a staging deploy, or a local dev server —
 * and it can never drift out of date if the domain changes.
 *
 * WhatsApp turns a bare URL into a tappable link automatically, so it goes on
 * its own line at the end where it reads as a call to action rather than
 * interrupting the sentence.
 */
export function appUrl(path = '') {
  const origin = (typeof window !== 'undefined' && window.location?.origin)
    || 'https://fitness.upscale-app.com';
  return path ? `${origin}${path.startsWith('/') ? path : `/${path}`}` : origin;
}

/** Append the link as its own line — never inline, where it breaks the read. */
const withLink = (body, path = '') => `${body}\n\n${appUrl(path)}`;

/**
 * Message templates. Written to sound like a person, because they are sent
 * from a person's number — a coach's WhatsApp saying "Dear Member, your
 * compliance is 45%" would be worse than sending nothing.
 */
export const TEMPLATES = {
  nudge: (m) => withLink(
    `Hi ${first(m.name)}, haven't seen your logs for a few days. ` +
    `Everything alright? Open FitLife and just tell the AI what you ate — it fills the rest in.`),

  weightless: (m) => withLink(
    `Hi ${first(m.name)}, quick one — could you log your morning weight when you get a moment? ` +
    `It takes ten seconds and keeps your targets accurate.`),

  summary: (m, s = {}) => {
    const lines = [`Hi ${first(m.name)}, here's your week:`];
    if (s.days != null)     lines.push(`• Logged ${s.days} of 7 days`);
    if (s.avgComp != null)  lines.push(`• Average compliance ${s.avgComp}%`);
    if (s.change != null) {
      lines.push(s.change < 0 ? `• Weight down ${Math.abs(s.change)} kg`
               : s.change > 0 ? `• Weight up ${s.change} kg`
                              : `• Weight held steady`);
    }
    if (s.volume)    lines.push(`• ${Number(s.volume).toLocaleString()} kg lifted`);
    if (s.cardioMin) lines.push(`• ${s.cardioMin} min of cardio`);
    lines.push('', (s.avgComp ?? 0) >= 75 || (s.days ?? 0) >= 6
      ? 'Really good consistency — keep it going.'
      : "Let's aim for a bit more logging this week. Small entries add up.");
    return withLink(lines.join('\n'), '/progress');
  },

  labs: (m, markers = []) => withLink(
    `Hi ${first(m.name)}, I've been through your lab report. ` +
    (markers.length
      ? `A few things worth adjusting in your diet — mainly ${markers.slice(0, 3).join(', ')}. `
      : '') +
    `I've updated your plan in FitLife. Have a look and tell me if anything doesn't suit you.`,
    '/profile'),

  checkin: (m) => withLink(
    `Hi ${first(m.name)}, just checking in — how are you finding the plan this week? ` +
    `Anything you'd like changed?`),
};

/**
 * Messages for a specific missing item.
 *
 * Each names the one thing and nothing else. A message listing five gaps reads
 * as a scolding, and a member who is already behind does not need a checklist
 * of their failures — they need one small thing they can do in ten seconds.
 */
export const GAP_TEMPLATES = {
  nothing: (m) => withLink(
    `Hi ${first(m.name)}, haven't seen anything from you today. ` +
    `Everything alright? If you're short on time, just send the AI one line — ` +
    `"2 chapati and dal for lunch, walked in the morning" — and it fills the rest in.`),

  food: (m) => withLink(
    `Hi ${first(m.name)}, your meals aren't logged yet today. ` +
    `Tell the AI what you've eaten so far and it'll sort out the rest.`),

  weight: (m) => withLink(
    `Morning ${first(m.name)} — could you pop your weight in when you get a chance? ` +
    `Takes ten seconds and it keeps your calorie target accurate.`),

  dinner: (m) => withLink(
    `Hi ${first(m.name)}, dinner isn't logged yet. Add it before bed so tomorrow's ` +
    `numbers start clean.`),

  water: (m) => withLink(
    `Hi ${first(m.name)}, you're well behind on water today. ` +
    `A couple of glasses this evening will get you close — just stop an hour before bed.`),

  activity: (m) => withLink(
    `Hi ${first(m.name)}, nothing ticked on your activity today. ` +
    `Even a 15-minute walk after dinner counts — log it and it's done.`),

  acv: (m) => withLink(
    `Hi ${first(m.name)}, a couple of ACV doses are still open today. ` +
    `Tick them off if you've had them — easy to forget the logging rather than the drink.`),

  supplements: (m) => withLink(
    `Hi ${first(m.name)}, your supplements aren't ticked today. ` +
    `Quick one to mark off if you've taken them.`),

  sleep: (m) => withLink(
    `Hi ${first(m.name)}, add your sleep times before bed — it's the one thing ` +
    `the app can't work out on its own.`),
};

/**
 * One message covering everything a member hasn't logged.
 *
 * Sending a separate message per gap would mean two or three notifications
 * from a coach's personal number within a minute, which reads as pestering.
 * One message naming both things is a single, easy ask.
 *
 * The phrasing is deliberately light. A member who is already behind does not
 * need a bulleted audit of their failures — the list is short, the tone is
 * "when you get a moment", and it never says why it matters. They know why.
 */

/** How each gap is named inside a sentence, as a natural noun phrase. */
const GAP_PHRASE = {
  weight:      'your morning weight',
  food:        'your meals',
  dinner:      'dinner',
  water:       'your water',
  activity:    "today's activity",
  acv:         'your ACV doses',
  supplements: 'your supplements',
  sleep:       'your sleep times',
};

/** "a, b and c" — the Oxford-less list a person would actually speak. */
function joinPhrases(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * @param member  { name }
 * @param gapKeys ordered gap keys, most important first
 */
export function combinedGapMessage(member, gapKeys = []) {
  const keys = gapKeys.filter(k => k !== 'nothing');

  // Nothing at all, or so much missing that listing it becomes a telling-off
  if (gapKeys.includes('nothing') || keys.length === 0 || keys.length >= 5) {
    return GAP_TEMPLATES.nothing(member);
  }

  const phrases = keys.map(k => GAP_PHRASE[k]).filter(Boolean);
  const list = joinPhrases(phrases);

  // Grammar has to agree with the count, or the message reads as generated —
  // "your weight isn't logged, pop THEM in" is the tell.
  const opener = keys.length === 1
    ? `Hi ${first(member.name)}, ${list} isn't logged yet today.`
    : keys.length === 2
      ? `Hi ${first(member.name)}, a couple of things are still open today — ${list}.`
      : `Hi ${first(member.name)}, a few things are still open today — ${list}.`;

  const closer = keys.length === 1
    ? "Pop it in when you get a moment, or just tell the AI and it'll sort the rest."
    : "Pop them in when you get a moment, or just tell the AI and it'll sort the rest.";

  return withLink(`${opener} ${closer}`);
}

/** Human label for a gap key, for buttons and lists. */
export const GAP_LABEL = {
  nothing: 'Nothing logged', food: 'No food', weight: 'No weight',
  dinner: 'No dinner', water: 'Low water', activity: 'No activity',
  acv: 'ACV missed', supplements: 'No supplements', sleep: 'No sleep times',
};

/**
 * Open the conversation. Returns false when the number is unusable so the
 * caller can say so rather than appearing to do nothing.
 */
export function openWhatsApp(phone, text) {
  const url = whatsappLink(phone, text);
  if (!url) return false;
  window.open(url, '_blank', 'noopener');
  return true;
}

export function openSMS(phone, text) {
  const url = smsLink(phone, text);
  if (!url) return false;
  window.location.href = url;
  return true;
}
