(function () {
  const SEL = {
    list: '[data-reorder-list]',
    row: '[data-image-id]',
    handle: '[data-drag-handle]',
    move: '[data-move]',
    position: '[data-position]',
    defaultCaption: '[data-default-caption]',
    notice: '[data-reorder-notice]',
    noticeText: '[data-reorder-notice-text]',
    csrf: 'meta[name="csrf-token"]',
  };

  const list = document.querySelector(SEL.list);
  if (!list) return;

  const url = list.dataset.reorderUrl;
  const captionTemplate = list.dataset.captionTemplate;
  const notice = document.querySelector(SEL.notice);
  const noticeText = notice?.querySelector(SEL.noticeText) ?? null;
  if (!url) {
    console.warn('reorder: the list lacks data-reorder-url; reordering is off');
    return;
  }
  if (!notice || !noticeText)
    console.warn('reorder: the list lacks its ' + SEL.notice + ' notice; errors will not show');
  const token = document.querySelector(SEL.csrf)?.content || '';
  const FAILED = 'The new order could not be saved. Reload and try again.';
  let busy = false;
  let dragged = null;
  let dropTarget = null;
  let dropBefore = false;

  const imageRows = () => Array.from(list.children).filter((el) => el.matches(SEL.row));
  const idsOf = (order) => order.map((row) => Number(row.dataset.imageId));

  function showNotice(message) {
    if (!notice || !noticeText) return;
    noticeText.textContent = message || '';
    notice.hidden = !message;
  }

  function refresh() {
    const all = imageRows();
    all.forEach(function (row, index) {
      const caption = row.querySelector(SEL.defaultCaption);
      if (caption && captionTemplate) caption.placeholder = captionTemplate.replace('{position}', String(index + 1));
      const position = row.querySelector(SEL.position);
      if (position) position.textContent = '#' + (index + 1);
      const up = row.querySelector('[data-move="up"]');
      const down = row.querySelector('[data-move="down"]');
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === all.length - 1;
    });
  }

  async function commit(order) {
    if (busy) return false;
    const current = idsOf(imageRows());
    const next = idsOf(order);
    if (current.every((id, i) => id === next[i])) return false;
    busy = true;
    list.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ ids: next }),
      });
      if (res.status === 204) {
        order.forEach((row) => list.appendChild(row));
        refresh();
        showNotice('');
        return true;
      }
      const body = await res.json().catch(() => null);
      showNotice(body?.error || FAILED);
    } catch {
      showNotice(FAILED);
    } finally {
      busy = false;
      list.removeAttribute('aria-busy');
    }
    return false;
  }

  function focusAfterMove(row, direction) {
    const again = row.querySelector(SEL.move + '[data-move="' + direction + '"]');
    (again && !again.disabled ? again : row.querySelector(SEL.move + ':not(:disabled)'))?.focus();
  }

  list.addEventListener('click', async function (event) {
    const button = event.target.closest(SEL.move);
    if (!button || !list.contains(button)) return;
    const row = button.closest(SEL.row);
    const order = imageRows();
    const from = order.indexOf(row);
    const to = button.dataset.move === 'up' ? from - 1 : from + 1;
    if (to < 0 || to >= order.length) return;
    order.splice(from, 1);
    order.splice(to, 0, row);
    if (await commit(order)) focusAfterMove(row, button.dataset.move);
  });

  list.addEventListener('pointerdown', function (event) {
    const handle = event.target.closest(SEL.handle);
    if (!handle) return;
    handle.closest(SEL.row).draggable = true;
  });
  document.addEventListener('pointerup', function () {
    if (!dragged) imageRows().forEach((row) => (row.draggable = false));
  });

  function clearMarks() {
    imageRows().forEach((row) => row.classList.remove('border-t-2', 'border-b-2', 'border-brand-500'));
  }

  list.addEventListener('dragstart', function (event) {
    const row = event.target.closest?.(SEL.row);
    if (!row || !row.draggable) return;
    dragged = row;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.dataset.imageId);
    row.classList.add('opacity-50');
  });

  list.addEventListener('dragover', function (event) {
    if (!dragged) return;
    const row = event.target.closest(SEL.row);
    if (!row) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = row.getBoundingClientRect();
    dropTarget = row;
    dropBefore = event.clientY < box.top + box.height / 2;
    clearMarks();
    if (row !== dragged) row.classList.add(dropBefore ? 'border-t-2' : 'border-b-2', 'border-brand-500');
  });

  list.addEventListener('drop', function (event) {
    if (!dragged) return;
    event.preventDefault();
    const row = dragged;
    const order = imageRows().filter((r) => r !== row);
    if (dropTarget && dropTarget !== row) {
      const at = order.indexOf(dropTarget) + (dropBefore ? 0 : 1);
      order.splice(at, 0, row);
      commit(order);
    }
  });

  list.addEventListener('dragend', function () {
    clearMarks();
    if (dragged) {
      dragged.classList.remove('opacity-50');
      dragged.draggable = false;
    }
    dragged = null;
    dropTarget = null;
  });

  refresh();
})();
