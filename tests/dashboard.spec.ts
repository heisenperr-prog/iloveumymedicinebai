import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('medibox-device-mode', 'demo'); });
});

test('dashboard loads, all seven pages work, and layout fits the viewport', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'System overview' })).toBeVisible();
  await expect(page.getByText('DEMO MODE', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-dashboard.png`, fullPage: true });
  for (const [hash, heading] of [['schedules', 'Medicine schedule'], ['monitoring', 'Live monitoring'], ['alerts', 'System alerts'], ['history', 'Medicine history'], ['control', 'Device control'], ['settings', 'Settings']]) {
    await page.goto(`/#${hash}`); await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), hash).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('schedules can be added, edited, persisted, disabled and deleted', async ({ page }) => {
  await page.goto('/#schedules'); await page.getByRole('button', { name: 'Add Medicine Schedule' }).click();
  await page.getByLabel('Medicine name', { exact: true }).fill('Test Vitamin');
  await page.getByLabel('Scheduled time', { exact: true }).fill('13:45');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByRole('cell', { name: 'Test Vitamin', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Test Vitamin', exact: true }).click();
  await page.getByLabel('Medicine name', { exact: true }).fill('Edited Vitamin');
  await page.getByLabel('Enable this daily reminder').uncheck();
  await page.getByRole('button', { name: 'Save schedule' }).click(); await page.reload();
  const row = page.getByRole('row').filter({ hasText: 'Edited Vitamin' });
  await expect(row).toContainText('Disabled');
  await page.getByRole('button', { name: 'Delete Edited Vitamin' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Edited Vitamin', exact: true })).toHaveCount(0);
});

test('demo reminder, wrong door, correct door and acknowledgment update telemetry', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Trigger schedule', exact: true }).click();
  await expect(page.getByText('Medicine reminder triggered.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open C2', exact: true }).click();
  await expect(page.locator('.event-log').getByText(/Wrong compartment opened/)).toBeVisible();
  await page.getByRole('button', { name: 'Open C1', exact: true }).click();
  await page.getByRole('button', { name: 'Acknowledge intake', exact: true }).click();
  await expect(page.getByText('Medicine intake acknowledged.', { exact: true })).toBeVisible();
  await expect(page.locator('.compartment').first().getByText('CLOSED', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Go offline', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Trigger schedule', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Trigger schedule', exact: true })).toBeEnabled();
});

test('mobile navigation opens and routes to schedules', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await page.goto('/'); await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('link', { name: 'Medicine Schedule', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Medicine schedule', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close navigation', exact: true }).first()).not.toBeVisible();
});
