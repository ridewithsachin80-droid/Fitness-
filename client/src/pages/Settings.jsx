import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore }    from '../store/authStore';
import { getSubscriptions, unsubscribePush, logout as apiLogout } from '../api/logs';
import { Card, SectionTitle, BackButton } from '../components/UI';

export default function Settings() {
  const navigate       = useNavigate();
  const { user, logout } = useAuthStore();
  const [subs,   setSubs]    = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSubscriptions()
      .then(r => setSubs(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
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
    logout();
  };

  return (
    <div className="min-h-screen bg-stone-100">
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

        {/* Logout */}
        <button onClick={handleLogout}
          className="w-full py-3.5 bg-white border border-red-200 text-red-600 font-semibold
            rounded-2xl hover:bg-red-50 transition-colors text-sm shadow-card">
          Sign Out
        </button>

        <p className="text-center text-xs text-stone-300 pt-2">
          Health Monitor · Sprint build in progress
        </p>
      </div>
    </div>
  );
}
