export function cookiesFrom(res) {
  const out = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    out[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return out;
}

export function setCookieLine(res, name) {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
}
