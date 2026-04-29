import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore }    from '../store/authStore';
import { getSubscriptions, unsubscribePush, logout as apiLogout, changePassword, getNotifLog } from '../api/logs';
import { disconnectSocket } from '../hooks/useSync';
import { Card, SectionTitle, BackButton } from '../components/UI';

export default function Settings() {
  const navigate       = useNavigate();
  const { user, logout } = useAuthStore();
  const [subs,     setSubs]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [notifLog, setNotifLog] = useState([]); // Sprint 12: notification history

  // Sprint 8: change password state (monitors/admins only)
  const [pwForm,   setPwForm]   = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError,  setPwError]  = useState('');
  const [pwOk,     setPwOk]     = useState(false);

  const setPw = (k, v) => setPwForm(f => ({ ...f, [k]: v }));

  const submitPw = async () => {
    if (!pwForm.current || !pwForm.next)  { setPwError('All fields are required'); return; }
    if (pwForm.next !== pwForm.confirm)   { setPwError('New passwords do not match'); return; }
    if (pwForm.next.length < 8)           { setPwError('New password must be at least 8 characters'); return; }
    setPwSaving(true); setPwError(''); setPwOk(false);
    try {
      await changePassword(pwForm.current, pwForm.next);
      setPwOk(true);
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (e) {
      setPwError(e.response?.data?.error || 'Failed to change password');
    } finally {
      setPwSaving(false);
    }
  };

  useEffect(() => {
    Promise.all([
      getSubscriptions().catch(() => ({ data: [] })),
      getNotifLog().catch(() => ({ data: [] })),
    ]).then(([subsRes, notifRes]) => {
      setSubs(subsRes.data || []);
      setNotifLog(notifRes.data || []);
    }).finally(() => setLoading(false));
  }, []);

  const removeSub = async (endpoint) => {
    try {
      await unsubscribePush(endpoint);
      setSubs(s => s.filter(sub => sub.endpoint !== endpoint));
    } catch (e) {
      console.error('Failed to unsubscribe', e);
    }
  };

  const handleLogout = async () => {
    try { await apiLogout(); } catch (_) {}
    disconnectSocket();
    logout();
  };

  return (
    <div className="min-h-screen bg-[#0b0b0e]">
      {/* Header */}
      <div className="bg-white border-b border-stone-100 px-4 pt-10 pb-4">
        <div className="max-w-md mx-auto">
          <BackButton onClick={() => navigate(-1)} />
          <h1 className="text-xl font-bold text-stone-800 mt-2">Settings</h1>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pt-4 pb-8 space-y-3">

        {/* Account */}
        <Card>
          <SectionTitle icon="👤">Account</SectionTitle>
          <div className="space-y-2">
            {[
              { label: 'Name', value: user?.name },
              { label: 'Role', value: user?.role },
              { label: 'ID',   value: `#${user?.id}` },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-1.5">
                <span className="text-sm text-stone-500">{label}</span>
                <span className="text-sm font-semibold text-stone-800 capitalize">{value}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Push subscriptions */}
        <Card>
          <SectionTitle icon="🔔">Push Notifications</SectionTitle>
          {loading ? (
            <p className="text-xs text-stone-400 py-2">Loading…</p>
          ) : subs.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-stone-400">No active subscriptions</p>
              <p className="text-xs text-stone-300 mt-1">
                Notifications are registered automatically when you open the app
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {subs.map(sub => (
                <div key={sub.id} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-stone-700">
                      {sub.device_name || 'Unknown device'}
                    </p>
                    <p className="text-xs text-stone-400">
                      Added {new Date(sub.created_at).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                  <button onClick={() => removeSub(sub.endpoint)}
                    className="text-xs text-red-400 hover:text-red-600 font-medium px-2 py-1 hover:bg-red-50 rounded-lg transition-colors">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Cron schedule info */}
        {user?.role === 'patient' && (
          <Card>
            <SectionTitle icon="⏰">Reminder Schedule (IST)</SectionTitle>
            <div className="space-y-2">
              {[
                { time: '6:25 AM',  label: 'Morning weight reminder' },
                { time: '9:40 AM',  label: 'ACV before Meal 1' },
                { time: '1:15 PM',  label: 'ACV before Meal 2' },
                { time: '5:15 PM',  label: 'ACV before Meal 3' },
                { time: '2:00 PM',  label: 'Water check (if below 1.5L)' },
              ].map(({ time, label }) => (
                <div key={time} className="flex items-center gap-3 py-1">
                  <span className="text-xs font-bold text-stone-500 w-16 flex-shrink-0">{time}</span>
                  <span className="text-xs text-stone-600">{label}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Sprint 8: Change password — monitors and admins only */}
        {(user?.role === 'monitor' || user?.role === 'admin') && (
          <Card>
            <SectionTitle icon="🔐">Change Password</SectionTitle>
            <div className="space-y-3">
              {[
                { key: 'current', label: 'Current password', placeholder: 'Your current password' },
                { key: 'next',    label: 'New password',     placeholder: 'Min. 8 characters' },
                { key: 'confirm', label: 'Confirm new',      placeholder: 'Repeat new password' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-stone-400 mb-1">{label}</label>
                  <input
                    type="password"
                    value={pwForm[key]}
                    onChange={e => setPw(key, e.target.value)}
                    placeholder={placeholder}
                    onKeyDown={e => e.key === 'Enter' && submitPw()}
                    className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm
                      focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800"
                  />
                </div>
              ))}

              {pwError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-xl">
                  {pwError}
                </p>
              )}
              {pwOk && (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-xl font-medium">
                  ✓ Password changed successfully
                </p>
              )}

              <button
                onClick={submitPw}
                disabled={pwSaving || !pwForm.current || !pwForm.next || !pwForm.confirm}
                className="w-full py-2.5 bg-[#0e0e12] hover:bg-[#08080b] text-white font-semibold
                  rounded-xl text-sm transition-colors disabled:opacity-40"
              >
                {pwSaving ? 'Saving…' : 'Update Password'}
              </button>
            </div>
          </Card>
        )}

        {/* Sprint 12: Notification history */}
        {notifLog.length > 0 && (
          <Card>
            <SectionTitle icon="🔔">Notification History</SectionTitle>
            <p className="text-xs text-stone-400 mb-3">Last {notifLog.length} notifications received</p>
            <div className="space-y-2">
              {notifLog.map(n => {
                const typeIcon = {
                  weight: '⚖️', acv: '🍶', water: '💧',
                  supplement: '💊', no_log: '📋', admin: '📨',
                }[n.type] || '🔔';
                const timeAgo = (() => {
                  const diff = Date.now() - new Date(n.sent_at).getTime();
                  const mins = Math.floor(diff / 60000);
                  const hrs  = Math.floor(mins / 60);
                  const days = Math.floor(hrs / 24);
                  if (days > 0)  return `${days}d ago`;
                  if (hrs > 0)   return `${hrs}h ago`;
                  if (mins > 0)  return `${mins}m ago`;
                  return 'just now';
                })();
                return (
                  <div key={n.id}
                    className={`rounded-2xl px-4 py-3 border ${n.failed
                      ? 'bg-red-50 border-red-100'
                      : 'bg-stone-50 border-stone-100'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <span className="text-base flex-shrink-0 mt-0.5">{typeIcon}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-stone-700 truncate">{n.title}</p>
                          <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">{n.body}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-xs text-stone-400">{timeAgo}</span>
                        {n.failed && (
                          <span className="text-xs text-red-500 font-medium">Failed</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Logout */}
        <button onClick={handleLogout}
          className="w-full py-3.5 bg-white border border-red-200 text-red-600 font-semibold
            rounded-2xl hover:bg-red-50 transition-colors text-sm shadow-card">
          Sign Out
        </button>

        <p className="text-center text-xs text-stone-300 pt-2">
          FitLife · Sprint 12
        </p>
      </div>
    </div>
  );
}
