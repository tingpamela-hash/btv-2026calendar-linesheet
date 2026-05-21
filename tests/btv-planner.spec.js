// @ts-check
import { test, expect } from '@playwright/test';

const BASE_URL = 'https://btv2026calendar-linesheet.netlify.app/';

test.describe('Security — login gate', () => {
  test('page HTML includes boot overlay so it covers content from the very first paint', async ({ page }) => {
    // The #boot div must be present in the raw HTML response — before any JS runs —
    // so there is zero window where calendar content is visible without authentication.
    const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    const html = await response.text();
    expect(html).toContain('id="boot"');
  });

  test('login overlay is shown after auth check — calendar never exposed unauthenticated', async ({ page }) => {
    // domcontentloaded avoids waiting for lazy-loaded iframes (which would hang in Firefox)
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#moduleLoginOverlay')).toBeVisible({ timeout: 10000 });
    // Overlay is blocking the calendar — user has not authenticated
    await expect(page.locator('#moduleLoginOverlay')).toBeVisible();
  });

  test('nav sign-out and change-password buttons are hidden when not logged in', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#navSignOutBtn')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#navChangePwdBtn')).toBeHidden({ timeout: 10000 });
  });

  test('online presence indicator is hidden when not logged in', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#navOnlineWrap')).toBeHidden({ timeout: 10000 });
  });
});

test.describe('Navigation', () => {
  test('page has correct title', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveTitle(/BTV Planner/i);
  });

  test('top nav shows BTV Planner brand', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('.top-nav-brand')).toContainText('BTV Planner');
  });

  test('Calendar and Linesheet nav buttons are visible', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('.top-nav-btn[data-frame="cal"]')).toBeVisible();
    await expect(page.locator('.top-nav-btn[data-frame="ls"]')).toBeVisible();
  });
});

test.describe('Login overlay', () => {
  test('shows module choice step first (Calendar / Linesheet)', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    await expect(page.locator('#moduleChoiceStep')).toBeVisible();
    await expect(page.locator('#moduleLoginForm')).toBeHidden();
  });

  test('clicking Calendar shows login form with correct copy', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    await page.locator('#moduleChoiceStep button', { hasText: 'Calendar' }).click();
    await expect(page.locator('#moduleLoginForm')).toBeVisible();
    await expect(page.locator('#moduleLoginCopy')).toContainText('Calendar');
  });

  test('clicking Linesheet shows login form with correct copy', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    await page.locator('#moduleChoiceStep button', { hasText: 'Linesheet' }).click();
    await expect(page.locator('#moduleLoginForm')).toBeVisible();
    await expect(page.locator('#moduleLoginCopy')).toContainText('Linesheet');
  });

  test('Back button returns to module choice', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    await page.locator('#moduleChoiceStep button', { hasText: 'Calendar' }).click();
    await page.locator('button', { hasText: '← Back' }).click();
    await expect(page.locator('#moduleChoiceStep')).toBeVisible();
    await expect(page.locator('#moduleLoginForm')).toBeHidden();
  });

  test('wrong credentials show an error message', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    await page.locator('#moduleChoiceStep button', { hasText: 'Calendar' }).click();
    await page.fill('#moduleLoginInput', 'wrong@test.com');
    await page.fill('#moduleLoginPwd', 'wrongpassword');
    await page.locator('#loginSubmitBtn').click();
    await expect(page.locator('#moduleLoginError')).toContainText(/incorrect|invalid/i, { timeout: 12000 });
  });

  test('Forgot password link opens reset modal', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    await page.locator('#moduleChoiceStep button', { hasText: 'Calendar' }).click();
    await page.locator('button', { hasText: 'Forgot password?' }).click();
    await expect(page.locator('#btvForgotPwdModal')).toHaveClass(/show/);
  });

  test('Forgot password cancel closes modal', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    await page.locator('#moduleChoiceStep button', { hasText: 'Calendar' }).click();
    await page.locator('button', { hasText: 'Forgot password?' }).click();
    await page.locator('#btvForgotPwdModal button', { hasText: 'Cancel' }).click();
    await expect(page.locator('#btvForgotPwdModal')).not.toHaveClass(/show/);
  });

  test('Enter key submits login form', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    await page.locator('#moduleChoiceStep button', { hasText: 'Calendar' }).click();
    await page.fill('#moduleLoginInput', 'wrong@test.com');
    await page.fill('#moduleLoginPwd', 'wrongpassword');
    await page.keyboard.press('Enter');
    await expect(page.locator('#moduleLoginError')).toContainText(/incorrect|invalid/i, { timeout: 12000 });
  });

  test('password visibility toggle works', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    await page.locator('#moduleChoiceStep button', { hasText: 'Calendar' }).click();
    const pwdInput = page.locator('#moduleLoginPwd');
    await expect(pwdInput).toHaveAttribute('type', 'password');
    await page.locator('#loginPwdVisBtn').click();
    await expect(pwdInput).toHaveAttribute('type', 'text');
    await page.locator('#loginPwdVisBtn').click();
    await expect(pwdInput).toHaveAttribute('type', 'password');
  });
});
