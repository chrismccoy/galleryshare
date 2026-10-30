(function () {
  const SEL = {
    form: '[data-upload-form]',
    root: '[data-upload-root]',
    input: '[data-upload-input]',
    submit: '[data-upload-submit]',
    pick: '[data-upload-pick]',
    zone: '[data-drop-zone]',
    chosen: '[data-upload-chosen]',
    selection: '[data-upload-selection]',
    list: '[data-upload-list]',
    rowTemplate: '[data-upload-row]',
    clear: '[data-upload-clear]',
    status: '[data-upload-status]',
    error: '[data-upload-error]',
    errorText: '[data-upload-error-text]',
    submitText: '[data-upload-submit-text]',
  };

  const form = document.querySelector(SEL.form);
  if (!form) return;
  const root = form.closest(SEL.root);
  const input = form.querySelector(SEL.input);
  const pick = form.querySelector(SEL.pick);
  const zone = form.querySelector(SEL.zone);
  const summaryLine = form.querySelector(SEL.chosen);
  const selectionPanel = form.querySelector(SEL.selection);
  const rowTemplate = form.querySelector(SEL.rowTemplate);
  const list = rowTemplate && form.querySelector(SEL.list);
  const clear = form.querySelector(SEL.clear);
  const status = form.querySelector(SEL.status);
  const error = form.querySelector(SEL.error);
  const errorText = form.querySelector(SEL.errorText);
  const submit = form.querySelector(SEL.submit);
  const submitText = form.querySelector(SEL.submitText);
  if (!input || !submit) {
    console.warn('gallery-upload: the form lacks ' + (input ? SEL.submit : SEL.input) + '; the drop zone is off');
    return;
  }

  const HIGHLIGHT = ['border-brand-500', 'bg-indigo-50'];
  const rules = galleryUploadRules(form.dataset);
  let submitting = false;
  let chosenFiles = [];
  const thumbs = new Map();

  const isImage = (file) => rules.kindOf(file) === 'image';

  const isZip = (file) => rules.kindOf(file) === 'zip';

  function showError(message) {
    if (!error || !errorText) return;
    errorText.textContent = message;
    error.hidden = !message;
  }

  const sameFile = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

  function icon(classes) {
    const el = document.createElement('i');
    el.className = classes;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  function releaseThumb(file) {
    const url = thumbs.get(file);
    if (url) URL.revokeObjectURL(url);
    thumbs.delete(file);
  }

  function buildRow(file) {
    const bad = rules.isOversize(file);
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    if (bad) row.dataset.invalid = 'true';
    const lead = row.querySelector('[data-row-lead]');
    if (rules.imageTypes.includes(file.type)) {
      let url = thumbs.get(file);
      if (!url) {
        url = URL.createObjectURL(file);
        thumbs.set(file, url);
      }
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.className = 'h-full w-full object-cover';
      img.addEventListener('error', () => img.replaceWith(icon('fa-solid fa-image text-slate-400')));
      lead.appendChild(img);
    } else {
      lead.appendChild(
        icon(isZip(file) ? 'fa-solid fa-file-zipper text-slate-500' : 'fa-solid fa-image text-slate-400'),
      );
    }
    const name = row.querySelector('[data-row-name]');
    name.textContent = file.name;
    name.title = file.name;
    row.querySelector('[data-row-size]').textContent = bad
      ? rules.megabytes(file.size) + ' — over the ' + rules.limitMbOf(file) + ' MB limit'
      : rules.megabytes(file.size);
    const remove = row.querySelector('[data-upload-remove]');
    remove.setAttribute('aria-label', 'Remove ' + file.name);
    remove.addEventListener('click', () => removeFile(file));
    return row;
  }

  function countText() {
    return chosenFiles.every(isImage)
      ? rules.plural(chosenFiles.length, 'image', 'images')
      : rules.plural(chosenFiles.length, 'file', 'files');
  }

  function announce(message) {
    if (status) status.textContent = message;
  }

  function syncInput() {
    const transfer = new DataTransfer();
    chosenFiles.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
  }

  function refresh() {
    const result = rules.classify(chosenFiles);
    showError(result.message);
    if (list) {
      Array.from(thumbs.keys()).forEach((file) => {
        if (!chosenFiles.includes(file)) releaseThumb(file);
      });
      list.replaceChildren(...chosenFiles.map(buildRow));
    }
    if (selectionPanel) selectionPanel.hidden = !chosenFiles.length;
    if (summaryLine) {
      summaryLine.textContent = result.summary || (chosenFiles.length ? countText() : '');
      summaryLine.classList.toggle('text-red-700', result.overBatch);
      summaryLine.classList.toggle('font-medium', result.overBatch);
      if (result.overBatch) summaryLine.dataset.invalid = 'true';
      else delete summaryLine.dataset.invalid;
    }
    submit.disabled = submitting || result.kind !== 'ok';
  }

  function addFiles(files) {
    files.forEach((file) => {
      if (!chosenFiles.some((have) => sameFile(have, file))) chosenFiles.push(file);
    });
    syncInput();
    refresh();
  }

  function removeFile(file) {
    chosenFiles = chosenFiles.filter((have) => have !== file);
    syncInput();
    refresh();
    announce(file.name + ' removed, ' + (chosenFiles.length ? countText() + ' left' : 'no files left'));
    if (!chosenFiles.length) pick?.focus();
    else (list?.querySelector('[data-upload-remove]') || submit).focus();
  }

  function clearAll() {
    chosenFiles = [];
    syncInput();
    refresh();
    announce('All files removed');
    pick?.focus();
  }

  function hasFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes('Files');
  }

  function highlight(on) {
    if (zone) HIGHLIGHT.forEach((name) => zone.classList.toggle(name, on));
  }

  if (root) root.hidden = false;
  refresh();

  if (pick) pick.addEventListener('click', () => input.click());
  if (clear) clear.addEventListener('click', clearAll);
  input.addEventListener('change', function () {
    addFiles(Array.from(input.files || []));
  });

  form.addEventListener('submit', function (event) {
    syncInput();
    refresh();
    if (submitting || submit.disabled) {
      event.preventDefault();
      return;
    }
    submitting = true;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    if (submitText) submitText.textContent = 'Uploading…';
  });

  window.addEventListener('pagehide', function () {
    Array.from(thumbs.keys()).forEach(releaseThumb);
  });

  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    submitting = false;
    submit.removeAttribute('aria-busy');
    if (submitText) submitText.textContent = 'Upload';
    refresh();
  });

  document.addEventListener('dragover', function (event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    highlight(true);
  });
  document.addEventListener('dragleave', function (event) {
    if (!event.relatedTarget) highlight(false);
  });
  document.addEventListener('drop', function (event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    highlight(false);
    if (submitting) return;
    addFiles(Array.from(event.dataTransfer.files));
    if (!submit.disabled) submit.focus();
  });
})();
