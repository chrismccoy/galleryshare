import { Router } from 'express';
import { ADMIN_ROUTES, PATHS } from '../../../config/urls.js';
import { LIMITS, TUNABLES, limitSettingKey } from '../../../domain/limits.js';
import { OVERRIDE_SWITCHES, SETTING_KEYS } from '../../../domain/settings.js';
import { DEFAULT_SHARE_THEME, SHARE_THEMES, isShareTheme, shareThemeLabel } from '../../../domain/share-themes.js';
import { DEFAULT_IMAGE_VIEW, IMAGE_VIEWS, imageViewLabel, isImageView } from '../../../domain/image-views.js';
import { optionButtons } from '../../../domain/gallery-choice.js';
import { gridTextLabel } from '../../../domain/gallery.js';
import { noticeFor } from '../../../lib/params.js';
import { noStore, renderInShell, seeOther, withFormErrors, withNotice } from '../../view/respond.js';

const NOTICES = { saved: 'Settings saved.' };
const SOURCE_LABELS = Object.freeze({ settings: 'Settings', env: '.env' });
const inEffect = (label, { value, source }) => `${label(value)} (${SOURCE_LABELS[source]})`;


const fieldText = (value, envValue) => {
  if (value !== null) return String(value);
  return envValue === undefined ? '' : String(envValue);
};

const postedText = (value) => (typeof value === 'string' ? value.trim() : '');

export function formFromSettings(stored, env = {}) {
  return {
    switches: stored.switches,
    publicSharing: stored.publicSharing,
    shareGridText: stored.shareGridText,
    shareTheme: stored.shareTheme,
    shareImageView: stored.shareImageView,
    itemsPerPage: fieldText(stored.itemsPerPage, env.itemsPerPage),
    limits: Object.fromEntries(
      Object.keys(LIMITS).map((name) => [name, fieldText(stored.limits[name], env.limits?.[name])]),
    ),
  };
}

export function formFromBody(body) {
  return {
    switches: Object.fromEntries(
      OVERRIDE_SWITCHES.map((switchDef) => [switchDef.name, body[switchDef.name] !== undefined]),
    ),
    publicSharing: body.public_sharing !== undefined,
    shareGridText: body[SETTING_KEYS.shareGridText] !== undefined,
    shareTheme: typeof body[SETTING_KEYS.shareTheme] === 'string' ? body[SETTING_KEYS.shareTheme] : undefined,
    shareImageView:
      typeof body[SETTING_KEYS.shareImageView] === 'string' ? body[SETTING_KEYS.shareImageView] : undefined,
    itemsPerPage: postedText(body.items_per_page),
    limits: Object.fromEntries(Object.keys(LIMITS).map((name) => [name, postedText(body[limitSettingKey(name)])])),
  };
}

export function createAdminSettingsRouter({ settingsService, effectiveConfigService }) {
  const router = Router();

  function render(_req, res, { status = 200, error = null, notice = null, form } = {}) {
    const state = effectiveConfigService.status();
    const values = form ?? formFromSettings(settingsService.current(), settingsService.envValues());
    noStore(res);
    return renderInShell(res.status(status), 'pages/admin/settings', {
      title: 'Settings',
      scripts: ['save-bar'],
      error,
      notice,
      switches: OVERRIDE_SWITCHES.map((switchDef) => ({
        ...switchDef,
        checked: values.switches[switchDef.name] === true,
      })),
      publicSharing: values.publicSharing === true,
      shareGridText: values.shareGridText === true,
      shareGridTextInEffect: inEffect(gridTextLabel, state.shareGridText),
      shareThemeChoices: optionButtons(SHARE_THEMES),
      shareTheme: isShareTheme(values.shareTheme) ? values.shareTheme : DEFAULT_SHARE_THEME,
      shareThemeInEffect: inEffect(shareThemeLabel, state.shareTheme),
      imageViewChoices: optionButtons(IMAGE_VIEWS),
      shareImageView: isImageView(values.shareImageView) ? values.shareImageView : DEFAULT_IMAGE_VIEW,
      shareImageViewInEffect: inEffect(imageViewLabel, state.shareImageView),
      itemsPerPage: values.itemsPerPage,
      pageRange: { min: TUNABLES.itemsPerPage.min, max: TUNABLES.itemsPerPage.max },
      limits: Object.entries(LIMITS).map(([name, def]) => ({
        name,
        label: def.label,
        field: limitSettingKey(name),
        min: def.min,
        max: def.max,
        value: values.limits[name],
        effective: {
          value: state.limits[name].value,
          sourceLabel: SOURCE_LABELS[state.limits[name].source],
        },
      })),
      pageSize: { value: state.pageSize.value, sourceLabel: SOURCE_LABELS[state.pageSize.source] },
    });
  }

  router.get(ADMIN_ROUTES.settings, (req, res) => render(req, res, { notice: noticeFor(NOTICES, req.query.notice) }));

  router.post(ADMIN_ROUTES.settings, (req, res) => {
    const form = formFromBody(req.body ?? {});
    return withFormErrors(
      res,
      () => {
        settingsService.save(form, req.user.id);
        return seeOther(res, withNotice(PATHS.admin.settings, 'saved'));
      },
      (message) => render(req, res, { status: 400, error: message, form }),
    );
  });

  return router;
}
