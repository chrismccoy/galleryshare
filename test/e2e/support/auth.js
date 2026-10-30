import { expect } from '@playwright/test';
import { ADMIN } from './accounts.js';
import { PATHS } from '../../../config/urls.js';

export async function signIn(page, credentials) {
  await page.goto(PATHS.login);
  await fillLogin(page, credentials);
  await expect(page).not.toHaveURL((url) => url.pathname === PATHS.login);
}

export async function fillLogin(page, { email, password }) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

export const signInAdmin = (page) => signIn(page, ADMIN);

export async function signOut(page) {
  await page.getByRole('button', { name: 'Log out' }).first().click();
  await expect(page).toHaveURL((url) => url.pathname === PATHS.login);
}
