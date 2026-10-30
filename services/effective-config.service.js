import { LIMITS, TUNABLES, envTunable, storedTunable } from '../domain/limits.js';
import { SETTING_KEYS, storedShareGridText, storedShareImageView, storedShareTheme } from '../domain/settings.js';
import { DEFAULT_SHARE_THEME } from '../domain/share-themes.js';
import { DEFAULT_IMAGE_VIEW } from '../domain/image-views.js';




export function createEffectiveConfigService({ settings, config }) {
  function resolveTunable(name, envValue, values) {
    const saved = storedTunable(values, name);
    if (values[TUNABLES[name].overrideKey] === true && saved !== null) return { value: saved, source: 'settings' };
    return { value: envValue, source: 'env' };
  }

  const resolvePageSize = (values) => resolveTunable('itemsPerPage', envTunable(config, 'itemsPerPage'), values);

  const resolveLimit = (name, values) => resolveTunable(name, envTunable(config, name), values);

  function resolveSwitchable(values, overrideKey, stored, envValue) {
    if (values[overrideKey] === true) return { value: stored(values), source: 'settings' };
    return { value: envValue, source: 'env' };
  }

  const resolveShareGridText = (values) =>
    resolveSwitchable(values, SETTING_KEYS.overrideShareGridText, storedShareGridText, config.shareGridText !== false);

  const resolveShareTheme = (values) =>
    resolveSwitchable(
      values,
      SETTING_KEYS.overrideShareTheme,
      storedShareTheme,
      config.shareTheme ?? DEFAULT_SHARE_THEME,
    );

  const resolveShareImageView = (values) =>
    resolveSwitchable(
      values,
      SETTING_KEYS.overrideShareImageView,
      storedShareImageView,
      config.shareImageView ?? DEFAULT_IMAGE_VIEW,
    );

  const resolveLimits = (values) =>
    Object.fromEntries(Object.keys(LIMITS).map((name) => [name, resolveLimit(name, values)]));

  const pageSize = () => resolvePageSize(settings.all());

  const shareGridText = () => resolveShareGridText(settings.all());

  const shareTheme = () => resolveShareTheme(settings.all());

  const shareImageView = () => resolveShareImageView(settings.all());

  const limits = () => resolveLimits(settings.all());

  const limitValues = () => Object.fromEntries(Object.entries(limits()).map(([name, { value }]) => [name, value]));

  function status() {
    const values = settings.all();
    return {
      pageSize: resolvePageSize(values),
      limits: resolveLimits(values),
      shareGridText: resolveShareGridText(values),
      shareTheme: resolveShareTheme(values),
      shareImageView: resolveShareImageView(values),
    };
  }

  return { status, pageSize, shareGridText, shareTheme, shareImageView, limits, limitValues };
}
