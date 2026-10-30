export function deepFreeze(value) {
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child && typeof child === 'object' && !ArrayBuffer.isView(child)) deepFreeze(child);
  }
  return Object.freeze(value);
}
