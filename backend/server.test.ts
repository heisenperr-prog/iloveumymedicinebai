import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RealDeviceController } from './controller';
import { Esp32Service, parseDeviceStatus } from './esp32Service';
import { createApiServer } from './server';
import { firmwareStatus } from './testFixtures';

describe('local backend HTTP API (isolated device fixture)', () => {
  let server: Server; let controller: RealDeviceController; let base: string;
  beforeEach(async () => {
    const service = new Esp32Service('http://127.0.0.1');
    vi.spyOn(service, 'status').mockResolvedValue(parseDeviceStatus(firmwareStatus()));
    controller = new RealDeviceController(service); await controller.poll();
    server = createApiServer(controller);
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await controller.stop(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  it('returns cached real-format status and a dashboard snapshot', async () => {
    const status = await fetch(`${base}/api/status`).then(r => r.json());
    expect(status).toMatchObject({ ...firmwareStatus(), online: true, rtc: 'ACTIVE', rtcStatus: 'synced', compartment1: { door: 'closed', reed: false, servo: 'unknown', led: null } });
    const snapshot = await fetch(`${base}/api/snapshot`).then(r => r.json());
    expect(snapshot.device.lastEvent).toBe('System started');
    expect(snapshot.firmwareStatus).toEqual(firmwareStatus());
    expect(snapshot.device.deviceTime).toBe(snapshot.firmwareStatus.time);
    expect(snapshot.device.deviceDate).toBe(snapshot.firmwareStatus.date);
  });
  it('exposes OPEN/true and CLOSED/false unchanged through status and validated UI snapshots', async () => {
    const input = firmwareStatus(); input.med1.compartment = 'OPEN'; input.med1.reed = true;
    // Substitute only the isolated test service, never the running hardware backend.
    const testService = new Esp32Service('http://127.0.0.1');
    vi.spyOn(testService, 'status').mockResolvedValue(parseDeviceStatus(input));
    const testController = new RealDeviceController(testService); await testController.poll();
    const { snapshotSchema } = await import('../src/services/validation');
    const snapshot = snapshotSchema.parse(testController.snapshot);
    expect(snapshot.firmwareStatus).toEqual(input);
    expect(snapshot.compartments).toEqual(expect.arrayContaining([
      expect.objectContaining({ compartment: 1, doorStatus: 'open', reed: true }),
      expect.objectContaining({ compartment: 2, doorStatus: 'closed', reed: false }),
    ]));
    await testController.stop();
  });
  it('returns 501 for unsupported actuator commands without fabricating a success event', async () => {
    const response = await fetch(`${base}/api/compartment/1/open`, { method: 'POST' });
    expect(response.status).toBe(501); expect((await response.json()).success).toBe(false);
    expect(controller.snapshot.history).toHaveLength(0);
  });
  it('blocks foreign browser origins and rejects invalid commands', async () => {
    expect((await fetch(`${base}/api/commands`, { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":"invented"}' })).status).toBe(400);
  });
  it('stores and deletes backend drafts while preserving physical slots', async () => {
    const response = await fetch(`${base}/api/schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ medicineName: 'Draft', compartment: 2, scheduledTime: '16:00', enabled: false, notes: '' }) });
    expect(response.ok).toBe(true);
    const draft = controller.snapshot.schedules.find(s => s.source === 'backend')!;
    expect((await fetch(`${base}/api/schedules/${draft.id}`, { method: 'DELETE' })).ok).toBe(true);
    expect(controller.snapshot.schedules).toHaveLength(2);
  });
});
