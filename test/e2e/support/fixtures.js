import { test as base, expect } from '@playwright/test';
import { signInAdmin } from './auth.js';
import { DEFAULT_SETTINGS, saveAdminSettings } from './admin.js';

export { expect };
export { ADMIN, USERS } from './accounts.js';
export * from './names.js';
export * from './auth.js';
export * from './admin.js';
export * from './galleries.js';

const CSP_MARK = '[e2e] CSP violation:';

function isOwnDocument4xx(text, url, pageUrl) {
  return /^Failed to load resource: the server responded with a status of 4\d\d/.test(text) && url === pageUrl;
}

class Guard {
  constructor() {
    this.problems = [];
    this.allowed = [];
  }

  allow(pattern) {
    this.allowed.push(pattern);
  }

  record(text) {
    if (this.allowed.some((pattern) => pattern.test(text))) return;
    this.problems.push(text);
  }

  async watch(page) {
    await page.addInitScript((mark) => {
      document.addEventListener('securitypolicyviolation', (event) => {
        console.error(`${mark} ${event.violatedDirective} blocked ${event.blockedURI || '(inline)'}`);
      });
    }, CSP_MARK);
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (isOwnDocument4xx(msg.text(), msg.location()?.url, page.url())) return;
      const where = msg.location()?.url ? ` (${msg.location().url})` : '';
      this.record(`console error: ${msg.text()}${where}`);
    });
    page.on('pageerror', (error) => this.record(`page error: ${error.message}`));
    return page;
  }
}

export const test = base.extend({
  guard: [
    async ({}, use) => {
      const guard = new Guard();
      await use(guard);
      expect(guard.problems, 'browser console errors, page errors or CSP violations').toEqual([]);
    },
    { auto: true },
  ],

  page: async ({ page, guard }, use) => {
    await guard.watch(page);
    await use(page);
  },

  openPage: async ({ browser, guard }, use) => {
    const contexts = [];
    await use(async (extra = {}) => {
      const context = await browser.newContext(extra);
      contexts.push(context);
      return guard.watch(await context.newPage());
    });
    for (const context of contexts) await context.close();
  },

  withOverrides: async ({ openPage }, use) => {
    let admin = null;
    await use(async (overridesOn, { toggles, fields, choices } = {}) => {
      if (!admin) {
        admin = await openPage();
        await signInAdmin(admin);
      }
      await saveAdminSettings(admin, { overridesOn, toggles, fields, choices });
      return admin;
    });
    if (admin) await saveAdminSettings(admin, DEFAULT_SETTINGS);
  },
});
