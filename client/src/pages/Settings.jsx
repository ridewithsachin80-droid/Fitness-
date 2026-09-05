import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore, haptic } from '../store/settingsStore';
import api from '../api/client';
import { getSubscriptions, unsubscribePush, logout as apiLogout, changePassword, getNotifLog } from '../api/logs';
import { disconnectSocket } from '../hooks/useSync';
import { Card, SectionTitle, BackButton, MemberBottomNav, BottomNav } from '../components/UI';
import VoiceLogging from '../components/VoiceLogging';
import { roleLabel } from '../constants';
import { changeMyPin, getMyReminderSchedule } from '../api/logs';
import { pushPermission, registerPushSubscription } from '../hooks/usePush';


const AVATARS = ['🐶','🐱','🦊','🐻','🦁','🐼','🐸','🦋','🌟','🎈','🌈','🦄'];
const AGE_MODES = [
  { id: 'child',  label: 'Child (5–17)',   emoji: '🌟' },
  { id: 'adult',  label: 'Adult (18–59)',  emoji: '💪' },
  { id: 'senior', label: 'Senior (60+)',   emoji: '🌿' },
];
const DEFAULT_MEALS = ['Breakfast', 'Lunch', 'Dinner'];
const MEAL_OPTIONS  = ['Breakfast', 'Morning Snack', 'Lunch', 'Afternoon Snack', 'Dinner', 'Bedtime Snack'];

