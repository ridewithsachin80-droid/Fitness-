/**
 * CoachAIChat.jsx — natural-language protocol management for coaches.
 *
 * The coach types (or speaks) instructions like:
 *   "Set Bujju's water target to 4 litres and add an evening walk 20 min"
 *   "Asha: 1400 kcal, protein 90g. Message her to start logging daily"
 *   "Remove flaxseed oil for Suresh"
 *   "Push notification to all members: log before 9 PM tonight"
 *
 * The AI parses this into per-member commands, the coach reviews a preview
 * card per member (with every change listed and toggleable), and one tap
 * applies everything through the server — protocol updates, coach messages
 * (monitor_notes), and push notifications. Every apply is audit-logged.
 *
 * Mount ONCE per page (AdminDashboard / Coach do this). Open with:
 *   import { useCoachAI } from '../components/CoachAIChat';
 *   const openChat = useCoachAI(s => s.openChat);
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { create } from 'zustand';
import api from '../api/client';
import { haptic } from '../store/settingsStore';
import { useVoiceComposer } from './VoiceComposer';
import { plural } from '../constants';
import DaySummary from './DaySummary';

export const useCoachAI = create((set) => ({
  open: false,
  openChat:  () => set({ open: true }),
  closeChat: () => set({ open: false }),
}));

const SUGGESTION_CHIPS = [
  'Set water target 4L for ',
  'Add evening walk 20 min for ',
  'Set 1400 kcal, protein 90g for ',
  'Message all members: please log daily',
];

/** Edge-docked side tab — export so pages can drop it in one line.
 *  Pass bottomOffset (px) on pages with a fixed bottom nav so it clears the nav. */
/**
 * Edit a shared food from the chat.
 *
 * The values here belong to every member, not to the one whose page the coach
 * happens to be on — so the card says so, and shows how many logged entries a
 * correction would move BEFORE the coach commits to it.
 *
 * Macros are always visible because they are what gets corrected in practice.
 * The micronutrients are behind a toggle: forty fields on screen turns a
 * two-second fix into a form nobody finishes.
 */
const MACRO_FIELDS = [
  ['calories', 'kcal'], ['protein', 'g protein'], ['total_carbs', 'g carbs'],
  ['fat', 'g fat'], ['fiber', 'g fibre'], ['sugar', 'g sugar'],
  ['saturated_fat', 'g sat fat'], ['sodium', 'mg sodium'],
];

