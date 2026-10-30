(function () {
  function show(el, on) {
    if (el) el.hidden = !on;
  }

  document.querySelectorAll('[data-confirm]').forEach(function (group) {
    const openBtn = group.querySelector('[data-confirm-open]');
    const panel = group.querySelector('[data-confirm-panel]');
    const cancelBtn = group.querySelector('[data-confirm-cancel]');
    const hides = group.querySelectorAll('[data-confirm-hide]');
    if (!openBtn || !panel) return;

    function setConfirming(on) {
      show(openBtn, !on);
      hides.forEach(function (el) {
        show(el, !on);
      });
      show(panel, on);
      if (on) panel.querySelector('button[type="submit"]')?.focus();
    }

    openBtn.addEventListener('click', function () {
      setConfirming(true);
    });
    if (cancelBtn)
      cancelBtn.addEventListener('click', function () {
        setConfirming(false);
        openBtn.focus();
      });
  });
})();
