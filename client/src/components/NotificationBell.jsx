/**
 * NotificationBell.jsx
 *
 * Member-facing notification history. Reads from notifications_log via
 * /api/reminders/my-notifications — this is the in-app record of every
 * reminder the server attempted to send, independent of whether the device
 * actually displayed it. That distinction matters: push notifications can be
 * silently swallowed by the OS (Android's per-app notification toggle,
 * revoked browser permission, a stale service worker, etc.) with zero error
 * surfacing anywhere — this gives the member a way to see "yes, your coach
 * did send a reminder" even when the push itself never showed up.
 */
import { useState, useEffect, useRef } from 'react';
import { getMyNotifications, markNotificationsRead } from '../api/logs';
import { getMyProfile } from '../api/logs';
import Sheet from './primitives/Sheet';

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function NotificationBell() {
  const [open, setOpen]           = useState(false);
  const [tab, setTab]             = useState('messages');  // 'messages' | 'reminders'
  const [messages, setMessages]   = useState([]);
  const [items, setItems]         = useState([]);
  const [unreadCount, setUnread]  = useState(0);
  const [loading, setLoading]     = useState(false);
  const [errors, setErrors] = useState({});
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState('');
  const busy = useRef(false);
  const load = async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    const nextErrors = {};
    await Promise.all([
      getMyNotifications().then(({ data }) => {
        setItems(data.notifications || []);
        setUnread(data.unreadCount || 0);
      }).catch(() => { nextErrors.reminders = "Couldn't refresh reminders. Try again."; }),
      getMyProfile().then(({ data }) => setMessages(data?.coach_notes || []))
        .catch(() => { nextErrors.messages = "Couldn't refresh coach messages. Try again."; }),
    ]);
    setErrors(nextErrors);
    setLoading(false);
    busy.current = false;
  };
  useEffect(() => { load(); }, []);
  const toggle = () => { setOpen(true); setMarkError(''); load(); };
  const markRead = async () => {
    if (busy.current) return;
    busy.current = true;
    setMarking(true);
    setMarkError('');
    try { await markNotificationsRead(); setUnread(0); }
    catch { setMarkError("Couldn't mark reminders as read. Try again."); }
    finally { busy.current = false; setMarking(false); }
  };

  return (
    <div className="relative">
      <button onClick={toggle} aria-label="Notifications" aria-haspopup="dialog" aria-expanded={open}
        className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-all ${
          unreadCount > 0
            ? 'bg-gold shadow-glow'
            : 'bg-white/[0.08] border border-white/[0.14] hover:bg-white/[0.14]'
        }`}>
        {unreadCount > 0 && (
          <span className="absolute inset-0 rounded-full bg-gold animate-ping opacity-40" />
        )}
        <svg className={`relative w-5 h-5 ${unreadCount > 0 ? 'text-white' : 'text-soft'}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1 rounded-full bg-gold
            text-charcoal text-xs font-bold flex items-center justify-center border-2 border-surface z-10">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Notifications">
          <p className="text-xs text-dim mb-3">Coach messages and reminders, all in one place.</p>
          <div className="flex gap-1 p-1.5 border-b border-hair sticky top-0 bg-charcoal z-10">
            {[['messages', `Messages${messages.length ? ` (${messages.length})` : ''}`], ['reminders', 'Reminders']].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}
                className={`flex-1 min-h-[44px] py-2 rounded-lg text-xs font-bold transition-colors ${
                  tab === k ? 'bg-gold text-charcoal' : 'text-dim hover:text-mid'
                }`}>{label}</button>
            ))}
          </div>

          {loading && <p role="status" className="py-3 text-sm text-dim">Refreshing…</p>}
          {errors[tab] && <div role="alert" className="py-3 text-sm text-danger">
            <p>{errors[tab]}</p><button disabled={loading || marking} onClick={load} className="min-h-[44px] underline">Try again</button>
          </div>}
          {tab === 'reminders' && unreadCount > 0 && <button onClick={markRead}
            disabled={loading || marking || !!errors.reminders}
            className="min-h-[44px] text-sm text-gold-deep disabled:opacity-50">
            {marking ? 'Marking…' : 'Mark all reminders as read'}
          </button>}
          {tab === 'reminders' && markError && <p role="alert" className="text-sm text-danger">{markError}</p>}
          {tab === 'messages' && (
            messages.length === 0 ? (!loading && !errors.messages && (
              <div className="px-4 py-8 text-center text-xs text-dim">
                No messages from your coach yet.
              </div>
            )) : (
              <div className="divide-y divide-white/[0.06]">
                {messages.map(m => (
                  <div key={m.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {m.flagged && (
                          <span className="text-tiny font-bold text-amber-300 bg-amber-400/10 border border-amber-400/25 px-1.5 py-0.5 rounded-full">
                            ⚠ ACTION
                          </span>
                        )}
                        <span className="text-caption font-semibold text-soft">{m.monitor_name}</span>
                        {!m.read_at && (
                          <span className="w-1.5 h-1.5 rounded-full bg-gold" title="Unread" />
                        )}
                      </div>
                      <span className="text-eyebrow text-dim flex-shrink-0 whitespace-nowrap">
                        {new Date(m.note_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                    <p className="text-xs text-mid leading-relaxed whitespace-pre-wrap break-words">{m.note}</p>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'reminders' && (items.length === 0 ? (!loading && !errors.reminders && (
            <div className="px-4 py-8 text-center text-xs text-dim">
              No reminders yet. They will appear here when available.
            </div>
          )) : (
            <div className="divide-y divide-white/[0.06]">
              {items.map(n => (
                <div key={n.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-words text-sm font-medium text-soft leading-tight">{n.title}</span>
                    <span className="text-eyebrow text-dim flex-shrink-0 mt-0.5 whitespace-nowrap">{timeAgo(n.sent_at)}</span>
                  </div>
                  <p className="break-words text-xs text-mid mt-1 leading-relaxed">{n.body}</p>
                  {/* There used to be a red "Delivery failed — your coach may
                      want to know" badge here, shown to the MEMBER.
                      Two things wrong with it:
                      1. `failed` means the PUSH transport was rejected — the
                         member had no subscription, or a stale one. It is our
                         plumbing, not their problem, and there is nothing they
                         can do about it.
                      2. It appeared underneath a message they were, at that
                         moment, reading. Telling someone a message failed to
                         reach them while they read it is nonsense, and it
                         makes the app look broken when it is working.
                      The failure still matters — but to the COACH, on the
                      Morning messages card, which is where it now lives. */}
                </div>
              ))}
            </div>
          ))}
      </Sheet>
    </div>
  );
}