export default function Settings() {
  // Which channels may reach this member. Opting out is deliberately separate
  // from the individual toggles — see the note by the switch below.
  const [notif, setNotif] = useState(null);
  const [notifBusy, setNotifBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api.get('/members/me/notifications')
      .then(({ data }) => { if (!cancelled) setNotif(data); })
      .catch(() => {});   // coaches have no such preferences; card stays hidden
    return () => { cancelled = true; };
  }, []);

  const saveNotif = async (patch) => {
    setNotifBusy(true);
    const optimistic = { ...notif, ...patch };
    setNotif(optimistic);
    try {
      const { data } = await api.put('/members/me/notifications', patch);
      setNotif(data);
    } catch {
      setNotif(notif);            // roll back rather than show a lie
    } finally { setNotifBusy(false); }
  };
  const { user, logout } = useAuthStore();
  const {
    ageMode, setAgeMode,
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
        <p className="text-sm text-[#FFFFFF] font-medium">{label}</p>
        {sub && <p className="text-xs text-[#7E8596]">{sub}</p>}
      </div>
      <button onClick={() => { onChange(!value); haptic(15); }}
        style={{ width: 48, height: 28, borderRadius: 14, background: value ? '#D4AF37' : 'rgba(255,255,255,0.1)', transition: 'all .2s', position: 'relative', border: 'none', cursor: 'pointer' }}>
        <div style={{ width: 22, height: 22, borderRadius: 11, background: '#fff', position: 'absolute', top: 3, left: value ? 23 : 3, transition: 'left .2s' }} />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#121316]">
      <div className="bg-[#1A1C20] border-b border-white/[0.07] px-4 pt-10 pb-4">
        <div className="max-w-md mx-auto">
          <BackButton onClick={() => navigate(-1)} />
          <h1 className="font-display text-xl font-medium text-[#FFFFFF] mt-2">Settings</h1>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pt-4 pb-32 space-y-3">

        {/* ── Appearance ─────────────────────────────────────────── */}
        {notif && (
          <Card>
            <SectionTitle icon="🔔" tooltip="How your coach can reach you when you are not in the app">
              How we reach you
            </SectionTitle>

            {notif.opted_out ? (
              <div className="mt-2">
                <p className="text-sm text-[#9EA3B0] leading-relaxed mb-3">
                  You have turned off all messages. Your coach can still see your logs,
                  but cannot send you reminders or your weekly summary.
                </p>
                <button onClick={() => { haptic(15); saveNotif({ opted_out: false }); }}
                  disabled={notifBusy} style={{ minHeight: 44 }}
                  className="w-full rounded-xl text-sm font-bold text-[#121316]
                    bg-gradient-to-r from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37]">
                  Turn messages back on
                </button>
              </div>
            ) : (
              <>
                <div className="mt-2 space-y-1">
                  {[
                    ['push', 'App notifications', 'Free, and only on this device'],
                    ['whatsapp', 'WhatsApp', 'Reminders and your weekly summary'],
                    ['sms', 'SMS', 'For when you have no internet'],
                  ].map(([key, label, sub]) => (
                    <label key={key}
                      className="flex items-center justify-between gap-3 py-2.5 border-b border-white/[0.06] last:border-0">
                      <span className="min-w-0">
                        <span className="block text-sm text-[#FFFFFF]">{label}</span>
                        <span className="block text-[11px] text-[#7E8596]">{sub}</span>
                      </span>
                      <button
                        role="switch" aria-checked={!!notif[key]} aria-label={label}
                        onClick={() => { haptic(12); saveNotif({ [key]: !notif[key] }); }}
                        disabled={notifBusy}
                        style={{ width: 46, height: 28 }}
                        className={`rounded-full flex-shrink-0 transition-colors relative ${
                          notif[key] ? 'bg-[#D4AF37]' : 'bg-white/[0.12]'}`}>
                        <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${
                          notif[key] ? 'left-[22px]' : 'left-1'}`} />
                      </button>
                    </label>
                  ))}
                </div>

                <button onClick={() => { haptic(15); saveNotif({ opted_out: true }); }}
                  disabled={notifBusy}
                  className="text-[11px] text-[#7E8596] underline mt-3">
                  Stop all messages
                </button>
              </>
            )}
          </Card>
        )}

        {/* Members only — a coach has no day to log by voice. */}
        {user?.role === 'patient' && <VoiceLogging />}

        <Card>
          <SectionTitle icon="🎨">Appearance</SectionTitle>

          {/* Font size */}
          <div className="mb-4">
            <p className="text-xs text-[#6a6a78] mb-2 font-medium tracking-wider">Text size</p>
            <div className="flex gap-2">
              {[['normal','Aa','Normal'],['large','AA','Large']].map(([id, sample, label]) => (
                <button key={id} onClick={() => { setFontSize(id); haptic(15); }}
                  style={{ minHeight: 52, flex: 1 }}
                  className={`rounded-xl border flex items-center justify-center gap-2 py-2 transition-all ${
                    fontSize === id ? 'border-[rgba(212,175,55,0.5)] bg-[rgba(212,175,55,0.1)]' : 'border-white/[0.07] bg-[#1A1C20]'}`}>
                  <span style={{ fontSize: id === 'large' ? 20 : 14, fontWeight: 700, color: '#FFFFFF' }}>{sample}</span>
                  <span className="text-xs text-[#9EA3B0]">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Nutrition view */}
          <div>
            <p className="text-xs text-[#6a6a78] mb-2 font-medium tracking-wider">Nutrition display</p>
            <div className="flex gap-2">
              {[['simple','🚦','Simple — traffic lights'],['detailed','🔬','Detailed — all numbers']].map(([id, emoji, label]) => (
                <button key={id} onClick={() => { setNutritionView(id); haptic(15); }}
                  style={{ minHeight: 52, flex: 1 }}
                  className={`rounded-xl border flex items-center justify-center gap-2 py-2 px-2 transition-all ${
                    nutritionView === id ? 'border-[rgba(212,175,55,0.5)] bg-[rgba(212,175,55,0.1)]' : 'border-white/[0.07] bg-[#1A1C20]'}`}>
                  <span style={{ fontSize: 16 }}>{emoji}</span>
                  <span className="text-xs text-[#FFFFFF] font-medium leading-tight">{label}</span>
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
                  ageMode === m.id ? 'border-[rgba(212,175,55,0.5)] bg-[rgba(212,175,55,0.1)]' : 'border-white/[0.07] bg-[#1A1C20]'}`}>
                <span style={{ fontSize: 22 }}>{m.emoji}</span>
                <span className="text-xs font-semibold text-[#FFFFFF] text-center leading-tight">{m.label}</span>
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
                  border: avatarIdx === i ? '2px solid #D4AF37' : '2px solid transparent',
                  background: avatarIdx === i ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.04)',
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
                    ? 'border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.06)]'
                    : 'border-white/[0.07] bg-[#1A1C20]'}`}>
                <div style={{ width: 18, height: 18, borderRadius: 5, border: '2px solid', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderColor: localMeals.includes(m) ? '#D4AF37' : 'rgba(255,255,255,0.2)',
                  background: localMeals.includes(m) ? '#D4AF37' : 'transparent' }}>
                  {localMeals.includes(m) && <span style={{ fontSize: 10, color: '#fff', fontWeight: 700 }}>✓</span>}
                </div>
                <span className="text-sm text-[#FFFFFF] font-medium">{m}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* ── Safety ─────────────────────────────────────────────── */}
        <Card>
          <SectionTitle icon="🛡️">Safety contacts</SectionTitle>
          <p className="text-xs text-[#7E8596] mb-3">Stored on this device only. Not sent anywhere automatically.</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-[#6a6a78] font-medium mb-1">Emergency contact name</label>
              <input value={ecName} onChange={e => setEcName(e.target.value)} placeholder="e.g. Ravi Kumar"
                className="w-full border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(212,175,55,0.3)]" />
            </div>
            <div>
              <label className="block text-xs text-[#6a6a78] font-medium mb-1">Emergency contact phone</label>
              <input value={ecPhone} onChange={e => setEcPhone(e.target.value)} placeholder="+91 98765 43210" type="tel"
                className="w-full border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(212,175,55,0.3)]" />
            </div>
            {ageMode === 'child' && (
              <div>
                <label className="block text-xs text-[#6a6a78] font-medium mb-1">Parent / Guardian email</label>
                <input value={guarEmail} onChange={e => setGuarEmail(e.target.value)} placeholder="parent@example.com" type="email"
                  className="w-full border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(212,175,55,0.3)]" />
                <p className="text-xs text-[#7E8596] mt-1">Used only to share your daily log with a parent. Not sent automatically by the app — you must share it manually.</p>
              </div>
            )}
            <button onClick={saveEC}
              style={{ minHeight: 44 }}
              className="w-full py-2.5 bg-[rgba(212,175,55,0.15)] hover:bg-[rgba(212,175,55,0.25)] text-[#F0E2B6] font-semibold rounded-xl text-sm transition-all border border-[rgba(212,175,55,0.2)]">
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

        {/* ── Connected Devices ──────────────────────────────────── */}
        <button
          onClick={() => { navigate('/devices'); haptic(15); }}
          style={{ width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
        >
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 14px rgba(34,197,94,0.2)',
              }}>
                <svg width="22" height="22" viewBox="0 0 36 36" fill="none">
                  <ellipse cx="18" cy="18" rx="15" ry="9" stroke="#22c55e" strokeWidth="3.5" strokeLinecap="round" opacity="0.9" />
                  <ellipse cx="18" cy="18" rx="10" ry="5.5" stroke="#22c55e" strokeWidth="1.5" opacity="0.5" />
                  <circle cx="18" cy="18" r="2.5" fill="#22c55e" opacity="0.8" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 15, margin: 0 }}>Connected Devices</p>
                <p style={{ color: '#6a6a78', fontSize: 12, margin: '2px 0 0' }}>HART, Garmin, Apple Watch, Samsung &amp; more</p>
              </div>
              <span style={{ color: '#7E8596', fontSize: 18 }}>›</span>
            </div>
          </Card>
        </button>

        {/* ── Account ────────────────────────────────────────────── */}
        <Card>
          <SectionTitle icon="👤">Account</SectionTitle>
          <div className="space-y-2">
            {[{ label: 'Name', value: user?.name }, { label: 'Role', value: roleLabel(user?.role) }, { label: 'ID', value: `#${user?.id}` }].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-1.5">
                <span className="text-sm text-[#7E8596]">{label}</span>
                <span className="text-sm font-semibold text-[#FFFFFF] capitalize">{value}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Push notifications */}
        <Card>
          <SectionTitle icon="🔔">Push Notifications</SectionTitle>
          {/* Permission state first. "No active subscriptions" told a blocked
              member nothing about WHY nothing ever arrives, and gave them no
              way back — so the evening recap just silently never came. */}
          <PushStatus />

          {loading ? <p className="text-xs text-[#7E8596] py-2">Loading…</p> : subs.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-[#7E8596]">No devices registered yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {subs.map(sub => (
                <div key={sub.id} className="flex items-center justify-between py-2 border-b border-white/[0.05] last:border-0">
                  <div>
                    <p className="text-sm font-medium text-[#FFFFFF]">{sub.device_name || 'Unknown device'}</p>
                    <p className="text-xs text-[#7E8596]">Added {new Date(sub.created_at).toLocaleDateString('en-IN')}</p>
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

        {/* Reminder schedule — read from the server, not hardcoded */}
        {user?.role === 'patient' && (
          <Card>
            <SectionTitle icon="⏰">Reminder Schedule (IST)</SectionTitle>
            <ReminderSchedule />
          </Card>
        )}

        {/* Member: change your own PIN */}
        {user?.role === 'patient' && (
          <Card>
            <SectionTitle icon="🔑">Change PIN</SectionTitle>
            <ChangePin />
          </Card>
        )}

        {/* Change password */}
        {(user?.role === 'monitor' || user?.role === 'admin') && (
          <Card>
            <SectionTitle icon="🔐">Change Password</SectionTitle>
            <div className="space-y-3">
              {[['current','Current password','Your current password'],['next','New password','Min. 8 characters'],['confirm','Confirm new','Repeat new password']].map(([key, label, placeholder]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-[#7E8596] mb-1">{label}</label>
                  <input type="password" value={pwForm[key]} onChange={e => setPw(key, e.target.value)}
                    placeholder={placeholder} onKeyDown={e => e.key === 'Enter' && submitPw()}
                    className="w-full border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[rgba(212,175,55,0.3)]" />
                </div>
              ))}
              {pwError && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 px-3 py-2 rounded-xl">{pwError}</p>}
              {pwOk && <p className="text-xs text-[#F0E2B6] bg-[rgba(212,175,55,0.1)] border border-[rgba(212,175,55,0.2)] px-3 py-2 rounded-xl font-medium">✓ Password changed successfully</p>}
              <button onClick={submitPw} disabled={pwSaving || !pwForm.current || !pwForm.next || !pwForm.confirm}
                style={{ minHeight: 44 }}
                className="w-full py-2.5 bg-[#121316] hover:bg-[#121316] text-white font-semibold rounded-xl text-sm transition-colors disabled:opacity-40">
                {pwSaving ? 'Saving…' : 'Update Password'}
              </button>
            </div>
          </Card>
        )}

        {/* Logout */}
        <button onClick={handleLogout}
          style={{ minHeight: 52 }}
          className="w-full py-3.5 bg-[#1A1C20] border border-red-400/20 text-red-400 font-semibold rounded-2xl hover:bg-red-400/10 transition-colors text-sm">
          Sign Out
        </button>

        <p className="text-center text-xs text-[#4A4E5A] pt-2">FitLife · Enhanced UX</p>
      </div>

      {user?.role === 'patient' ? <MemberBottomNav /> : <BottomNav role={user?.role} />}
    </div>
  );
}


// ── Push permission status ────────────────────────────────────────────────────
// Three states worth distinguishing, because the fix differs for each:
//   granted     — working; nothing to do
//   default     — never asked; one tap fixes it
//   denied      — the browser is blocking us; only site settings can undo it,
//                 so say so plainly instead of leaving them guessing
//   unsupported — iOS Safari outside an installed PWA, mostly
function PushStatus() {
  const [perm, setPerm] = useState(() => pushPermission());
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    setBusy(true);
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p === 'granted') await registerPushSubscription();
    } catch (_) { /* leave state as-is */ }
    finally { setBusy(false); }
  };

  if (perm === 'granted') {
    return (
      <div className="flex items-center gap-2 mb-3 rounded-xl px-3 py-2
        border border-[rgba(212,175,55,0.20)] bg-[rgba(212,175,55,0.06)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] flex-shrink-0" />
        <p className="text-[11px] text-[#F0E2B6]">Notifications are on for this device.</p>
      </div>
    );
  }

  if (perm === 'denied') {
    return (
      <div className="mb-3 rounded-xl px-3 py-2.5 border border-amber-400/30 bg-amber-400/[0.08]">
        <p className="text-xs font-semibold text-amber-300">Notifications are blocked</p>
        <p className="text-[11px] text-[#9EA3B0] mt-1 leading-relaxed">
          Your browser is blocking them, so your evening recap and coach messages
          won't arrive. To turn them back on: tap the lock icon in the address
          bar (or Site settings), find Notifications, and switch it to Allow.
        </p>
      </div>
    );
  }

  if (perm === 'unsupported') {
    return (
      <p className="text-[11px] text-[#7E8596] mb-3 leading-relaxed">
        This browser doesn't support notifications. Add FitLife to your home
        screen and open it from there to enable them.
      </p>
    );
  }

  return (
    <div className="mb-3 rounded-xl px-3 py-2.5 border border-white/[0.08] bg-white/[0.03]">
      <p className="text-xs text-[#FFFFFF]">Notifications are off</p>
      <p className="text-[11px] text-[#9EA3B0] mt-0.5 leading-relaxed">
        Turn them on for your 8:30pm recap and messages from your coach.
      </p>
      <button onClick={enable} disabled={busy} style={{ minHeight: 36 }}
        className="mt-2 text-[11px] font-bold text-[#121316] rounded-lg px-3
          bg-gradient-to-r from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37]
          active:scale-[0.98] disabled:opacity-50">
        {busy ? 'Just a moment…' : 'Turn on notifications'}
      </button>
    </div>
  );
}


// ── Reminder schedule ─────────────────────────────────────────────────────────
// This list used to be five times hardcoded into the JSX. If a coach changed a
// reminder in the admin panel, the member's Settings kept showing the old one,
// and the 8:30pm evening recap was never listed at all — so members were being
// shown a schedule that did not match what actually arrived on their phone.
function ReminderSchedule() {
  const [items, setItems]     = useState(null);   // null = loading
  const [failed, setFailed]   = useState(false);

  useEffect(() => {
    getMyReminderSchedule()
      .then(({ data }) => setItems(data.items || []))
      .catch(() => setFailed(true));
  }, []);

  const pretty = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12  = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  if (failed) return <p className="text-xs text-[#7E8596] py-2">Couldn't load your reminder times.</p>;
  if (items === null) return <p className="text-xs text-[#7E8596] py-2">Loading…</p>;
  if (!items.length) {
    return (
      <p className="text-xs text-[#7E8596] py-2 leading-relaxed">
        No reminders set up yet. Your coach can add them for you.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={`${it.time}-${i}`} className="flex items-center gap-3 py-1">
          <span className="text-xs font-bold text-[#7E8596] w-16 flex-shrink-0">{pretty(it.time)}</span>
          <span className="text-xs text-[#9EA3B0] flex-1">{it.label}</span>
          {it.personal && (
            <span className="text-[9px] font-bold text-[#D4AF37] bg-[rgba(212,175,55,0.10)]
              border border-[rgba(212,175,55,0.25)] rounded-full px-2 py-0.5">
              just for you
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Change PIN ────────────────────────────────────────────────────────────────
// A member had no way to change their own PIN — Change Password was gated to
// coach and admin — so every rotation went through the coach on WhatsApp.
function ChangePin() {
  const [current, setCurrent] = useState('');
  const [next, setNext]       = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState(false);

  const digits = (v) => v.replace(/\D/g, '');
  const ready  = current.length >= 4 && next.length >= 4 && confirm.length >= 4;

  const submit = async () => {
    setError('');
    if (next !== confirm) { setError("The two new PINs don't match"); return; }
    if (next === current) { setError('That is already your PIN'); return; }
    setBusy(true);
    try {
      await changeMyPin(current, next);
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't change your PIN — try again.");
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="py-2">
        <p className="text-sm text-[#F0E2B6] font-medium">PIN changed ✓</p>
        <p className="text-xs text-[#9EA3B0] mt-1 leading-relaxed">
          Use your new PIN next time you log in. You're still signed in here.
        </p>
        <button onClick={() => setDone(false)} style={{ minHeight: 36 }}
          className="mt-2 text-[11px] font-bold text-[#D4AF37] px-1">
          Change it again
        </button>
      </div>
    );
  }

  const field = (label, value, setter, placeholder) => (
    <div>
      <label className="block text-[10px] font-semibold text-[#7E8596] mb-1.5">
        {label}
      </label>
      <input
        type="password" inputMode="numeric" value={value}
        onChange={(e) => setter(digits(e.target.value))}
        placeholder={placeholder} maxLength={12}
        className="w-full bg-[#121316] border border-white/[0.10] rounded-xl px-3 py-2.5
          text-sm text-white tracking-widest outline-none
          focus:border-[rgba(212,175,55,0.40)] focus:ring-2 focus:ring-[rgba(212,175,55,0.12)]"
      />
    </div>
  );

  return (
    <div className="space-y-3">
      {field('Current PIN', current, setCurrent, 'Your PIN now')}
      {field('New PIN', next, setNext, 'At least 4 digits')}
      {field('Confirm new PIN', confirm, setConfirm, 'Type it again')}
      {error && <p className="text-xs text-red-400 leading-relaxed">{error}</p>}
      <button onClick={submit} disabled={!ready || busy} style={{ minHeight: 40 }}
        className="w-full text-xs font-bold text-[#121316] rounded-xl
          bg-gradient-to-r from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37]
          active:scale-[0.98] disabled:opacity-40">
        {busy ? 'Saving…' : 'Change PIN'}
      </button>
      <p className="text-[11px] text-[#4A4E5A] leading-relaxed">
        Forgotten your current PIN? Your coach can reset it for you.
      </p>
    </div>
  );
}
