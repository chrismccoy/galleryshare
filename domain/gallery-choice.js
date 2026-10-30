export const FOLLOW_SITE = 'default';

export const optionButtons = (options) => options.map((option) => ({ value: option.key, label: option.label }));

export function siteDefaultChoices(siteLabel, options) {
  return [{ value: FOLLOW_SITE, label: `Site default (${siteLabel})` }, ...optionButtons(options)];
}


export function createKeyedChoice({ options, defaultKey, column, message }) {
  const keys = options.map((option) => option.key);
  const is = (value) => keys.includes(value);
  const label = (key) => options.find((option) => option.key === key)?.label ?? key;
  return Object.freeze({
    options,
    defaultKey,
    message,
    galleryChoices: Object.freeze([FOLLOW_SITE, ...keys]),
    is,
    label,
    fromChoice(choice) {
      if (choice === FOLLOW_SITE) return null;
      return is(choice) ? choice : undefined;
    },
    choiceOf(gallery) {
      return is(gallery[column]) ? gallery[column] : FOLLOW_SITE;
    },
    resolve(gallery, siteKey) {
      if (is(gallery[column])) return gallery[column];
      return is(siteKey) ? siteKey : defaultKey;
    },
    stored(value) {
      return is(value) ? value : defaultKey;
    },
    buttons(siteKey) {
      return siteDefaultChoices(label(siteKey), options);
    },
  });
}
