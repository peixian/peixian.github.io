// Run before stylesheets so a saved theme applies on the first paint.
(() => {
  document.documentElement.classList.add('js');
  let theme = 'system';
  try { theme = localStorage.getItem('forest-theme') || theme; } catch { /* Storage may be unavailable. */ }
  document.documentElement.dataset.theme = ['system', 'light', 'dark'].includes(theme) ? theme : 'system';
})();
