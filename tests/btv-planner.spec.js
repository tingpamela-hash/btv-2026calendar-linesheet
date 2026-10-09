// @ts-check
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BTV_BASE_URL || 'https://btv2026calendar-linesheet.netlify.app/';

test.describe('Security - login gate', () => {
  test('page HTML includes boot overlay so it covers content from the first paint', async ({ page }) => {
    const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    const html = await response.text();
    expect(html).toContain('id="boot"');
  });

  test('login overlay is shown after auth check', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#moduleLoginOverlay')).toBeVisible({ timeout: 10000 });
  });

  test('account controls are hidden when not logged in', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#navSignOutBtn')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#navChangePwdBtn')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#navOnlineWrap')).toBeHidden({ timeout: 10000 });
  });
});

test.describe('Navigation', () => {
  test('page has correct title and brand', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveTitle(/BTV Planner/i);
    await expect(page.locator('.top-nav-brand')).toContainText('BTV Planner');
  });

  test('restructure nav buttons are visible', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('.top-nav-btn[data-frame="global"]')).toContainText('Global Calendar');
    await expect(page.locator('.top-nav-btn[data-frame="cal"]')).toContainText('Management Calendar Input');
    await expect(page.locator('.top-nav-btn[data-frame="creative"]')).toContainText('Creative Calendar Input');
    await expect(page.locator('.top-nav-btn[data-frame="ls"]')).toContainText('Linesheet Input');
    await expect(page.locator('.top-nav-btn[data-frame="admin"]')).toContainText('Admin Settings');
  });

  test('Global Calendar is the default visible frame', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.locator('.top-nav-btn[data-frame="global"]')).toHaveClass(/active/);
    await expect(page.locator('#frame-global')).toHaveClass(/active/);
    await expect(page.locator('#frame-global')).toHaveAttribute('data-src', /mode=global/);
    await expect(page.locator('#calYearPicker')).toHaveCount(0);
  });

  test('Creative Calendar Input has its own editable-market frame', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.evaluate(() => window.showFrame('creative'));
    await expect(page.locator('.top-nav-btn[data-frame="creative"]')).toHaveClass(/active/);
    await expect(page.locator('#frame-creative')).toHaveClass(/active/);
    await expect(page.locator('#frame-creative')).toHaveAttribute('data-src', /mode=creative/);
  });

  test('Management Calendar keeps year controls inside its own page only', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.evaluate(() => window.showFrame('cal'));
    await expect(page.locator('.top-nav-btn[data-frame="cal"]')).toHaveClass(/active/);
    await expect(page.locator('#calYearPicker')).toHaveCount(0);
    const managementFrame = page.frameLocator('#frame-cal-2026');
    await expect(managementFrame.locator('#yearSelect')).toBeVisible();
    await expect(managementFrame.locator('#todayBtn')).toBeVisible();
  });

  test('Admin Settings is a top-level tab routed to the management admin screen', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.evaluate(() => window.showFrame('admin'));
    await expect(page.locator('.top-nav-btn[data-frame="admin"]')).toHaveClass(/active/);
    await expect(page.locator('#frame-cal-2026')).toHaveClass(/active/);
    const managementFrame = page.frameLocator('#frame-cal-2026');
    await expect(managementFrame.locator('#adminView')).toBeVisible();
    await expect(managementFrame.locator('#adminTabBtn')).toHaveCount(0);
  });
});

test.describe('Calendar modes', () => {
  test('Global Calendar mode removes creative-only controls from the DOM', async ({ page }) => {
    await page.goto(`${BASE_URL}btv_calendar_linesheet_files/global%20calendar.html?mode=global`);
    await expect(page.locator('#ccWebhookBtn')).toHaveCount(0);
    await expect(page.locator('#ccLoadExcelBtn')).toHaveCount(0);
    await expect(page.locator('#filterGroupStatus')).toHaveCount(0);
    await expect(page.locator('#tabSG')).toHaveCount(0);
    await expect(page.locator('body')).toContainText('Launch Calendar');
  });

  test('Creative Calendar mode keeps market input controls', async ({ page }) => {
    await page.goto(`${BASE_URL}btv_calendar_linesheet_files/global%20calendar.html?mode=creative`);
    await expect(page.locator('#tabSG')).toBeVisible();
    await expect(page.locator('#ccWebhookBtn')).toBeVisible();
    await expect(page.locator('.page-title')).toContainText('Creative Calendar Input');
  });
});

