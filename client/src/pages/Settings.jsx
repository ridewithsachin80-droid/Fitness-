import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore, haptic } from '../store/settingsStore';
import { getSubscriptions, unsubscribePush, logout as apiLogout, changePassword, getNotifLog } from '../api/logs';
import { disconnectSocket } from '../hooks/useSync';
import { Card, SectionTitle, BackButton, PatientBottomNav, BottomNav } from '../components/UI';

const AVATARS = ['🐶','🐱','🦊','🐻','🦁','🐼','🐸','🦋','🌟','🎈','🌈','🦄'];
const AGE_MODES = [
  { id: 'child',  label: 'Child (5–17)',   emoji: '🌟' },
  { id: 'adult',  label: 'Adult (18–59)',  emoji: '💪' },
  { id: 'senior', label: 'Senior (60+)',   emoji: '🌿' },
];
const DEFAULT_MEALS = ['Breakfast', 'Lunch', 'Dinner'];
const MEAL_OPTIONS  = ['Breakfast', 'Morning Snack', 'Lunch', 'Afternoon Snack', 'Dinner', 'Bedtime Snack'];

export default function Settings() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const {
    ageMode, setAgeMode,
    theme, setTheme,
    fontSize, setFontSize,
    nutritionView, setNutritionView,
    guardianEmail, setGuardianEmail,
    emergencyContact, setEmergencyContact,
    mealSlots, setMealSlots,
    avatarIdx, setAvatarIdx,
  } = useSettingsStore();

  const [subs,     setSubs]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [notifLog, setNotifLog] = useState([]);
  const [pwForm,   setPwForm]   = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError,  setPwError]  = useState('');
  const [pwOk,     setPwOk]     = useState(false);
  const [localMeals, setLocalMeals] = useState(mealSlots);
  const [ecName,   setEcName]   = useState(emergencyContact?.name || '');
  const [ecPhone,  setEcPhone]  = useState(emergencyContact?.phone || '');
  const [guarEmail,setGuarEmail]= useState(guardianEmail || '');

  const setPw = (k, v) => setPwForm(f => ({ ...f, [k]: v }));

  const submitPw = async () => {
    if (!pwForm.current || !pwForm.next) { setPwError('All fields are required'); return; }
    if (pwForm.next !== pwForm.confirm)  { setPwError('New passwords do not match'); return; }
    if (pwForm.next.length < 8)          { setPwError('New password must be at least 8 characters'); return; }
    setPwSaving(true); setPwError(''); setPwOk(false);
    try { await changePassword(pwForm.current, pwForm.next); setPwOk(true); setPwForm({ current: '', next: '', confirm: '' }); }
    catch (e) { setPwError(e.response?.data?.error || 'Failed to change password'); }
    finally { setPwSaving(false); }
  };

  useEffect(() => {
    Promise.all([
      getSubscriptions().catch(() => ({ data: [] })),
      getNotifLog().catch(() => ({ data: [] })),
    ]).then(([s, n]) => { setSubs(s.data || []); setNotifLog(n.data || []); }).finally(() => setLoading(false));
  }, []);

  const removeSub = async (endpoint) => {
    try { await unsubscribePush(endpoint); setSubs(s => s.filter(sub => sub.endpoint !== endpoint)); } catch {}
  };

  const handleLogout = async () => {
    try { await apiLogout(); } catch {}
    disconnectSocket();
    logout();
  };

  const toggleMeal = (m) => {
    setLocalMeals(prev => {
      const next = prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m];
      const ordered = MEAL_OPTIONS.filter(o => next.includes(o));
      setMealSlots(ordered);
      return ordered;
    });
    haptic(15);
  };

  const saveEC = () => {
    setEmergencyContact({ name: ecName, phone: ecPhone });
    setGuardianEmail(guarEmail);
    haptic(25);
  };

  const Toggle = ({ value, onChange, label, sub }) => (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm text-[#d8d8de] font-medium">{label}</p>
        {sub && <p className="text-xs text-[#4e4e5c]">{sub}</p>}
      </div>
      <button onClick={() => { onChange(!value); haptic(15); }}
        style={{ width: 48, height: 28, borderRadius: 14, background: value ? '#7c5cfc' : 'rgba(255,255,255,0.1)', transition: 'all .2s', position: 'relative', border: 'none', cursor: 'pointer' }}>
        <div style={{ width: 22, height: 22, borderRadius: 11, background: '#fff', position: 'absolute', top: 3, left: value ? 23 : 3, transition: 'left .2s' }} />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0b0b0e]">
      <div className="bg-[#131317] border-b border-white/[0.07] px-4 pt-10 pb-4">
        <div className="max-w-md mx-auto">
          <BackButton onClick={() => navigate(-1)} />
          <h1 className="text-xl font-bold text-[#ededf0] mt-2">Settings</h1>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pt-4 pb-32 space-y-3">

        {/* ── Appearance ─────────────────────────────────────────── */}
        <Card>
          <SectionTitle icon="🎨">Appearance</SectionTitle>

          {/* Theme */}
          <div className="mb-4">
            <p className="text-xs text-[#6a6a78] mb-2 font-medium uppercase tracking-wider">Theme</p>
            <div className="flex gap-2">
              {[['dark','🌙','Dark'],['light','☀️','Light'],['system','🔄','Auto']].map(([id, emoji, label]) => (
                <button key={id} onClick={() => { setTheme(id); haptic(15); }}
                  style={{ minHeight: 56, flex: 1 }}
                  className={`rounded-xl border flex flex-col items-center justify-center gap-1 py-2 transition-all ${
                    theme === id ? 'border-[rgba(124,92,252,0.5)] bg-[rgba(124,92,252,0.1)]' : 'border-white/[0.07] bg-[#1a1a20]'}`}>
                  <span style={{ fontSize: 20 }}>{emoji}</span>
                  <span className="text-xs font-semibold text-[#d8d8de]">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Font size */}
          <div className="mb-4">
            <p className="text-xs text-[#6a6a78] mb-2 font-medium uppercase tracking-wider">Text size</p>
            <div className="flex gap-2">
              {[['normal','Aa','Normal'],['large','AA','Large']].map(([id, sample, label]) => (
                <button key={id} onClick={() => { setFontSize(id); haptic(15); }}
                  style={{ minHeight: 52, flex: 1 }}
                  className={`rounded-xl border flex items-center justify-center gap-2 py-2 transition-all ${
                    fontSize === id ? 'border-[rgba(124,92,252,0.5)] bg-[rgba(124,92,252,0.1)]' : 'border-white/[0.07] bg-[#1a1a20]'}`}>
                  <span style={{ fontSize: id === 'large' ? 20 : 14, fontWeight: 700, color: '#ededf0' }}>{sample}</span>
                  <span className="text-xs text-[#8e8e9a]">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Nutrition view */}
          <div>
            <p className="text-xs text-[#6a6a78] mb-2 font-medium uppercase tracking-wider">Nutrition display</p>
            <div className="flex gap-2">
              {[['simple','🚦','Simple — traffic lights'],['detailed','🔬','Detailed — all numbers']].map(([id, emoji, label]) => (
                <button key={id} onClick={() => { setNutritionView(id); haptic(15); }}
                  style={{ minHeight: 52, flex: 1 }}
                  className={`rounded-xl border flex items-center justify-center gap-2 py-2 px-2 transition-all ${
                    nutritionView === id ? 'border-[rgba(124,92,252,0.5)] bg-[rgba(124,92,252,0.1)]' : 'border-white/[0.07] bg-[#1a1a20]'}`}>
                  <span style={{ fontSize: 16 }}>{emoji}</span>
                  <span className="text-xs text-[#d8d8de] font-medium leading-tight">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* ── Age mode ───────────────────────────────────────────── */}
        <Card>
          <SectionTitle icon="👤" tooltip="Changes terminology, text size, and which features are shown">Who is using this app?</SectionTitle>
          <div className="flex gap-2">
            {AGE_MODES.map(m => (
              <button key={m.id} onClick={() => { setAgeMode(m.id); haptic(15); }}
                style={{ minHeight: 64, flex: 1 }}
                className={`rounded-xl border flex flex-col items-center justify-center gap-1 py-2 transition-all ${
                  ageMode === m.id ? 'border-[rgba(124,92,252,0.5)] bg-[rgba(124,92,252,0.1)]' : 'border-white/[0.07] bg-[#1a1a20]'}`}>
                <span style={{ fontSize: 22 }}>{m.emoji}</span>
                <span className="text-xs font-semibold text-[#d8d8de] text-center leading-tight">{m.label}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* ── Avatar ─────────────────────────────────────────────── */}
        <Card>
          <SectionTitle icon="😊">My avatar</SectionTitle>
          <div className="grid grid-cols-6 gap-2">
            {AVATARS.map((a, i) => (
              <button key={i} onClick={() => { setAvatarIdx(i); haptic(15); }}
                style={{
                  width: '100%', aspectRatio: '1', borderRadius: 12, fontSize: 24,
                  border: avatarIdx === i ? '2px solid #7c5cfc' : '2px solid transparent',
                  background: avatarIdx === i ? 'rgba(124,92,252,0.15)' : 'rgba(255,255,255,0.04)',
                  cursor: 'pointer', transition: 'all .15s',
                }}>{a}</button>
            ))}
          </div>
        </Card>

        {/* ── Meal slots ─────────────────────────────────────────── */}
        <Card>
          <SectionTitle icon="🍽" tooltip="Choose which meal slots appear in your daily food log">Meal slots</SectionTitle>
          <div className="space-y-1">
            {MEAL_OPTIONS.map(m => (
              <button key={m} onClick={() => toggleMeal(m)}
                style={{ minHeight: 44, width: '100%' }}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl border text-left transition-all ${
                  localMeals.includes(m)
                    ? 'border-[rgba(124,92,252,0.3)] bg-[rgba(124,92,252,0.06)]'
                    : 'border-white/[0.07] bg-[#1a1a20]'}`}>
                <div style={{ width: 18, height: 18, borderRadius: 5, border: '2px solid', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderColor: localMeals.includes(m) ? '#7c5cfc' : 'rgba(255,255,255,0.2)',
                  background: localMeals.includes(m) ? '#7c5cfc' : 'transparent' }}>
                  {localMeals.includes(m) && <span style={{ fontSize: 10, color: '#fff', fontWeight: 700 }}>✓</span>}
                </div>
                <span className="text-sm text-[#d8d8de] font-medium">{m}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* ── Safety ─────────────────────────────────────────────── */}
        <Card>
          <SectionTitle icon="🛡️">Safety contacts</SectionTitle>
          <p className="text-xs text-[#4e4e5c] mb-3">Stored on this device only. Not sent anywhere automatically.</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-[#6a6a78] font-medium mb-1">Emergency contact name</label>
              <input value={ecName} onChange={e => setEcName(e.target.value)} placeholder="e.g. Ravi Kumar"
                className="w-full border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.3)]" />
            </div>
            <div>
              <label className="block text-xs text-[#6a6a78] font-medium mb-1">Emergency contact phone</label>
              <input value={ecPhone} onChange={e => setEcPhone(e.target.value)} placeholder="+91 98765 43210" type="tel"
                className="w-full border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.3)]" />
            </div>
            {ageMode === 'child' && (
              <div>
                <label className="block text-xs text-[#6a6a78] font-medium mb-1">Parent / Guardian email</label>
                <input value={guarEmail} onChange={e => setGuarEmail(e.target.value)} placeholder="parent@example.com" type="email"
                  className="w-full border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.3)]" />
                <p className="text-xs text-[#4e4e5c] mt-1">Used only to share your daily log with a parent. Not sent automatically by the app — you must share it manually.</p>
              </div>
            )}
            <button onClick={saveEC}
              style={{ minHeight: 44 }}
              className="w-full py-2.5 bg-[rgba(124,92,252,0.15)] hover:bg-[rgba(124,92,252,0.25)] text-[#a78bfa] font-semibold rounded-xl text-sm transition-all border border-[rgba(124,92,252,0.2)]">
              Save safety contacts
            </button>
            {ecPhone && (
              <a href={`tel:${ecPhone}`}
                style={{ minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                className="w-full py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-semibold rounded-xl text-sm transition-all border border-red-500/20 text-center no-underline">
                📞 Call {ecName || 'Emergency Contact'}
              </a>
            )}
          </div>
        </Card>

        {/* ── Account ────────────────────────────────────────────── */}
        <Card>
          <SectionTitle icon="👤">Account</SectionTitle>
          <div className="space-y-2">
            {[{ label: 'Name', value: user?.name }, { label: 'Role', value: user?.role }, { label: 'ID', value: `#${user?.id}` }].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-1.5">
                <span className="text-sm text-[#4e4e5c]">{label}</span>
                <span className="text-sm font-semibold text-[#d8d8de] capitalize">{value}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Push notifications */}
        <Card>
          <SectionTitle icon="🔔">Push Notifications</SectionTitle>
          {loading ? <p className="text-xs text-[#4e4e5c] py-2">Loading…</p> : subs.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-[#4e4e5c]">No active subscriptions</p>
              <p className="text-xs text-[#3a3a46] mt-1">Notifications register automatically when you open the app</p>
            </div>
          ) : (
            <div className="space-y-2">
              {subs.map(sub => (
                <div key={sub.id} className="flex items-center justify-between py-2 border-b border-white/[0.05] last:border-0">
                  <div>
                    <p className="text-sm font-medium text-[#d8d8de]">{sub.device_name || 'Unknown device'}</p>
                    <p className="text-xs text-[#4e4e5c]">Added {new Date(sub.created_at).toLocaleDateString('en-IN')}</p>
                  </div>
                  <button onClick={() => removeSub(sub.endpoint)} style={{ minHeight: 36 }}
                    className="text-xs text-red-400 hover:text-red-300 font-medium px-2 py-1 hover:bg-red-400/10 rounded-lg transition-colors">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Reminder schedule */}
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
                  <span className="text-xs font-bold text-[#4e4e5c] w-16 flex-shrink-0">{time}</span>
                  <span className="text-xs text-[#8e8e9a]">{label}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Change password */}
        {(user?.role === 'monitor' || user?.role === 'admin') && (
          <Card>
            <SectionTitle icon="🔐">Change Password</SectionTitle>
            <div className="space-y-3">
              {[['current','Current password','Your current password'],['next','New password','Min. 8 characters'],['confirm','Confirm new','Repeat new password']].map(([key, label, placeholder]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-[#4e4e5c] mb-1">{label}</label>
                  <input type="password" value={pwForm[key]} onChange={e => setPw(key, e.target.value)}
                    placeholder={placeholder} onKeyDown={e => e.key === 'Enter' && submitPw()}
                    className="w-full border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.3)]" />
                </div>
              ))}
              {pwError && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 px-3 py-2 rounded-xl">{pwError}</p>}
              {pwOk && <p className="text-xs text-[#a78bfa] bg-[rgba(124,92,252,0.1)] border border-[rgba(124,92,252,0.2)] px-3 py-2 rounded-xl font-medium">✓ Password changed successfully</p>}
              <button onClick={submitPw} disabled={pwSaving || !pwForm.current || !pwForm.next || !pwForm.confirm}
                style={{ minHeight: 44 }}
                className="w-full py-2.5 bg-[#0e0e12] hover:bg-[#08080b] text-white font-semibold rounded-xl text-sm transition-colors disabled:opacity-40">
                {pwSaving ? 'Saving…' : 'Update Password'}
              </button>
            </div>
          </Card>
        )}

        {/* Logout */}
        <button onClick={handleLogout}
          style={{ minHeight: 52 }}
          className="w-full py-3.5 bg-[#131317] border border-red-400/20 text-red-400 font-semibold rounded-2xl hover:bg-red-400/10 transition-colors text-sm">
          Sign Out
        </button>

        <p className="text-center text-xs text-[#3a3a46] pt-2">FitLife · Enhanced UX</p>
      </div>

      {user?.role === 'patient' ? <PatientBottomNav /> : <BottomNav role={user?.role} />}
    </div>
  );
}
