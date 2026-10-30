import { LIMITS, TUNABLES, envTunable, isTunableValue, storedTunable, tunableMessage } from '../domain/limits.js';
import {
  OVERRIDE_SWITCHES,
  SETTING_KEYS,
  publicSharingOn as sharingOnIn,
  storedItemsPerPage,
  storedShareGridText,
  storedShareImageView,
  storedShareTheme,
} from '../domain/settings.js';
import { SHARE_THEME_MESSAGE, isShareTheme, shareThemeLabel } from '../domain/share-themes.js';
import { IMAGE_VIEW_MESSAGE, imageViewLabel, isImageView } from '../domain/image-views.js';
import { ValidationError } from '../lib/errors.js';
import { wholeNumberOrBlank } from '../lib/params.js';
import { NOOP_ACTIVITY } from './activity.service.js';

function savedLimits(stored) {
  const limits = {};
  for (const name of Object.keys(LIMITS)) limits[name] = storedTunable(stored, name);
  return limits;
}

function savedSwitches(stored) {
  const switches = {};
  for (const { name } of OVERRIDE_SWITCHES) switches[name] = stored[name] === true;
  return switches;
}

const GRID_TEXT_LABEL = 'Titles and captions on the gallery grid';

const SHARE_THEME_LABEL = 'Share theme';

const IMAGE_VIEW_LABEL = 'Image view';

const onOff = (on) => (on ? 'on' : 'off');

const numberText = (value, envValue) => {
  if (value !== null) return String(value);
  return envValue === undefined ? '.env' : `${envValue} (.env)`;
};


function settingChanges(before, after, envValues = {}) {
  const changes = [];
  const diff = (label, from, to) => {
    if (from !== to) changes.push(`${label}: ${from} → ${to}`);
  };
  for (const { name, title } of OVERRIDE_SWITCHES) {
    diff(title, onOff(before.switches[name]), onOff(after.switches[name]));
  }
  diff(GRID_TEXT_LABEL, onOff(before.shareGridText), onOff(after.shareGridText));
  diff(SHARE_THEME_LABEL, shareThemeLabel(before.shareTheme), shareThemeLabel(after.shareTheme));
  diff(IMAGE_VIEW_LABEL, imageViewLabel(before.shareImageView), imageViewLabel(after.shareImageView));
  const envPage = envTunable(envValues, 'itemsPerPage');
  diff(TUNABLES.itemsPerPage.label, numberText(before.itemsPerPage, envPage), numberText(after.itemsPerPage, envPage));
  for (const name of Object.keys(LIMITS)) {
    const envLimit = envTunable(envValues, name);
    diff(TUNABLES[name].label, numberText(before.limits[name], envLimit), numberText(after.limits[name], envLimit));
  }
  return changes;
}

export function createSettingsService({ runInTransaction, settings, activityService = NOOP_ACTIVITY, envValues = {} }) {
  function current(stored = settings.all()) {
    return {
      switches: savedSwitches(stored),
      publicSharing: sharingOnIn(stored),
      shareGridText: storedShareGridText(stored),
      shareTheme: storedShareTheme(stored),
      shareImageView: storedShareImageView(stored),
      itemsPerPage: storedItemsPerPage(stored),
      limits: savedLimits(stored),
    };
  }

  function parseTunable(name, raw) {
    const message = tunableMessage(name);
    const number = typeof raw === 'number' ? raw : wholeNumberOrBlank(raw, message);
    if (number !== null && !isTunableValue(name, number)) throw new ValidationError(message);
    return number;
  }

  function recordChanges(before, actorId) {
    for (const details of settingChanges(before, current(), envValues)) {
      activityService.record({ kind: 'settingChanged', actor: actorId, details });
    }
  }

  function parseTunables(submitted, switches, stored) {
    const numbers = {};
    for (const [name, def] of Object.entries(TUNABLES)) {
      const number = parseTunable(name, submitted[name] ?? '');
      const switchedOn = switches[def.overrideKey] === true;
      const nothingSaved = storedTunable(stored, name) === null;
      if (switchedOn && number === null && nothingSaved) throw new ValidationError(tunableMessage(name));
      const untouchedEnv = !switchedOn && nothingSaved && number !== null && number === envTunable(envValues, name);
      numbers[name] = untouchedEnv ? null : number;
    }
    return numbers;
  }

  function save(
    {
      switches,
      publicSharing = publicSharingOn(),
      shareGridText,
      shareTheme,
      shareImageView,
      itemsPerPage = '',
      limits = {},
    },
    actorId,
  ) {
    if (shareTheme !== undefined && !isShareTheme(shareTheme)) throw new ValidationError(SHARE_THEME_MESSAGE);
    if (shareImageView !== undefined && !isImageView(shareImageView)) throw new ValidationError(IMAGE_VIEW_MESSAGE);
    const stored = settings.all();
    const numbers = parseTunables({ ...limits, itemsPerPage }, switches, stored);
    const before = current(stored);
    runInTransaction(() => {
      for (const s of OVERRIDE_SWITCHES) settings.set(s.name, switches[s.name] === true, actorId);
      settings.set(SETTING_KEYS.publicSharing, publicSharing === true, actorId);
      if (shareGridText !== undefined) settings.set(SETTING_KEYS.shareGridText, shareGridText === true, actorId);
      if (shareTheme !== undefined) settings.set(SETTING_KEYS.shareTheme, shareTheme, actorId);
      if (shareImageView !== undefined) settings.set(SETTING_KEYS.shareImageView, shareImageView, actorId);
      for (const [name, number] of Object.entries(numbers)) {
        if (number !== null) settings.set(TUNABLES[name].settingKey, number, actorId);
      }
    });
    if ((publicSharing === true) !== before.publicSharing) {
      activityService.record({
        kind: 'publicSharingChanged',
        actor: actorId,
        details: onOff(publicSharing === true),
      });
    }
    recordChanges(before, actorId);
  }

  function publicSharingOn() {
    return sharingOnIn(settings.all());
  }

  const readEnvValues = () => envValues;

  return { current, save, publicSharingOn, envValues: readEnvValues };
}
