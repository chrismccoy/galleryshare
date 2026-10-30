import { positiveInt } from '../../lib/params.js';

export function parseOrderIds(body) {
  const ids = body?.ids;
  if (!Array.isArray(ids)) return null;
  const out = ids.map((id) => (typeof id === 'number' || typeof id === 'string' ? positiveInt(id) : null));
  return out.every(Boolean) ? out : null;
}

const IMAGE_FIELD = /^images\[(\d+)\]\[(title|caption|remove)\]$/;

export function imageFieldsFrom(body) {
  const images = new Map();
  for (const [name, value] of Object.entries(body)) {
    const match = IMAGE_FIELD.exec(name);
    if (!match) continue;
    const imageId = Number(match[1]);
    images.set(imageId, { ...images.get(imageId), [match[2]]: value });
  }
  return images;
}

