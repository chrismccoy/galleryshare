import { once } from 'node:events';
import { ZipArchive } from 'archiver';
import { NOOP_LOGGER, errorFields } from '../lib/logger.js';

async function until(emitter, event, signal) {
  try {
    await once(emitter, event, { signal });
    return true;
  } catch (error) {
    if (signal.aborted) return false;
    throw error;
  }
}

export async function streamGalleryZip(
  res,
  { images, mediaStore, galleryId, entryName, now, logger = NOOP_LOGGER, onStart },
) {
  const open = (image) => mediaStore.stream({ galleryId, imageId: image.id, ext: image.ext }, 'orig');

  const download = new AbortController();
  const { signal } = download;
  let current = open(images[0]);
  let archive = null;
  signal.addEventListener(
    'abort',
    () => {
      current?.destroy();
      archive?.abort();
    },
    { once: true },
  );

  const onClose = () => {
    if (!res.writableFinished) download.abort();
  };
  res.on('close', onClose);

  async function openFirst() {
    try {
      const opened = current.pending ? await until(current, 'open', signal) : true;
      return opened && !res.destroyed;
    } catch (error) {
      res.off('close', onClose);
      current.destroy();
      throw error;
    }
  }

  const fail = (error) => {
    if (signal.aborted) return;
    logger.warn('zip download failed', { galleryId, ...errorFields(error) });
    download.abort(error);
    res.destroy();
  };

  async function appendAll(date) {
    for (const [index, image] of images.entries()) {
      if (index > 0) current = open(image);
      current.on('error', fail);
      const entered = until(archive, 'entry', signal);
      archive.append(current, { name: entryName(image, index + 1), date });
      if (!(await entered)) return false;
    }
    return !signal.aborted;
  }

  async function finish() {
    const closed = until(res, 'close', signal).catch(fail);
    await archive.finalize();
    await closed;
  }

  if (!(await openFirst())) {
    current.destroy();
    return;
  }

  archive = new ZipArchive({ store: true });
  archive.on('error', fail);
  archive.on('warning', fail);
  archive.pipe(res);
  onStart?.();

  try {
    if (await appendAll(new Date(now()))) await finish();
  } catch (error) {
    fail(error);
  }
}
