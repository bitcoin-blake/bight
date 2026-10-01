// the theme before the page paints (a file, not inline, so the security policy can forbid inline scripts)
(function () {
  try {
    var t = localStorage.getItem('bight:theme');
    if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
