(function () {
  const bar = document.querySelector('[data-save-bar]');
  const form = bar && document.getElementById(bar.getAttribute('data-save-bar'));
  if (!form) return;
  const count = bar.querySelector('[data-save-bar-count]');
  const discard = bar.querySelector('[data-save-bar-discard]');
  if (!count || !discard) {
    console.warn('save-bar: the bar lacks [data-save-bar-count] or [data-save-bar-discard]; the save bar is off');
    return;
  }
  const dialog = document.querySelector('[data-leave-dialog]');
  const dialogText = dialog && dialog.querySelector('[data-leave-dialog-text]');

  let submitting = false;
  let leaving = false;
  let pending = null;

  const editableFields = () =>
    Array.from(form.elements).filter(function (field) {
      return field.matches('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select');
    });

  const imageFields = () =>
    Array.from(form.elements).filter(function (field) {
      return field.hasAttribute('data-image-field');
    });

  function changed(field) {
    if (field.type === 'checkbox' || field.type === 'radio') return field.checked !== field.defaultChecked;
    if (field.tagName === 'SELECT') {
      return Array.from(field.options).some(function (option) {
        return option.selected !== option.defaultSelected;
      });
    }
    return field.value !== field.defaultValue;
  }

  function unsavedCount() {
    const groups = new Set();
    let total = 0;
    editableFields().forEach(function (field) {
      if (!changed(field)) return;
      if (field.type === 'radio') {
        if (groups.has(field.name)) return;
        groups.add(field.name);
      }
      total += 1;
    });
    return total;
  }

  const changesText = (total) => (total === 1 ? '1 unsaved change' : total + ' unsaved changes');

  function update() {
    const total = unsavedCount();
    bar.hidden = total === 0;
    count.textContent = changesText(total);
  }

  document.addEventListener('input', function (event) {
    if (event.target.form === form) update();
  });
  document.addEventListener('change', function (event) {
    if (event.target.form === form) update();
  });

  discard.addEventListener('click', function () {
    form.reset();
    update();
  });

  function leavesPage(event, link) {
    if (event.defaultPrevented || event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (link.hasAttribute('download')) return false;
    const target = link.getAttribute('target');
    if (target && target !== '_self') return false;
    const url = new URL(link.href, location.href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const here = new URL(location.href);
    return !(url.hash && url.origin === here.origin && url.pathname === here.pathname && url.search === here.search);
  }

  function askBeforeLeaving(leave) {
    const total = unsavedCount();
    dialogText.textContent =
      'You have ' + changesText(total) + '. Leave this page and lose ' + (total === 1 ? 'it' : 'them') + '?';
    pending = leave;
    dialog.showModal();
  }

  if (dialog && dialogText) {
    document.addEventListener(
      'click',
      function (event) {
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (!link || leaving || unsavedCount() === 0 || !leavesPage(event, link)) return;
        event.preventDefault();
        askBeforeLeaving(function () {
          location.href = link.href;
        });
      },
      true,
    );

    document.addEventListener(
      'submit',
      function (event) {
        const other = event.target;
        if (other === form || leaving || unsavedCount() === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const submitter = event.submitter;
        askBeforeLeaving(function () {
          if (submitter && submitter.form === other) other.requestSubmit(submitter);
          else other.requestSubmit();
        });
      },
      true,
    );

    dialog.querySelector('[data-leave-go]').addEventListener('click', function () {
      const leave = pending;
      pending = null;
      leaving = true;
      dialog.close();
      if (leave) leave();
    });
    dialog.querySelector('[data-leave-stay]').addEventListener('click', function () {
      dialog.close();
    });
    dialog.addEventListener('click', function (event) {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      if (!inside) dialog.close();
    });
    dialog.addEventListener('close', function () {
      pending = null;
    });
  }

  window.addEventListener('beforeunload', function (event) {
    if (submitting || leaving || unsavedCount() === 0) return;
    event.preventDefault();
    event.returnValue = '';
  });

  form.addEventListener('submit', function () {
    submitting = true;
    imageFields().forEach(function (field) {
      if (!changed(field)) field.disabled = true;
    });
  });

  window.addEventListener('pageshow', function () {
    submitting = false;
    leaving = false;
    imageFields().forEach(function (field) {
      field.disabled = false;
    });
    update();
  });

  update();
})();
