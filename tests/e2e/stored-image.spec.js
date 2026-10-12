const { test, expect } = require('@playwright/test');

const ATTACK = '"><img src=x id="pwn" onerror="window.__xss=1"><svg onload="window.__xss=1">';

test('imported and stored linesheet images do not run markup', async ({ page }) => {
  await page.goto('/btv_calendar_linesheet_files/linesheet.html');
  const result = await page.evaluate(function (attack) {
    window.__xss = 0;
    window.BTV_SUPABASE_CONFIG = { url: 'https://fixture.supabase.co', anonKey: 'anon-test' };
    const stored = 'https://fixture.supabase.co/storage/v1/object/public/creative-marketing/photo.png';
    products = [
      {
        id: 'row-attack',
        groupId: 'group-attack',
        name: 'Tee',
        variant: 'Black',
        size: 'M',
        productImg: attack,
        lookbookImg: 'javascript:alert(1)',
        selectedForLinesheet: true
      },
      {
        id: 'row-stored',
        groupId: 'group-stored',
        name: 'Tote',
        variant: 'Navy',
        size: 'OS',
        productImg: stored,
        lookbookImg: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss=1">',
        selectedForLinesheet: true
      }
    ];
    renderMaster();
    renderLinesheet();
    if (typeof btvLsOpenProduct === 'function') btvLsOpenProduct('row-attack');
    return {
      xss: window.__xss,
      pwn: !!document.getElementById('pwn'),
      scripts: document.querySelectorAll('script').length,
      attackSrc: Array.from(document.querySelectorAll('img')).some(function (img) {
        return (img.getAttribute('src') || '').indexOf('javascript:') !== -1
          || (img.getAttribute('src') || '').indexOf('<') !== -1
          || (img.getAttribute('src') || '') === attack;
      }),
      stored: Array.from(document.querySelectorAll('img')).some(function (img) {
        return img.getAttribute('src') === stored;
      })
    };
  }, ATTACK);
  expect(result.xss).toBe(0);
  expect(result.pwn).toBe(false);
  expect(result.attackSrc).toBe(false);
  expect(result.stored).toBe(true);
});
