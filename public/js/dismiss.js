(function () {
  document.querySelectorAll('[data-dismiss]').forEach(function (button) {
    button.hidden = false;
  });

  document.addEventListener('click', function (event) {
    const button = event.target instanceof Element ? event.target.closest('[data-dismiss]') : null;
    const notice = button && button.closest('[data-notice]');
    if (!notice) return;
    notice.remove();
    const main = document.querySelector('main');
    if (main) {
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
    }
  });
})();
