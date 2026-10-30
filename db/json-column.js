export function readJsonColumn(text) {
  return text === null || text === undefined ? null : JSON.parse(text);
}

export function writeJsonColumn(value) {
  return JSON.stringify(value);
}
