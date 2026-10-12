// Same-origin script allowed by the production Content Security Policy.
(function () {
  try {
    var settings = JSON.parse(localStorage.getItem('fitlife-settings-v2') || '{}');
    document.documentElement.dataset.theme = settings.state && settings.state.theme === 'dark' ? 'dark' : 'light';
  } catch (_) { document.documentElement.dataset.theme = 'light'; }
})();
