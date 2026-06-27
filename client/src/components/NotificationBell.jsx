/**
 * NotificationBell.jsx
 *
 * Patient-facing notification history. Reads from notifications_log via
 * /api/reminders/my-notifications — this is the in-app record of every
 * reminder the server attempted to send, independent of whether the device
 * actually displayed it. That distinction matters: push notifications can be
 * silently swallowed by the OS (Android's per-app notification toggle,
 * revoked browser permission, a stale service worker, etc.) with zero error
 * surfacing anywhere — this gives the patient a way to see "yes, your coach
 * did send a reminder" even when the push itself never showed up.
 */
import { useState, useEffect, useRef } from 'react';
import { getMyNotifications, markNotificationsRead } from '../api/logs';

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
  const [items, setItems]         = useState([]);
  const [unreadCount, setUnread]  = useState(0);
  const [loading, setLoading]     = useState(false);
  const panelRef = useRef(null);

  const load = async () => {
    try {
      const { data } = await getMyNotifications();
      setItems(data.notifications || []);
      setUnread(data.unreadCount || 0);
    } catch { /* non-fatal — bell just stays at its current state */ }
  };

  // Load once on mount so the unread badge is correct even before opening
  useEffect(() => { load(); }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await load();
      setLoading(false);
      if (unreadCount > 0) {
        markNotificationsRead().catch(() => {});
        setUnread(0);
      }
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button onClick={toggle} aria-label="Notifications"
        className="relative w-9 h-9 rounded-full bg-white/[0.06] border border-white/[0.10]
          flex items-center justify-center hover:bg-white/[0.10] transition-colors">
        <svg className="w-4 h-4 text-[#d8d8de]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#d4af6a]
            text-[#08052a] text-[10px] font-bold flex items-center justify-center border-2 border-[#0d0b18]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 max-w-[88vw] bg-[#131317] border border-white/[0.08]
          rounded-2xl shadow-card-raised z-50 max-h-[70vh] overflow-y-auto">
          <div className="px-4 py-3 border-b border-white/[0.07] sticky top-0 bg-[#131317]">
            <span className="text-sm font-semibold text-[#ededf0]">Reminders sent to you</span>
          </div>
          {loading ? (
            <div className="px-4 py-8 text-center text-xs text-[#5a5a68]">Loading…</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-[#5a5a68]">
              No reminders yet. Your coach can set these up under Reminders.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {items.map(n => (
                <div key={n.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-[#d8d8de] leading-tight">{n.title}</span>
                    <span className="text-[10px] text-[#5a5a68] flex-shrink-0 mt-0.5 whitespace-nowrap">{timeAgo(n.sent_at)}</span>
                  </div>
                  <p className="text-xs text-[#9a9aa6] mt-1 leading-relaxed">{n.body}</p>
                  {n.failed && (
                    <span className="inline-block mt-1.5 text-[10px] font-semibold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
                      ⚠ Delivery failed — your coach may want to know
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
