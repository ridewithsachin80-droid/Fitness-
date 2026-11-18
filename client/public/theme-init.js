// Same-origin script allowed by the production Content Security Policy.
// Runs before the app paints, so the first frame is already the right theme.
// 16 Oct 2026: with no saved choice, follow the phone's dark/light setting.
(function () {
  var theme = 'dark';
  try {
    var settings = JSON.parse(localStorage.getItem('fitlife-settings-v2') || '{}');
    var choice = settings.state && settings.state.theme;
    if (choice === 'dark' || choice === 'light') theme = choice;
    else theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch (_) {}
  document.documentElement.dataset.theme = theme;
  try {
    var c = document.querySelector('meta[name="theme-color"]');
    if (c) c.content = theme === 'dark' ? '#141817' : '#f8f9f6';
    var s = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (s) s.content = theme === 'dark' ? 'black-translucent' : 'default';
  } catch (_) {}
})();
