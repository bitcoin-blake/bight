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
  // after 25 s (the page's own code waits up to 20 s for the CDN, then says so itself): said on the page and to screen readers
  setTimeout(function () {
    if (window.bight) return;
    var m = document.getElementById('syncmsg');
    if (m && /^Starting/.test(m.textContent)) {
      var t =
        'Bight did not start: this browser may be too old for it, or its code did not load. Try a recent Chrome, Edge, Brave or Firefox, and reload.';
      m.textContent = t;
      var a = document.getElementById('announce');
      if (a) a.textContent = t;
    }
  }, 25000);
})();
