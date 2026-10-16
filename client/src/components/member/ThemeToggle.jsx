import { useSettingsStore, resolvedTheme } from '../../store/settingsStore';
import { Icon } from '../primitives';

export default function ThemeToggle() {
  useSettingsStore(s => s.theme); // re-render when it changes
  const theme = resolvedTheme();
  const setTheme = useSettingsStore(s => s.setTheme);
  return <button type="button" className="member-theme" data-testid="theme-toggle"
    aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
    <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
  </button>;
}
