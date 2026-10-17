import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealDeviceController } from './controller';
import { Esp32Service, parseDeviceStatus } from './esp32Service';
import { firmwareStatus } from './testFixtures';

describe('real-device state controller (isolated fixtures)', () => {
  let controller: RealDeviceController;
  let service: Esp32Service;
  beforeEach(() => { service = new Esp32Service('http://10.216.159.229'); controller = new RealDeviceController(service); });
  afterEach(async () => { await controller.stop(); });
  const read = async (value: unknown) => { vi.spyOn(service, 'status').mockResolvedValue(parseDeviceStatus(value)); await controller.poll(); };
  it('starts offline with no fake medicine names, schedules, history or sensor values', () => {
    expect(controller.snapshot.device).toMatchObject({ online: false, lastSeen: null });
    expect(controller.snapshot.schedules).toEqual([]); expect(controller.snapshot.history).toEqual([]);
    expect(controller.snapshot.compartments[0].ledStatus).toBeNull();
  });
  it('imports device schedules and actual RTC/lastEvent without starting a duplicate scheduler', async () => {
    await read(firmwareStatus());
    expect(controller.snapshot.schedules[0]).toMatchObject({ source: 'device', syncStatus: 'synced', scheduledTime: '11:08' });
    expect(controller.snapshot.device.deviceTime).toBe('13:45:22'); expect(controller.snapshot.device.lastEvent).toBe('System started');
    expect(controller.snapshot.history).toHaveLength(0);
  });
  it('records DUE and physical TAKEN transitions exactly once', async () => {
    await read(firmwareStatus()); await read(firmwareStatus('DUE')); await read(firmwareStatus('TAKEN')); await read(firmwareStatus('TAKEN'));
    expect(controller.snapshot.history).toHaveLength(1); expect(controller.snapshot.history[0]).toMatchObject({ result: 'Acknowledged', requiredCompartment: 1, acknowledged: true });
    expect(controller.snapshot.events.filter(e => e.message === 'Medicine intake acknowledged')).toHaveLength(1);
  });
  it('does not fabricate a new button press when the first connection already reports TAKEN', async () => {
    await read(firmwareStatus('TAKEN')); expect(controller.snapshot.history).toHaveLength(0);
  });
  it('does not mistake a cleared due flag for a physical acknowledgment', async () => {
    await read(firmwareStatus('DUE')); await read(firmwareStatus());
    expect(controller.snapshot.history[0]).toMatchObject({ result: 'Unconfirmed', acknowledged: false });
  });
  it('detects a real wrong-door transition against firmware DUE state', async () => {
    await read(firmwareStatus('DUE'));
    const opened = firmwareStatus('DUE'); opened.med2.compartment = 'OPEN'; opened.med2.reed = true; await read(opened);
    expect(controller.snapshot.history.some(h => h.result === 'Wrong compartment' && h.openedCompartment === 2)).toBe(true);
    expect(controller.snapshot.alerts.some(a => a.type === 'wrong-compartment')).toBe(true);
  });
  it('preserves lastSeen, marks offline, deduplicates outages and reconnects automatically', async () => {
    await read(firmwareStatus()); const lastSeen = controller.snapshot.device.lastSeen;
    vi.spyOn(service, 'status').mockRejectedValue(new Error('Timed out')); await controller.poll(); await controller.poll();
    expect(controller.snapshot.device).toMatchObject({ online: false, lastSeen });
    expect(controller.snapshot.alerts.filter(a => a.type === 'device-disconnected')).toHaveLength(1);
    await read(firmwareStatus()); expect(controller.snapshot.device.online).toBe(true);
    expect(controller.snapshot.events.some(e => e.message.includes('reconnected'))).toBe(true);
  });
  it('supports full CRUD for backend drafts without silently running them on hardware', async () => {
    const spy = vi.spyOn(service, 'updateLegacySchedule');
    await controller.saveSchedule({ medicineName: 'Draft', compartment: 1, scheduledTime: '14:00', enabled: true, notes: '' });
    const id = controller.snapshot.schedules[0].id;
    await controller.saveSchedule({ ...controller.snapshot.schedules[0], enabled: false }, id);
    expect(controller.snapshot.schedules[0]).toMatchObject({ enabled: false, syncStatus: 'draft' });
    await controller.deleteSchedule(id); expect(controller.snapshot.schedules).toEqual([]); expect(spy).not.toHaveBeenCalled();
  });
  it('rejects unsupported device slot disable/delete rather than lying about hardware state', async () => {
    await read(firmwareStatus()); const schedule = controller.snapshot.schedules[0];
    await expect(controller.saveSchedule({ ...schedule, enabled: false }, schedule.id)).rejects.toThrow('name/time edits only');
    await expect(controller.deleteSchedule(schedule.id)).rejects.toThrow('no confirmed');
  });
  it('deduplicates overlapping polls instead of flooding the ESP32', async () => {
    let resolve!: (value: ReturnType<typeof parseDeviceStatus>) => void;
    const spy = vi.spyOn(service, 'status').mockImplementation(() => new Promise(r => { resolve = r; }));
    const first = controller.poll(); const second = controller.poll(); expect(first).toBe(second);
    resolve(parseDeviceStatus(firmwareStatus())); await Promise.all([first, second]); expect(spy).toHaveBeenCalledOnce();
  });
  it('serializes status polling with hardware mutations so stale responses cannot overwrite confirmation', async () => {
    await read(firmwareStatus('DUE'));
    let resolve!: (value: Awaited<ReturnType<Esp32Service['command']>>) => void;
    const command = vi.spyOn(service, 'command').mockImplementation(() => new Promise(r => { resolve = r; }));
    const status = vi.spyOn(service, 'status'); status.mockClear();
    const mutation = controller.command({ type: 'acknowledge-medicine' });
    await Promise.resolve(); await controller.poll();
    expect(status).not.toHaveBeenCalled(); expect(command).toHaveBeenCalledOnce();
    resolve({ success: true, message: 'confirmed', reading: parseDeviceStatus(firmwareStatus('TAKEN')), acknowledgedCompartment: 1 });
    await mutation;
    expect(controller.snapshot.history.filter(h => h.result === 'Acknowledged')).toHaveLength(1);
  });
});