function FoodEditCard({ food, onSaved }) {
  const [vals, setVals]   = useState(food.per_100g || {});
  // Pre-filled when the coach said a number: "edit masala dosa portion to 200".
  const [defG, setDefG]   = useState(food.suggested_grams ?? food.default_grams ?? '');
  const [more, setMore]   = useState(false);
  const [prop, setProp]   = useState(false);
  const [propG, setPropG] = useState(false);
  const [propU, setPropU] = useState(false);
  const [fatSrc, setFatSrc] = useState(food.default_fat_source || 'sunflower');
  const [busy, setBusy]   = useState(false);
  const [err,  setErr]    = useState('');
  const [done, setDone]   = useState(null);

  const micros = Object.keys(food.per_100g || {})
    .filter(k => !MACRO_FIELDS.some(([m]) => m === k) && k !== 'net_carbs');

  const set = (k, v) => setVals(o => ({ ...o, [k]: v === '' ? 0 : parseFloat(v) || 0 }));

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const { data } = await api.put(`/foods/${food.id}`, {
        per_100g: vals, propagate: prop || propG,
        propagate_portion: propG,
        propagate_unlinked: propU,
        default_grams: defG === '' ? null : parseInt(defG),
      });
      const p = data.propagated;
      setDone(p
        ? `Saved. ${p.entries} logged ${p.entries === 1 ? 'entry' : 'entries'} across ` +
          `${p.members} ${p.members === 1 ? 'member' : 'members'} corrected` +
          (p.grams_fixed ? `, ${p.grams_fixed} portion${p.grams_fixed === 1 ? '' : 's'} reset to ${defG}g` : '') +
          (p.unlinked_fixed ? `, ${p.unlinked_fixed} unlinked ${p.unlinked_fixed === 1 ? 'entry' : 'entries'} linked and corrected` : '') + '.'
        : 'Saved. Applies to every member from now on.');
      onSaved?.();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not save that.');
    } finally { setBusy(false); }
  };

  if (done) {
    return <p className="text-[12px] text-[#6E8F6B] mt-2">{done}</p>;
  }

  return (
    <div className="mt-2 rounded-2xl bg-[#17181C] px-3.5 py-3"
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.045)' }}>
      <p className="text-[14px] font-semibold text-[#F2F1EE]">{food.name}</p>
      <p className="text-[11px] text-[#7E8596] mt-0.5">
        Per 100g · {food.verified ? 'verified' : `from ${food.source}, unverified`} ·
        {' '}applies to every member
      </p>
      {food.warning && (
        <p className="text-[11px] text-[#D9A66B] mt-1.5 leading-snug">⚠ {food.warning}</p>
      )}

      {/* Arithmetic that cannot be true, listed in full rather than one at a
          time — each is a different mistake with a different fix, and fixing
          one only to be shown the next is a bad way to spend a coach's
          attention. Shown in red because these are not judgement calls. */}
      {food.mass_balance?.problems?.length > 1 && (
        <ul className="mt-1.5 space-y-0.5">
          {food.mass_balance.problems.slice(1).map((x, i) => (
            <li key={i} className="text-[11px] text-[#D98A80] leading-snug">⚠ {x}</li>
          ))}
        </ul>
      )}

      {/* What the numbers add up to, always visible. 38g of macros in 100g
          leaves 62g of water, which is right for a cooked dish and obviously
          wrong for a dry powder — but only if someone can see it. */}
      {food.mass_balance?.macro_mass > 0 && (
        <p className="text-[10.5px] text-[#7E8596] mt-1.5">
          {food.mass_balance.macro_mass}g of protein, carbs and fat per 100g
          {' '}· {Math.round((100 - food.mass_balance.macro_mass) * 10) / 10}g water and ash
        </p>
      )}

      {/* One normal portion. Without it a member typing "masala dosa" with no
          number gets whatever the model guesses — 80g, a third of a real one —
          and their day comes out light with nothing looking wrong. The model
          does not know what a dosa looks like on an Indian plate; the coach
          does. A member who names a quantity still overrides it. */}
      <label className="flex items-center gap-2 mt-3">
        <input type="number" inputMode="numeric" value={defG} placeholder="—"
          onChange={e => setDefG(e.target.value)} disabled={!food.editable || busy}
          className="w-[74px] bg-[#121316] border border-[rgba(212,175,55,0.3)] rounded-lg
            px-2 py-1.5 text-[13px] text-[#E8CE7A] tabular-nums disabled:opacity-50" />
        <span className="text-[11.5px] text-[#9EA3B0]">
          g — one typical serving
          <span className="block text-[10.5px] text-[#7E8596]">
            Used when a member logs this without saying how much.
          </span>
        </span>
      </label>

      <div className="grid grid-cols-2 gap-2 mt-3">
        {MACRO_FIELDS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="number" inputMode="decimal" value={vals[k] ?? 0}
              onChange={e => set(k, e.target.value)}
              disabled={!food.editable || busy}
              className="w-[74px] bg-[#121316] border border-white/[0.09] rounded-lg
                px-2 py-1.5 text-[13px] text-[#F2F1EE] tabular-nums disabled:opacity-50" />
            <span className="text-[11px] text-[#8C93A3]">{label}</span>
          </label>
        ))}
      </div>

      {/* Saturated fat cannot be computed from total fat — the share depends
          entirely on which fat went in. Sunflower is about a ninth saturated,
          ghee two thirds, coconut nearly all of it. So the coach names the fat
          and the split follows from that fat's real composition; a fixed ratio
          would be inventing a number, which is how the wrong figures got here.
          Suggested with its reasoning visible, applied only on a tap. */}
      {(() => {
        const fat = parseFloat(vals.fat) || 0;
        const sat = parseFloat(vals.saturated_fat) || 0;
        if (!food.editable || fat < 3 || sat > 0) return null;
        const src = (food.fat_sources || []).find(f => f.key === fatSrc)
                 || { label: 'Sunflower oil', sat: 0.11 };
        const suggested = Math.round(fat * src.sat * 10) / 10;
        return (
          <div className="mt-3 rounded-xl bg-[rgba(212,175,55,0.06)] px-3 py-2.5">
            <p className="text-[11.5px] text-[#D9A66B] leading-snug">
              ⚠ {fat}g fat with no saturated fat recorded — no fat is 0% saturated.
            </p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-[11.5px] text-[#9EA3B0]">Cooked in</span>
              <select value={fatSrc} onChange={e => setFatSrc(e.target.value)}
                className="bg-[#121316] border border-white/[0.09] rounded-lg px-2 py-1
                  text-[12px] text-[#F2F1EE]">
                {(food.fat_sources || []).map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
              <span className="text-[11.5px] text-[#9EA3B0]">
                → <strong className="text-[#E8CE7A]">{suggested}g</strong> saturated
                {' '}({Math.round(src.sat * 100)}% of the fat)
              </span>
              <button
                onClick={() => setVals(o => ({ ...o, saturated_fat: suggested }))}
                className="text-[11.5px] font-semibold text-[#E8CE7A] border
                  border-[rgba(212,175,55,0.34)] rounded-full px-2.5 py-0.5">
                Use
              </button>
            </div>
          </div>
        );
      })()}

      <button onClick={() => setMore(v => !v)}
        className="text-[11px] font-semibold text-[#8C7A46] mt-2.5">
        {more ? 'Hide' : `Show ${micros.length} more nutrients`}
      </button>

      {more && (
        <div className="grid grid-cols-2 gap-2 mt-2">
          {micros.map(k => (
            <label key={k} className="flex items-center gap-2">
              <input type="number" inputMode="decimal" value={vals[k] ?? 0}
                onChange={e => set(k, e.target.value)}
                disabled={!food.editable || busy}
                className="w-[74px] bg-[#121316] border border-white/[0.09] rounded-lg
                  px-2 py-1.5 text-[12px] text-[#F2F1EE] tabular-nums disabled:opacity-50" />
              <span className="text-[11px] text-[#8C93A3]">{k.replace(/_/g, ' ')}</span>
            </label>
          ))}
        </div>
      )}

      {/* Existing logs keep a snapshot of the nutrition they were saved with.
          A food that was wrong was wrong for everyone who ate it, so the option
          is offered here with the count attached rather than left as something
          you would have to know to ask for. */}
      {food.editable && food.impact?.entries > 0 && (
        <label className="flex items-start gap-2 mt-3 cursor-pointer">
          <input type="checkbox" checked={prop} onChange={e => setProp(e.target.checked)} className="mt-0.5" />
          <span className="text-[11.5px] text-[#9EA3B0] leading-snug">
            Also correct <strong className="text-[#E8CE7A]">{food.impact.entries}</strong> already
            logged by <strong className="text-[#E8CE7A]">{food.impact.members}</strong>
            {food.impact.members === 1 ? ' member' : ' members'}
            {food.impact.earliest ? ` since ${food.impact.earliest}` : ''}.
            <span className="block text-[10.5px] text-[#7E8596] mt-0.5">
              Grams stay as they logged them — only what 100g contains changes.
            </span>
          </span>
        </label>
      )}

      {/* A separate choice from correcting the nutrition, because it is a
          different claim. Only offered for entries where the member never said
          how much — "80g" for a dosa logged as just "masala dosa" is the
          model's guess, and a guess we now know is wrong is worth fixing. The
          moment they typed "2 dosa", that is theirs and stays. */}
      {/* Shown whenever a serving is set and there are guessed portions —
          NOT only when the number changed in this session. Gating on "changed"
          meant a coach who had already set the serving correctly had no way to
          apply it to entries logged before that, and the option simply was not
          on screen. */}
      {food.editable && defG !== '' && parseInt(defG) > 0
        && food.impact?.guessed > 0 && (
        <label className="flex items-start gap-2 mt-2 cursor-pointer">
          <input type="checkbox" checked={propG} onChange={e => setPropG(e.target.checked)} className="mt-0.5" />
          <span className="text-[11.5px] text-[#9EA3B0] leading-snug">
            Also reset the portion to <strong className="text-[#E8CE7A]">{defG}g</strong> on
            {' '}<strong className="text-[#E8CE7A]">{food.impact.guessed}</strong>
            {food.impact.guessed === 1 ? ' entry' : ' entries'} where no quantity was given.
            <span className="block text-[10.5px] text-[#7E8596] mt-0.5">
              Entries where the member said how much are left alone.
            </span>
          </span>
        </label>
      )}

      {/* Entries that NAME this food but were never linked to it — food_id null.
          They happen constantly: the food was created after the log, or
          enrichment missed the name that day. Correcting the food could never
          reach them, so editing Aloo Bhaji changed nothing for a member who
          had clearly logged Aloo Bhaji.

          Separate consent, because matching on a name is a weaker claim than
          matching on an id. Ticking it also LINKS them, so the gap closes
          rather than needing this every time. */}
      {food.editable && food.impact?.unlinked > 0 && (
        <label className="flex items-start gap-2 mt-2 cursor-pointer">
          <input type="checkbox" checked={propU} onChange={e => setPropU(e.target.checked)} className="mt-0.5" />
          <span className="text-[11.5px] text-[#9EA3B0] leading-snug">
            Also correct <strong className="text-[#E8CE7A]">{food.impact.unlinked}</strong>
            {food.impact.unlinked === 1 ? ' entry' : ' entries'} named "{food.name}" that were
            never linked to this food.
            <span className="block text-[10.5px] text-[#7E8596] mt-0.5">
              Matched on the exact name. They get linked, so future corrections reach them automatically.
            </span>
          </span>
        </label>
      )}

      {err && <p className="text-[11.5px] text-red-300 mt-2">{err}</p>}

      {food.editable ? (
        <button onClick={save} disabled={busy}
          style={{ minHeight: 38 }}
          className="w-full mt-3 text-[13px] font-semibold text-[#121316] bg-[#D4AF37]
            rounded-xl disabled:opacity-50 active:scale-95 transition-transform">
          {busy ? 'Saving…' : 'Save for all members'}
        </button>
      ) : (
        <p className="text-[11.5px] text-[#7E8596] mt-3">
          Shared foods are corrected by an admin.
        </p>
      )}
    </div>
  );
}

export function CoachAIFab({ bottomOffset = 40 }) {
  const openChat = useCoachAI(s => s.openChat);
  const open     = useCoachAI(s => s.open);
  if (open) return null;
  return (
    <button
      onClick={openChat}
      aria-label="Coach AI"
      // Flush to the right edge on purpose — it is thumb-reachable there and
      // never scrolls away. But a radial gradient with a rounded left side read
      // as an orb someone had cut in half, so it now presents as a deliberate
      // tab: flat gold, a hairline down the open edge, and a drawn glyph
      // instead of whatever spark the phone's emoji font supplies.
      className="fixed z-40 flex items-center justify-center bg-[#D4AF37]
        shadow-[0_2px_14px_rgba(212,175,55,0.28)] active:scale-95 transition-transform"
      style={{
        right: 0,
        bottom: `calc(${bottomOffset}px + env(safe-area-inset-bottom))`,
        width: 44, height: 54,
        borderTopLeftRadius: 14, borderBottomLeftRadius: 14,
        boxShadow: 'inset 1px 0 0 rgba(255,255,255,0.22), 0 2px 14px rgba(212,175,55,0.28)',
      }}>
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#121316"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7 1.7-5z" />
        <path d="M18.5 4v3M20 5.5h-3" />
      </svg>
    </button>
  );
}

/**
 * @param {object}  [contextMember]  { id, name } when mounted on a member's
 *   detail page. Lets the coach type "raise water to 4 litres" without naming
 *   the member they are already looking at. The server only applies the hint
 *   when the message names nobody, and only if that member is assigned to
 *   this coach.
 */
export default function CoachAIChat({ onApplied, contextMember = null }) {
  const open      = useCoachAI(s => s.open);
  const closeChat = useCoachAI(s => s.closeChat);

  const [messages, setMessages]   = useState([]);
  /**
   * `send` is a useCallback with deps [input, busy, contextMember?.id] — it does
   * NOT depend on `messages`, so reading the state directly inside it would
   * capture whatever the array was when the callback was last built. From the
   * second turn on, the history sent to the server would be stale, which is
   * exactly the bug this history is meant to fix. A ref always holds the
   * current value.
   */
  const messagesRef = useRef([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const [input, setInput]         = useState('');
  const [busy, setBusy]           = useState(false);
  const [applying, setApplying]   = useState(false);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const recogRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 250);
  }, [open]);

  // Voice: review card above the input — see VoiceComposer for the flow
  const vc = useVoiceComposer({ onSend: (t) => send(t), accent: '#e0c98a' });

  // ── Send → coach-parse ─────────────────────────────────────────────────────
  const send = useCallback(async (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;

    setInput('');
    setMessages(m => [...m, { role: 'user', text }]);
    setBusy(true);
    haptic(10);

    try {
      const { data } = await api.post('/ai-chat/coach-parse', {
        message: text,
        context_member_id: contextMember?.id ?? null,
        // The last few turns. Without them "set water target 4L for" followed by
        // "sachin" read as two unrelated instructions, and the second one lost
        // the 4L entirely. `messages` is the state BEFORE this send, which is
        // what we want — the new line goes in as `message`.
        recent: messagesRef.current
          .filter(mm => mm.text)
          .slice(-6)
          .map(mm => ({ role: mm.role === 'user' ? 'coach' : 'ai', text: String(mm.text).slice(0, 300) })),
      });
      // A question comes back as { answer } with no actions. Rendered as a
      // plain reply — there is nothing to apply, so showing a preview card
      // with an Apply button would be meaningless.
      // A whole-day summary arrives as structured fields, not prose, and is
      // laid out below. The first version had the model write the summary and
      // it came back as one run-on paragraph.
      if (data.summary) {
        setMessages(m => [...m, {
          role: 'ai',
          summary: data.summary,
          answeredFor: data.answered_for || null,
        }]);
        return;
      }
      if (data.answer) {
        setMessages(m => [...m, {
          role: 'ai',
          text: data.answer,
          isAnswer: true,
          answeredFor: data.answered_for || null,
        }]);
        return;
      }
      setMessages(m => [...m, {
        role: 'ai',
        text: data.reply,
        foodEdit: data.food_edit || null,
        // Eval set (Sprint L1): the instruction that produced these actions, so
        // anything the coach switches off before applying can be paired to it.
        evalMessage: text,
        actions: (data.actions || []).map(a => ({ ...a, on: a.resolved })),
        applied: false,
      }]);
    } catch (err) {
      const msg = err.response?.data?.error || 'Something went wrong — please try again.';
      setMessages(m => [...m, { role: 'ai', text: msg, error: true }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, contextMember?.id]);

  const toggleAction = useCallback((mi, ai) => {
    setMessages(prev => {
      const next = [...prev];
      const msg = next[mi];
      if (!msg?.actions || msg.applied) return prev;
      const actions = msg.actions.map((a, i) =>
        i === ai && a.resolved ? { ...a, on: !a.on } : a
      );
      next[mi] = { ...msg, actions };
      return next;
    });
  }, []);

  // ── Apply → coach-apply ────────────────────────────────────────────────────
  /**
   * Attach a diet plan (PDF, or a photo of a printed one) for a member.
   *
   * It comes back as the SAME actions the typed chat produces, so it lands in
   * the same preview with the same per-line toggles and the same Apply button.
   * Nothing reaches a member until the coach approves it — a plan read out of a
   * PDF is a draft, not an instruction, and the plans that get uploaded here
   * are exactly the ones with medical context attached.
   */
  const sendDoc = useCallback(async (fileObj) => {
    if (!fileObj || busy) return;
    if (fileObj.size > 7 * 1024 * 1024) {
      setMessages(m => [...m, { role: 'ai',
        text: 'That file is over 7MB — try a single-page export or a photo of the plan.' }]);
      return;
    }
    setBusy(true);
    setMessages(m => [...m, { role: 'coach', text: `Attached ${fileObj.name}` }]);
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = () => rej(new Error('Could not read that file'));
        r.readAsDataURL(fileObj);
      });
      const { data } = await api.post('/ai-chat/coach-doc', {
        file: b64,
        mimeType: fileObj.type || 'application/pdf',
        fileName: fileObj.name,
        // If the chat was opened from a member's page, that is who the plan is
        // for — better than making the model guess from the document.
        member_name: contextMember?.name || null,
      });
      setMessages(m => [...m, {
        role: 'ai',
        text: data.reply,
        evalMessage: `diet plan: ${fileObj.name}`,
        actions: (data.actions || []).map(a => ({ ...a, on: a.resolved })),
        applied: false,
      }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'ai',
        text: e.response?.data?.error || "I couldn't read that file just now." }]);
    } finally {
      setBusy(false);
    }
  }, [busy, contextMember]);

  const applyAll = useCallback(async (mi) => {
    const msg = messages[mi];
    if (!msg?.actions || msg.applied || applying) return;
    const toApply = msg.actions.filter(a => a.on && a.resolved);
    if (!toApply.length) return;

    setApplying(true);
    haptic(20);
    try {
      const { data } = await api.post('/ai-chat/coach-apply', {
        actions: toApply.map(({ member_id, is_all, ops }) => ({ member_id, is_all, ops })),
      });
      setMessages(prev => {
        const next = [...prev];
        next[mi] = { ...next[mi], applied: true, results: data.results || [] };
        return next;
      });

      // ── Eval set (Sprint L1) ───────────────────────────────────────────────
      // The coach cannot edit a proposed action, only switch it off. Switching
      // one off before applying IS the correction: the model proposed something
      // for this instruction that the coach did not want. The server never sees
      // it — coach-apply is sent only the actions that survived — so it is
      // recorded from here.
      const resolved = msg.actions.filter(a => a.resolved);
      const dropped  = resolved.filter(a => !a.on);
      if (msg.evalMessage && dropped.length) {
        const shape = a => ({ member_name: a.member_name, is_all: !!a.is_all, ops: a.ops });
        api.post('/ai-chat/eval-sample', {
          source:    'coach_parse',
          message:   msg.evalMessage,
          field:     'ops',
          ai_output: resolved.map(shape),
          corrected: toApply.map(shape),
        }).catch(() => {});   // bookkeeping — never surfaces to the coach
      }

      haptic(30);
      onApplied?.();   // let the page refresh member lists / stats
    } catch (err) {
      const msgTxt = err.response?.data?.error || 'Apply failed — please try again.';
      setMessages(m => [...m, { role: 'ai', text: msgTxt, error: true }]);
    } finally {
      setApplying(false);
    }
  }, [messages, applying, onApplied]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-[#0d0d11] flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[#111116]">
        <button onClick={closeChat}
          style={{ minWidth: 44, minHeight: 44 }}
          className="flex items-center justify-center rounded-full text-[#8e8e9a] hover:text-white hover:bg-white/[0.06] transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#8a6a1e] flex items-center justify-center text-sm shadow-[0_0_16px_rgba(212,175,55,0.45)]">✨</div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">Coach AI</p>
            <p className="text-[10px] text-[#4e4e5c] leading-tight">Manage protocols & messages by chat</p>
          </div>
        </div>

        {/* Clear the thread.
            The chat is held in component state and is not persisted, so this
            only has to reset what is on screen — nothing was ever written down.
            It appears only when there is something to clear, so it cannot be
            tapped on an already-empty screen, and it does not ask: there is no
            data behind it and a confirmation for a no-op teaches people to tap
            through confirmations. */}
        {messages.length > 0 && (
          <button onClick={() => { setMessages([]); setInput(''); }}
            style={{ minHeight: 36 }}
            className="ml-auto px-3 rounded-full text-[11px] font-semibold text-[#8e8e9a]
              hover:text-white hover:bg-white/[0.06] transition-colors">
            Clear
          </button>
        )}
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {messages.length === 0 && (
          <div className="bg-[#16161c] border border-white/[0.07] rounded-2xl p-4">
            <p className="text-sm font-semibold text-white mb-1.5">What would you like to change? 🏋️</p>
            <p className="text-xs text-[#8e8e9a] leading-relaxed mb-3">
              Name a member and describe the change — protocols, targets, custom
              activities, messages, or push notifications. I'll show a preview
              before anything is applied.
            </p>
            <div className="space-y-1.5 text-xs text-[#b6b6c2]">
              <p>· "Set Bujju's water target to 4 litres"</p>
              <p>· "Asha: 1400 kcal, protein 90g, add evening walk"</p>
              <p>· "Remove flaxseed oil for Suresh, message him to log daily"</p>
              <p>· "Push to all members: log before 9 PM tonight"</p>
            </div>
          </div>
        )}

        {messages.map((m, mi) => (
          m.role === 'user' ? (
            <div key={mi} className="flex justify-end">
              <div className="max-w-[85%] bg-[#D4AF37] text-[#121316] text-sm rounded-2xl rounded-br-md px-4 py-2.5 shadow-sm">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={mi} className="flex justify-start">
              <div className="max-w-[94%] w-full">
                <div className={`text-sm rounded-2xl rounded-bl-md px-4 py-3 border ${
                  m.error
                    ? 'bg-red-500/[0.08] border-red-500/25 text-red-300'
                    : m.isAnswer
                      // Answers are gold-tinted so a READ is visually distinct
                      // from a pending CHANGE. Nothing here needs applying.
                      ? 'bg-[rgba(212,175,55,0.06)] border-[rgba(212,175,55,0.20)] text-[#F0E2B6]'
                      : 'bg-[#16161c] border-white/[0.07] text-[#d8d8de]'
                }`}>
                  {(m.isAnswer || m.summary) && m.answeredFor && (
                    <p className="text-[10px] font-bold text-[#D4AF37] mb-1.5">
                      {m.answeredFor}
                    </p>
                  )}
                  {m.summary
                    ? <DaySummary s={m.summary} />
                    : <p className="leading-relaxed whitespace-pre-line">{m.text}</p>}

                  {/* Editing a shared food — not a per-member action, so it
                      renders its own card with its own Save. */}
                  {m.foodEdit && <FoodEditCard food={m.foodEdit} />}

                  {/* Per-member action cards */}
                  {m.actions?.length > 0 && (
                    <div className="mt-3 space-y-2.5">
                      {m.actions.map((a, ai) => (
                        <button key={ai}
                          onClick={() => toggleAction(mi, ai)}
                          disabled={!a.resolved || m.applied}
                          className={`w-full text-left bg-[#0d0d11] border rounded-xl px-3.5 py-3 transition-all ${
                            !a.resolved
                              ? 'border-amber-500/30 opacity-80'
                              : a.on
                              ? 'border-[#D4AF37]/40 active:scale-[0.99]'
                              : 'border-white/[0.05] opacity-40'
                          }`}>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              {a.resolved && (
                                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] flex-shrink-0 ${
                                  a.on ? 'bg-[#D4AF37] text-[#121316]' : 'bg-white/[0.08] text-transparent'
                                }`}>✓</span>
                              )}
                              <p className={`text-[13px] font-bold truncate ${a.on || !a.resolved ? 'text-white' : 'text-[#8e8e9a] line-through'}`}>
                                {a.member_name}
                              </p>
                              {a.is_all && (
                                <span className="text-[9px] font-bold text-[#e0c98a] bg-[#D4AF37]/[0.14] border border-[#D4AF37]/30 rounded-full px-2 py-0.5 flex-shrink-0">BROADCAST</span>
                              )}
                            </div>
                            {!a.resolved && (
                              <span className="text-[9px] font-bold text-amber-400 bg-amber-500/[0.10] border border-amber-500/30 rounded-full px-2 py-0.5 flex-shrink-0">
                                NOT FOUND
                              </span>
                            )}
                          </div>
                          <div className="space-y-1">
                            {a.changes.map((c, ci) => (
                              <p key={ci} className="text-[12px] text-[#b6b6c2] leading-relaxed">
                                <span className="mr-1.5">{c.icon}</span>{c.text}
                              </p>
                            ))}
                          </div>
                          {!a.resolved && (
                            <p className="text-[10px] text-amber-400/80 mt-1.5">
                              No member by this name — check spelling and resend.
                            </p>
                          )}
                        </button>
                      ))}

                      {/* Apply */}
                      {!m.applied && m.actions.some(a => a.on && a.resolved) && (
                        <button onClick={() => applyAll(mi)}
                          disabled={applying}
                          style={{ minHeight: 48 }}
                          className="w-full rounded-xl text-sm font-bold bg-gradient-to-r from-[#D4AF37] to-[#6344e8] text-white hover:from-[#8b6dff] hover:to-[#D4AF37] active:scale-[0.98] shadow-[0_2px_16px_rgba(212,175,55,0.4)] transition-all disabled:opacity-60">
                          {applying
                            ? 'Applying…'
                            : `Apply changes for ${m.actions.filter(a => a.on && a.resolved).length} ${plural(m.actions.filter(a => a.on && a.resolved).length, 'member')}`}
                        </button>
                      )}

                      {/* Results */}
                      {m.applied && (
                        <div className="bg-emerald-500/[0.08] border border-emerald-500/25 rounded-xl px-3.5 py-3 space-y-1.5">
                          <p className="text-[13px] font-bold text-emerald-400">✓ Applied</p>
                          {(m.results || []).map((r, ri) => (
                            <p key={ri} className={`text-[11px] leading-relaxed ${r.ok ? 'text-[#b6b6c2]' : 'text-red-300'}`}>
                              {r.ok ? '✓' : '✗'} <span className="font-semibold">{r.member_name}</span>
                              {r.detail ? ` — ${r.detail}` : ''}
                            </p>
                          ))}
                          <p className="text-[10px] text-[#4e4e5c] pt-0.5">
                            Members see protocol changes on next app open · logged in Audit
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="bg-[#16161c] border border-white/[0.07] rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Suggestion chips ── */}
      {messages.length === 0 && (
        <div className="px-4 pb-2 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {SUGGESTION_CHIPS.map((chip, i) => (
            <button key={i}
              onClick={() => {
                if (chip.endsWith(' ')) { setInput(chip); inputRef.current?.focus(); }
                else send(chip);
              }}
              style={{ whiteSpace: 'nowrap', flexShrink: 0, minHeight: 36 }}
              className="text-xs bg-[#1A1C20] border border-white/[0.10] hover:border-[rgba(212,175,55,0.4)] rounded-full px-3.5 py-1.5 text-[#b6b6c2] transition-colors">
              {chip.trim()}{chip.endsWith(' ') ? '…' : ''}
            </button>
          ))}
        </div>
      )}

      {/* ── Input bar ── */}
      <div className="px-4 py-3 border-t border-white/[0.06] bg-[#111116]"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        {vc.card}
        <div className="flex items-end gap-2">
          <div className="flex-1 flex items-center bg-[#1A1C20] border border-white/[0.10] rounded-2xl px-3">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              placeholder="Ask or instruct — &quot;how many calories has Padmini eaten?&quot;"
              className="flex-1 bg-transparent text-sm text-white placeholder-[#4e4e5c] py-3 outline-none min-w-0"
            />
            {vc.micButton}
            {/* Attach a diet plan. Sits beside the mic because both are ways of
                saying the same thing — one spoken, one on paper. */}
            <label
              style={{ minWidth: 40, minHeight: 40 }}
              title="Attach a diet plan (PDF or photo)"
              className={`flex items-center justify-center rounded-full flex-shrink-0 cursor-pointer
                transition-colors ${busy ? 'text-[#4e4e5c]' : 'text-[#9EA3B0] hover:text-[#E8CE7A]'}`}>
              <input type="file" accept="application/pdf,image/*" className="hidden" disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; sendDoc(f); }} />
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21.4 11.1l-8.5 8.5a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.9-7.8" />
              </svg>
            </label>
          </div>
          <button
            onClick={() => send()}
            disabled={!input.trim() || busy}
            style={{ minWidth: 48, minHeight: 48 }}
            className={`flex items-center justify-center rounded-full transition-all flex-shrink-0 ${
              input.trim() && !busy
                ? 'bg-[#D4AF37] text-[#121316] shadow-[0_2px_12px_rgba(212,175,55,0.4)] active:scale-95'
                : 'bg-white/[0.05] text-[#4e4e5c]'
            }`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
