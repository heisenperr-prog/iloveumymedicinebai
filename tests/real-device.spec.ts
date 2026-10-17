import { expect, test } from '@playwright/test';
import { emptyRealSnapshot } from '../backend/controller';

test('real mode renders live-format values, disables unsupported outputs, and sends actual firmware actions (mock backend)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('medibox-device-mode', 'live'));
  const snapshot = emptyRealSnapshot('http://10.216.159.229');
  snapshot.device = { online: true, ipAddress: '10.216.159.229', lastSeen: new Date().toISOString(), rtcStatus: 'synced', deviceTime: '13:45:22', deviceDate: '2026-10-08', alarm: false, lastEvent: 'Fixture: System started' };
  snapshot.integration = { firmwareProfile: 'kkk', missingTelemetry: ['Speaker output', 'Servo command state', 'LED output'], scheduleSync: 'partial', lastError: null, pollIntervalMs: 1000 };
  snapshot.compartments = ([1, 2] as const).map(compartment => ({ compartment, doorStatus: 'closed', doorSource: 'reported', reedSwitch: 'detected', servoStatus: 'unknown', ledStatus: null, currentMedicine: `Hardware medicine ${compartment}`, medicineStatus: 'WAITING' }));
  const commands: string[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/snapshot') return route.fulfill({ json: snapshot });
    if (path === '/api/commands') {
      const command = route.request().postDataJSON(); commands.push(command.type);
      if (command.type === 'test-medicine') { snapshot.compartments[0].medicineStatus = 'DUE'; snapshot.device.alarm = true; }
      if (command.type === 'acknowledge-medicine') { snapshot.compartments[0].medicineStatus = 'TAKEN'; snapshot.device.alarm = false; }
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ status: 404, json: { error: 'Unsupported mock endpoint' } });
  });
  await page.goto('/#control');
  await expect(page.getByText('REAL DEVICE MODE', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open', exact: true }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Test LED 1' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Test speaker' })).toBeDisabled();
  await expect(page.getByText('DEMO EVENT SIMULATOR', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Test medicine 1', exact: true }).click();
  await expect(page.getByText('Success: ESP32 confirmed Medicine 1 test.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge active medicine', exact: true }).click();
  await expect(page.getByText('Medicine intake acknowledged', { exact: true })).toBeVisible();
  expect(commands).toEqual(['test-medicine', 'acknowledge-medicine']);
  await page.goto('/#settings');
  await expect(page.getByText('13:45:22 2026-10-08', { exact: true })).toBeVisible();
});

test('initial real-device outage keeps the dashboard usable and retries into online state (mock backend)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('medibox-device-mode', 'live'));
  const snapshot = emptyRealSnapshot('http://10.216.159.229');
  let polls = 0;
  await page.route('**/api/snapshot', async route => {
    polls++;
    if (polls > 1) { snapshot.device.online = true; snapshot.device.lastSeen = new Date().toISOString(); }
    await route.fulfill({ json: snapshot });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'System overview' })).toBeVisible();
  await expect(page.locator('.stat-value').first()).toContainText('Online');
  expect(polls).toBeGreaterThan(1);
  await expect(page.getByText('Paracetamol', { exact: true })).toHaveCount(0);
});

test('device clocks stay literal and raw reed booleans display OPEN/CLOSED (mapping fixture)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('medibox-device-mode', 'live'));
  const snapshot = emptyRealSnapshot('http://10.216.159.229');
  snapshot.device = { online: true, ipAddress: '10.216.159.229', lastSeen: new Date().toISOString(), rtcStatus: 'synced', rtcReported: 'ACTIVE', clockValid: false, deviceTime: '79:40:09', deviceDate: '2165-25-45', alarm: false };
  snapshot.compartments = ([1, 2] as const).map(compartment => ({ compartment, doorStatus: compartment === 1 ? 'open' : 'closed', doorSource: 'reported', reed: compartment === 1, reedSwitch: compartment === 1 ? 'not-detected' : 'detected', servoStatus: 'unknown', ledStatus: null, currentMedicine: compartment === 1 ? 'biogesic' : 'katol', medicineStatus: 'WAITING' }));
  snapshot.integration!.firmwareProfile = 'kkk';
  await page.route('**/api/snapshot', route => route.fulfill({ json: snapshot }));
  await page.goto('/');
  await expect(page.locator('.topbar .clock')).toHaveText('79:40:09');
  await expect(page.locator('.topbar .top-date')).toHaveText('2165-25-45');
  await expect(page.locator('.compartment').first()).toContainText('OPEN (true)');
  await expect(page.locator('.compartment').last()).toContainText('CLOSED (false)');
  await expect(page.locator('.compartment').first().getByText('OPEN', { exact: true })).toBeVisible();
  await expect(page.locator('.compartment').last().getByText('CLOSED', { exact: true })).toBeVisible();
  await expect(page.getByText('Invalid Date', { exact: true })).toHaveCount(0);
  await page.goto('/#settings');
  await expect(page.getByText('79:40:09 2165-25-45', { exact: true })).toBeVisible();
  await expect(page.getByText('ACTIVE · synced', { exact: true })).toBeVisible();
});
