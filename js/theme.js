// Set the theme before first paint so the page never flashes the wrong one.
(function () {
  let saved = null;
  try { saved = localStorage.getItem('rich-to-plain-theme'); } catch (_) {}
  document.documentElement.dataset.theme = saved === 'dark' ? 'dark' : 'light';
})();
