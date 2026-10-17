import { expect, test } from '@playwright/test';

test('actual local backend and frontend proxy render current connectivity without hardware writes', async ({ page, request }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('medibox-device-mode', 'live'));
  const response = await request.get('/api/status');
  expect(response.ok()).toBe(true);
  const status = await response.json();
  expect(typeof status.online).toBe('boolean'); expect(status.ip).toBeTruthy();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'System overview' })).toBeVisible();
  await expect(page.getByText('REAL DEVICE MODE', { exact: true })).toBeVisible();
  await expect(page.getByText('DEMO EVENT SIMULATOR', { exact: true })).toHaveCount(0);
  await expect(page.locator('.stat-meta.mono').first()).toContainText(status.ip);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-real-connection.png`, fullPage: true });
  await testInfo.attach('actual-connection-status.json', { body: JSON.stringify(status, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('an actual backend sample preserves the original ESP32 packet and displays its clock verbatim', async ({ page, request }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('medibox-device-mode', 'live'));
  const response = await request.get('/api/snapshot'); expect(response.ok()).toBe(true);
  const snapshot = await response.json();
  expect(snapshot.device.online, 'ESP32 must respond before live mapping can be verified').toBe(true);
  expect(snapshot.integration.firmwareProfile).toBe('kkk');
  expect(snapshot.device.deviceTime).toBe(snapshot.firmwareStatus.time);
  expect(snapshot.device.deviceDate).toBe(snapshot.firmwareStatus.date);
  expect(snapshot.device.rtcStatus).toBe('synced'); expect(snapshot.firmwareStatus.rtc).toBe('ACTIVE');
  for (const slot of [1, 2]) {
    const medicine = snapshot.firmwareStatus[`med${slot}`];
    const mapped = snapshot.compartments.find((c: { compartment: number }) => c.compartment === slot);
    expect(mapped.reed).toBe(medicine.reed);
    expect(mapped.doorStatus).toBe(medicine.compartment.toLowerCase());
    expect(mapped.currentMedicine).toBe(medicine.name);
    expect(mapped.servoStatus).toBe('unknown'); expect(mapped.ledStatus).toBeNull();
  }
  // Freeze one actual received packet only for a deterministic rendering comparison.
  // No synthetic device values and no writes or hardware commands are used here.
  await page.route('**/api/snapshot', route => route.fulfill({ json: snapshot }));
  await page.goto('/#settings');
  await expect(page.locator('.topbar .clock')).toHaveText(snapshot.firmwareStatus.time);
  await expect(page.locator('.topbar .top-date')).toHaveText(snapshot.firmwareStatus.date);
  await expect(page.getByText(`${snapshot.firmwareStatus.time} ${snapshot.firmwareStatus.date}`, { exact: true })).toBeVisible();
  await expect(page.getByText('ACTIVE · synced', { exact: true })).toBeVisible();
  await testInfo.attach('verified-device-mapping.json', { body: JSON.stringify({ firmware: snapshot.firmwareStatus, mappedDevice: snapshot.device, mappedCompartments: snapshot.compartments }, null, 2), contentType: 'application/json' });
});
