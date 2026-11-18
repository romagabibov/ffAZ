(function () {
  var theme;
  var language = 'az';
  try {
    theme = localStorage.getItem('az_fashion_theme');
    if (theme !== 'light' && theme !== 'dark') theme = localStorage.getItem('theme');
    var stored = (localStorage.getItem('i18nextLng') || '').toLowerCase().split(/[-_]/)[0];
    if (stored === 'az' || stored === 'ru' || stored === 'en') language = stored;
  } catch (_) {}
  var dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.lang = language;
})();
