(function () {
  'use strict';

  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (target && target.closest && target.closest('input, textarea, select, [contenteditable]')) return;
    const dir = event.key === 'ArrowLeft' ? 'prev' : event.key === 'ArrowRight' ? 'next' : null;
    if (!dir) return;
    const link = document.querySelector('[data-image-nav] a[data-image-' + dir + ']');
    if (!link) return;
    event.preventDefault();
    window.location.href = link.href;
  });
})();
