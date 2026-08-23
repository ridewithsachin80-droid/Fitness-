/**
 * MessageMember.jsx — compose and send a message from the coach's own number.
 *
 * The text is always shown and always editable before anything opens. A
 * one-tap send that fires a form letter is worse than no feature: the whole
 * point of using the coach's personal number is that the message reads like it
 * came from a person, and a coach who cannot add a sentence will not use it.
 *
 * A copy is optionally saved as a coach note, because a conversation that
 * happens entirely in WhatsApp is invisible to whoever picks the member up
 * next — and to the member's own message history in the app.
 */

import { useState } from 'react';
import api from '../api/client';
import { TEMPLATES, openWhatsApp, openSMS, waNumber } from '../utils/personalMessage';

const PRESETS = [
  ['nudge',      'Not logging',     m => TEMPLATES.nudge(m)],
  ['weightless', 'No weight',       m => TEMPLATES.weightless(m)],
  ['checkin',    'Check in',        m => TEMPLATES.checkin(m)],
];

export default function MessageMember({ member, summary = null, open, onClose }) {
  const [text, setText]   = useState(() => TEMPLATES.nudge(member || {}));
  const [preset, setPreset] = useState('nudge');
  const [saveNote, setSaveNote] = useState(true);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  if (!open) return null;

  const numberOk = !!waNumber(member?.phone);

  const pick = (key, build) => {
    setPreset(key);
    setText(build(member));
  };

  /** Record the message in-app so the exchange is not lost to WhatsApp. */
  const record = async (via) => {
    if (!saveNote) return;
    try {
      await api.post(`/patients/${member.id}/notes`, {
        note: text,
        note_date: new Date().toISOString().slice(0, 10),
        flagged: false,
        // Marked as already delivered so the member does not get a second
        // copy as an in-app "action needed" card.
        delivered_via: via,
      });
    } catch (err) {
      console.error('could not save a copy of the message:', err);
    }
  };

  const send = async (channel) => {
    setBusy(true); setError(null);
    const ok = channel === 'whatsapp'
      ? openWhatsApp(member.phone, text)
      : openSMS(member.phone, text);

    if (!ok) {
      setError("That member's phone number isn't usable for messaging.");
      setBusy(false);
      return;
    }
    await record(channel);
    setBusy(false);
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md bg-[#1A1C20] border border-white/[0.10] rounded-t-2xl sm:rounded-2xl p-4 max-h-[90vh] overflow-y-auto">

        <div className="flex items-start justify-between mb-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">Message {member?.name}</p>
            <p className="text-[11px] text-[#7E8596]">
              Sends from your own number, not the app
            </p>
          </div>
          <button onClick={onClose} className="text-[#7E8596] text-lg leading-none px-2">×</button>
        </div>

        {!numberOk && (
          <p className="text-[11px] text-amber-300 mb-3">
            This member has no usable mobile number on file, so messaging won't open.
          </p>
        )}

        <div className="flex gap-1.5 mb-2 flex-wrap">
          {PRESETS.map(([key, label, build]) => (
            <button key={key} onClick={() => pick(key, build)}
              style={{ minHeight: 30 }}
              className={`text-[11px] font-semibold rounded-full px-3 border transition-colors ${
                preset === key
                  ? 'bg-[rgba(212,175,55,0.14)] border-[rgba(212,175,55,0.45)] text-[#D4AF37]'
                  : 'border-white/[0.12] text-[#9EA3B0]'}`}>
              {label}
            </button>
          ))}
          {summary && (
            <button onClick={() => pick('summary', m => TEMPLATES.summary(m, summary))}
              style={{ minHeight: 30 }}
              className={`text-[11px] font-semibold rounded-full px-3 border transition-colors ${
                preset === 'summary'
                  ? 'bg-[rgba(212,175,55,0.14)] border-[rgba(212,175,55,0.45)] text-[#D4AF37]'
                  : 'border-white/[0.12] text-[#9EA3B0]'}`}>
              Weekly summary
            </button>
          )}
        </div>

        {/* Always editable. A coach who cannot add a sentence sends a form
            letter, which defeats the purpose of using their own number. */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={7}
          className="w-full bg-[#121316] border border-white/[0.12] rounded-xl p-3 text-[13px]
            text-white leading-relaxed resize-none focus:outline-none focus:ring-2
            focus:ring-[rgba(212,175,55,0.30)]"
        />
        <div className="flex justify-between items-center mt-1 mb-3">
          <label className="flex items-center gap-2 text-[11px] text-[#9EA3B0]">
            <input type="checkbox" checked={saveNote} onChange={e => setSaveNote(e.target.checked)}
              className="accent-[#D4AF37]" />
            Keep a copy in their notes
          </label>
          <span className="text-[10px] text-[#7E8596]">{text.length} characters</span>
        </div>

        {error && <p className="text-[11px] text-red-400 mb-2">{error}</p>}

        <div className="flex gap-2">
          <button onClick={() => send('whatsapp')} disabled={busy || !numberOk}
            style={{ minHeight: 46 }}
            className="flex-1 rounded-xl text-sm font-bold text-[#121316]
              bg-gradient-to-r from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37]
              active:scale-[0.98] disabled:opacity-50">
            WhatsApp
          </button>
          <button onClick={() => send('sms')} disabled={busy || !numberOk}
            style={{ minHeight: 46 }}
            className="flex-1 rounded-xl text-sm font-bold text-[#9EA3B0]
              border border-white/[0.14] active:scale-[0.98] disabled:opacity-50">
            SMS
          </button>
        </div>

        <p className="text-[10px] text-[#7E8596] mt-2 leading-relaxed">
          Opens your own WhatsApp or messages app with this text ready to send —
          nothing is sent until you tap send there.
        </p>
      </div>
    </div>
  );
}
