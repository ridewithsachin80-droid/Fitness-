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
 * Message templates. Written to sound like a person, because they are sent
 * from a person's number — a coach's WhatsApp saying "Dear Member, your
 * compliance is 45%" would be worse than sending nothing.
 */
export const TEMPLATES = {
  nudge: (m) =>
    `Hi ${first(m.name)}, haven't seen your logs for a few days. ` +
    `Everything alright? Just open FitLife and tell the AI what you ate — it fills the rest in.`,

  weightless: (m) =>
    `Hi ${first(m.name)}, quick one — could you log your morning weight when you get a moment? ` +
    `It takes ten seconds and it keeps your targets accurate.`,

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
    return lines.join('\n');
  },

  labs: (m, markers = []) =>
    `Hi ${first(m.name)}, I've been through your lab report. ` +
    (markers.length
      ? `A few things worth adjusting in your diet — mainly ${markers.slice(0, 3).join(', ')}. `
      : '') +
    `I've updated your plan in FitLife. Have a look and tell me if anything doesn't suit you.`,

  checkin: (m) =>
    `Hi ${first(m.name)}, just checking in — how are you finding the plan this week? ` +
    `Anything you'd like changed?`,
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
