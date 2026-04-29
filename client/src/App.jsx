import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import { useOfflineSync } from './hooks/useOfflineQueue';
import { disconnectSocket } from './hooks/useSync';
import { useAuthStore } from './store/authStore';
import { useSettingsStore, applyTheme, applyFontSize } from './store/settingsStore';

import Login          from './pages/Login';
import DailyLog       from './pages/DailyLog';
import Progress       from './pages/Progress';
import Profile        from './pages/Profile';
import Monitor        from './pages/Monitor';
import PatientList    from './pages/PatientList';
import Settings       from './pages/Settings';
import AdminDashboard from './pages/AdminDashboard';
import AdminFoods     from './pages/AdminFoods';
import Onboarding     from './components/Onboarding';

function PrivateRoute({ children, roles }) {
  const { user, isRestoring } = useAuthStore();
  if (isRestoring) {
    return (
      <div className="min-h-screen bg-[#0b0b0e] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#7c5cfc] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={user.role === 'patient' ? '/' : '/monitor'} replace />;
  }
  return children;
}

export default function App() {
  const { login, setRestored } = useAuthStore();
  const { theme, fontSize, ageMode, onboardingDone } = useSettingsStore();

  // Apply saved theme + font-size on boot
  useEffect(() => {
    applyTheme(theme);
    applyFontSize(ageMode === 'senior' ? 'large' : fontSize);
  }, []);

  // Listen for OS theme changes when set to 'system'
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  useEffect(() => {
    axios
      .post('/api/auth/refresh', {}, { withCredentials: true })
      .then(({ data }) => {
        const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
        login(data.accessToken, { id: payload.id, name: payload.name, role: payload.role });
      })
      .catch(() => { setRestored(); });
  }, []);

  const { user } = useAuthStore();
  useOfflineSync();

  // Show onboarding for logged-in patients who haven't completed it
  if (user?.role === 'patient' && !onboardingDone) {
    return <Onboarding />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<PrivateRoute roles={['patient']}><DailyLog /></PrivateRoute>} />
        <Route path="/progress" element={<PrivateRoute roles={['patient']}><Progress /></PrivateRoute>} />
        <Route path="/profile" element={<PrivateRoute roles={['patient']}><Profile /></PrivateRoute>} />
        <Route path="/monitor" element={<PrivateRoute roles={['monitor','admin']}><PatientList /></PrivateRoute>} />
        <Route path="/monitor/:patientId" element={<PrivateRoute roles={['monitor','admin']}><Monitor /></PrivateRoute>} />
        <Route path="/admin" element={<PrivateRoute roles={['admin']}><AdminDashboard /></PrivateRoute>} />
        <Route path="/admin/foods" element={<PrivateRoute roles={['admin']}><AdminFoods /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
        <Route path="*" element={
          <Navigate to={!user ? '/login' : user.role === 'patient' ? '/' : user.role === 'admin' ? '/admin' : '/monitor'} replace />
        } />
      </Routes>
    </BrowserRouter>
  );
}