test.describe('Management Calendar Input', () => {
  test('uses management naming and removes retired version/list controls', async ({ page }) => {
    await page.goto(`${BASE_URL}btv_calendar_linesheet_files/input%20calendar-2026.html`);
    await expect(page).toHaveTitle(/Management Calendar Input/);
    await expect(page.locator('.page-title')).toContainText('Management Calendar Input');
    await expect(page.locator('#adminTabBtn')).toHaveCount(0);
    await expect(page.locator('.mgmt-topbar')).toBeVisible();
    await expect(page.locator('#launchListTabBtn')).toHaveCount(0);
    await expect(page.locator('#saveVersionBtn')).toHaveCount(0);
    await expect(page.locator('#versionHistoryBtn')).toHaveCount(0);
    await expect(page.locator('#versionNote')).toContainText('Live save');
  });

  test('jumps to the current week only when Today is pressed', async ({ page }) => {
    await page.goto(`${BASE_URL}btv_calendar_linesheet_files/input%20calendar-2026.html`);
    await page.locator('#todayBtn').click();
    const isCurrentWeekVisible = await page.evaluate(() => {
      const current = document.querySelector('th.wk.current-week, td.wk.current-week');
      if (!current) return false;
      const rect = current.getBoundingClientRect();
      return rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight;
    });
    expect(isCurrentWeekVisible).toBe(true);
  });

  test('toolbar dropdowns work and calendar scroll remains usable', async ({ page }) => {
    await page.goto(`${BASE_URL}btv_calendar_linesheet_files/input%20calendar-2026.html`);

    await page.locator('#btvDlDropWrap > button').click();
    await expect(page.locator('#btvDlMenu')).toBeVisible();
    await page.locator('#btvDlDropWrap > button').click();

    await page.locator('#btvExportDropWrap > button').click();
    await expect(page.locator('#btvExportMenu')).toBeVisible();
    await page.locator('#btvExportDropWrap > button').click();

    await page.locator('#todayBtn').click();
    const scrollWorked = await page.evaluate(() => {
      const wrap = document.querySelector('#calendarView .table-wrap');
      if (!wrap) return false;
      const canScrollX = wrap.scrollWidth > wrap.clientWidth + 20;
      const canScrollY = wrap.scrollHeight > wrap.clientHeight + 20;
      wrap.scrollLeft = Math.min(700, wrap.scrollWidth);
      wrap.scrollTop = Math.min(320, wrap.scrollHeight);
      return canScrollX && canScrollY && wrap.scrollLeft > 0 && wrap.scrollTop > 0;
    });
    expect(scrollWorked).toBe(true);
  });

});

test.describe('Login overlay', () => {
  test('shows unified login form first', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    await expect(page.locator('#moduleLoginForm')).toBeVisible();
    await expect(page.locator('#moduleLoginCopy')).toContainText('BTV Planner');
  });

  test('wrong credentials show an error message', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    await page.fill('#moduleLoginInput', 'wrong@test.com');
    await page.fill('#moduleLoginPwd', 'wrongpassword');
    await page.locator('#loginSubmitBtn').click();
    await expect(page.locator('#moduleLoginError')).toContainText(/incorrect|invalid/i, { timeout: 12000 });
  });

  test('Forgot password link opens and closes reset modal', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    await page.locator('button', { hasText: 'Forgot password?' }).click();
    await expect(page.locator('#btvForgotPwdModal')).toHaveClass(/show/);
    await page.locator('#btvForgotPwdModal button', { hasText: 'Cancel' }).click();
    await expect(page.locator('#btvForgotPwdModal')).not.toHaveClass(/show/);
  });

  test('Enter key submits login form', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    await page.fill('#moduleLoginInput', 'wrong@test.com');
    await page.fill('#moduleLoginPwd', 'wrongpassword');
    await page.keyboard.press('Enter');
    await expect(page.locator('#moduleLoginError')).toContainText(/incorrect|invalid/i, { timeout: 12000 });
  });

  test('password visibility toggle works', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#moduleLoginOverlay.show', { timeout: 10000 });
    const pwdInput = page.locator('#moduleLoginPwd');
    await expect(pwdInput).toHaveAttribute('type', 'password');
    await page.locator('#loginPwdVisBtn').click();
    await expect(pwdInput).toHaveAttribute('type', 'text');
    await page.locator('#loginPwdVisBtn').click();
    await expect(pwdInput).toHaveAttribute('type', 'password');
  });
});
