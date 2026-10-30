export function delegateMethods(source, names) {
  return Object.fromEntries(
    names.map((name) => {
      if (typeof source[name] !== 'function') throw new TypeError(`delegateMethods: no method called "${name}"`);
      return [name, (...args) => source[name](...args)];
    }),
  );
}
