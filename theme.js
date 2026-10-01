// the theme before the page paints (a file, not inline, so the security policy can forbid inline scripts); and a word on
// the page if bight.js never runs (a browser without modules or top-level await, or a file that did not load)
(function () {
  try {
    var t = localStorage.getItem('bight:theme');
    if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
  setTimeout(function () {
    if (window.bight) return;
    var m = document.getElementById('syncmsg');
    if (m && /^Starting/.test(m.textContent))
      m.textContent =
        'Bight did not start: this browser may be too old for it, or its code did not load. Try a recent Chrome, Edge, Brave or Firefox, and reload.';
  }, 15000);
})();
