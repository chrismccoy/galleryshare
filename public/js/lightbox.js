(function () {
  'use strict';

  const SEL = {
    box: 'lightbox',
    image: 'lb-image',
    counter: 'lb-counter',
    title: 'lb-title',
    caption: 'lb-caption',
    save: 'lb-save',
    copy: 'lb-copy',
    strip: 'lb-strip',
    close: 'lb-close',
    prev: 'lb-prev',
    next: 'lb-next',
    card: 'figure[data-shot]',
  };

  const box = document.getElementById(SEL.box);
  if (!box) return;

  function part(id) {
    const el = document.getElementById(id);
    if (!el) console.warn('lightbox: missing #' + id + '; the lightbox is off');
    return el;
  }

  const image = part(SEL.image);
  const counter = part(SEL.counter);
  const title = part(SEL.title);
  const caption = part(SEL.caption);
  const save = part(SEL.save);
  const strip = part(SEL.strip);
  const closeButton = part(SEL.close);
  const prevButton = part(SEL.prev);
  const nextButton = part(SEL.next);
  if (!image || !counter || !title || !caption || !save || !strip || !closeButton || !prevButton || !nextButton) return;
  const copyButton = document.getElementById(SEL.copy);

  const shots = Array.from(document.querySelectorAll(SEL.card)).map(function (figure) {
    const link = figure.querySelector('a[href]');
    return {
      href: link.getAttribute('href'),
      thumb: figure.getAttribute('data-thumb') || link.getAttribute('href'),
      title: figure.getAttribute('data-title') || '',
      text: figure.getAttribute('data-text') || '',
      download: figure.getAttribute('data-download') || '',
      link: link,
    };
  });

  if (!shots.length) return;

  const ITEM_LABEL = box.getAttribute('data-item-label') || 'Image';
  const ACTIVE_CLASS = '!border-accent';
  const SCROLL_LOCK_CLASS = 'overflow-hidden';
  const THUMB_CROP = box.hasAttribute('data-thumb-top') ? ' object-top' : '';

  let current = 0;
  let opener = null;

  const thumbs = shots.map(function (shot, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className =
      'h-12 w-16 flex-shrink-0 cursor-pointer overflow-hidden rounded-lg ' +
      'border-2 border-transparent p-0 transition-all hover:border-white/50';
    button.setAttribute('aria-label', ITEM_LABEL + ' ' + (index + 1));

    const thumb = document.createElement('img');
    thumb.src = shot.thumb;
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.className = 'h-full w-full object-cover' + THUMB_CROP;
    button.appendChild(thumb);

    button.addEventListener('click', function () {
      showImage(index);
    });
    strip.appendChild(button);
    return button;
  });

  function showImage(index) {
    current = (index + shots.length) % shots.length;
    const shot = shots[current];

    image.src = shot.href;
    image.alt = shot.title || shot.text;
    save.href = shot.href;
    save.setAttribute('download', shot.download);
    if (copyButton) copyButton.setAttribute('data-copy-link', new URL(shot.href, window.location.href).href);
    counter.textContent = current + 1 + ' / ' + shots.length;
    title.textContent = shot.title;
    caption.textContent = shot.text;

    thumbs.forEach(function (button, i) {
      button.classList.toggle(ACTIVE_CLASS, i === current);
    });

    const active = thumbs[current];
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }

  function open(index) {
    opener = document.activeElement;
    box.hidden = false;
    document.body.classList.add(SCROLL_LOCK_CLASS);
    showImage(index);
    closeButton.focus();
  }

  function close() {
    box.hidden = true;
    document.body.classList.remove(SCROLL_LOCK_CLASS);
    if (opener && opener.focus) opener.focus();
    opener = null;
  }

  shots.forEach(function (shot, index) {
    shot.link.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button !== 0) return;
      event.preventDefault();
      open(index);
    });
  });

  closeButton.addEventListener('click', close);
  prevButton.addEventListener('click', function () {
    showImage(current - 1);
  });
  nextButton.addEventListener('click', function () {
    showImage(current + 1);
  });

  box.addEventListener('click', function (event) {
    if (event.target === box) close();
  });

  function trapTab(event) {
    const controls = Array.from(box.querySelectorAll('button, a[href]')).filter(function (control) {
      return !control.disabled && !control.hidden && control.getClientRects().length > 0;
    });
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    const inside = box.contains(document.activeElement);
    if (event.shiftKey && (document.activeElement === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', function (event) {
    if (box.hidden) return;
    if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) return trapTab(event);
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowRight') showImage(current + 1);
    else if (event.key === 'ArrowLeft') showImage(current - 1);
  });
})();
