(function () {
  const RESET_MS = 2000;

  function legacyCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'sr-only';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error('copy refused'));
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return legacyCopy(text);
  }

  document.querySelectorAll('[data-copy-link]').forEach(function (button) {
    const label = button.querySelector('[data-copy-label]');
    const original = label ? label.textContent : '';
    let timer = null;

    function flash(text) {
      if (!label) return;
      label.textContent = text;
      clearTimeout(timer);
      timer = setTimeout(function () {
        label.textContent = original;
      }, RESET_MS);
    }

    button.addEventListener('click', function () {
      copy(new URL(button.getAttribute('data-copy-link'), window.location.href).href).then(
        function () {
          flash('Copied');
        },
        function () {
          flash('Copy failed');
        },
      );
    });
  });
})();
