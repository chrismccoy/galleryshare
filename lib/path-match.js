const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function pathMatcher(patterns) {
  const sources = patterns.map((pattern) =>
    pattern
      .split('/')
      .map((part) => (part.startsWith(':') ? '[^/]+' : escapeRegExp(part)))
      .join('/'),
  );
  const regex = new RegExp(`^(?:${sources.join('|')})$`);
  return (urlPath) => patterns.length > 0 && regex.test(urlPath);
}
