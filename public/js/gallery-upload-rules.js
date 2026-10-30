function galleryUploadRules(dataset) {
  const MB = 1024 * 1024;

  const list = (value) => (value ? String(value).split(',').filter(Boolean) : []);

  const escaped = (ext) => ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const endsWithOneOf = (extensions) =>
    extensions.length ? new RegExp('\\.(' + extensions.map(escaped).join('|') + ')$', 'i') : null;

  const imageName = endsWithOneOf(list(dataset.imageExts));
  const zipName = endsWithOneOf(list(dataset.zipExts));
  const imageTypes = list(dataset.imageTypes);
  const zipTypes = list(dataset.zipTypes);
  const unsupported = dataset.unsupported || '';
  const maxImageBytes = (Number(dataset.maxImageMb) || 0) * MB;
  const maxZipBytes = (Number(dataset.maxZipMb) || 0) * MB;
  const maxBatchBytes = (Number(dataset.maxBatchMb) || 0) * MB;

  function kindOf(file) {
    if (imageName && imageName.test(file.name)) return 'image';
    if (zipName && zipName.test(file.name)) return 'zip';
    if (imageTypes.includes(file.type)) return 'image';
    if (zipTypes.includes(file.type)) return 'zip';
    return null;
  }

  function megabytes(bytes) {
    const mb = bytes / MB;
    return (mb < 10 ? Math.max(0.1, Math.round(mb * 10) / 10) : Math.round(mb)) + ' MB';
  }

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  const limitMbOf = (file) => (kindOf(file) === 'image' ? dataset.maxImageMb : dataset.maxZipMb);

  function isOversize(file) {
    const kind = kindOf(file);
    if (kind === 'image') return maxImageBytes > 0 && file.size > maxImageBytes;
    return kind === 'zip' && maxZipBytes > 0 && file.size > maxZipBytes;
  }

  function classify(files) {
    if (!files.length) return { kind: 'none', message: '', summary: '', overBatch: false };
    const images = files.filter((file) => kindOf(file) === 'image');
    const zips = files.filter((file) => kindOf(file) === 'zip');
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (images.length + zips.length < files.length)
      return { kind: 'invalid', message: unsupported, summary: '', overBatch: false };
    const parts = [];
    if (images.length) parts.push(plural(images.length, 'image', 'images'));
    if (zips.length) parts.push(plural(zips.length, 'ZIP file', 'ZIP files'));
    const overBatch = maxBatchBytes > 0 && total > maxBatchBytes;
    const summary =
      parts.join(' and ') +
      ', ' +
      megabytes(total) +
      (overBatch ? ' — over the ' + dataset.maxBatchMb + ' MB upload limit' : '');
    const sendable = !overBatch && !files.some(isOversize);
    return { kind: sendable ? 'ok' : 'invalid', message: '', summary, overBatch };
  }

  return { kindOf, imageTypes, unsupported, megabytes, plural, limitMbOf, isOversize, classify };
}
