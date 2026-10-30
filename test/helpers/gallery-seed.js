export function imageRow(galleryId, { n = 0, ...overrides } = {}) {
  return {
    galleryId,
    publicName: `p${galleryId}x${n}`.padEnd(10, '0').slice(-10),
    originalName: `o${n}.jpg`,
    mime: 'image/jpeg',
    ext: 'jpg',
    width: 10,
    height: 10,
    bytesOrig: 1000,
    bytesWeb: 0,
    bytesThumb: 0,
    ...overrides,
  };
}

export function seedGallery(context, userId, { title, images = 0, bytes = 1000 } = {}) {
  const id = context.galleries.insert({ userId });
  if (title) context.galleries.updateMeta(id, { title, description: null, allowZip: false, actorId: userId });
  for (let n = 0; n < images; n++) context.galleryImages.insert(imageRow(id, { n, bytesOrig: bytes }));
  return id;
}
