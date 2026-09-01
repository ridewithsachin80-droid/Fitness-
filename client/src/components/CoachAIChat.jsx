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
export function CoachAIFab({ bottomOffset = 40 }) {
  const openChat = useCoachAI(s => s.openChat);
  const open     = useCoachAI(s => s.open);
  if (open) return null;
  return (
    <button
      onClick={openChat}
      aria-label="Coach AI"
      className="fixed z-40 flex items-center justify-center bg-gradient-to-br from-[#D4AF37] to-[#8a6a1e] shadow-[0_4px_20px_rgba(212,175,55,0.45)] border border-r-0 border-white/[0.15] active:scale-95 transition-transform"
      style={{
        right: 0,
        bottom: `calc(${bottomOffset}px + env(safe-area-inset-bottom))`,
        width: 46, height: 52,
        borderTopLeftRadius: 16, borderBottomLeftRadius: 16,
        paddingRight: 2, fontSize: 20,
      }}>
      ✨
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
                    <p className="text-[10px] font-bold uppercase tracking-[0.10em] text-[#D4AF37] mb-1.5">
                      {m.answeredFor}
                    </p>
                  )}
                  {m.summary
                    ? <DaySummary s={m.summary} />
                    : <p className="leading-relaxed whitespace-pre-line">{m.text}</p>}

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
