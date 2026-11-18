import { useEffect, useRef, useState } from 'react';

// A network signal is only a reason to retry, never proof of authentication.
// Listen while mounted, but retry only a failed operation. Coalesce the online,
// focus and visibility events browsers often send together on app resume.
export function useConnectionRecovery(failed, retry) {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const current = useRef({ failed, retry });
  const lastAttempt = useRef(-Infinity);
  current.current = { failed, retry };
  useEffect(() => {
    const recover = () => {
      const connected = navigator.onLine !== false;
      setOnline(connected);
      if (!connected || document.visibilityState === 'hidden' || !current.current.failed) return;
      if (Date.now() - lastAttempt.current < 2000) return;
      lastAttempt.current = Date.now();
      current.current.failed = false;
      current.current.retry();
    };
    const offline = () => setOnline(false);
    window.addEventListener('online', recover);
    window.addEventListener('offline', offline);
    window.addEventListener('focus', recover);
    document.addEventListener('visibilitychange', recover);
    return () => {
      window.removeEventListener('online', recover);
      window.removeEventListener('offline', offline);
      window.removeEventListener('focus', recover);
      document.removeEventListener('visibilitychange', recover);
    };
  }, []);
  return online;
}
