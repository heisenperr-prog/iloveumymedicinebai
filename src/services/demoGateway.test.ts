import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoGateway, STORAGE_KEY } from './demoGateway';
import type { MedicineSchedule, Snapshot } from '../types';

describe('demo medicine controller', () => {
  let gateway: DemoGateway;
  let now: Date;
  let stored: Map<string, string>;
  const state = () => gateway.getSnapshot()!;
  const pending = () => state().history.filter(h => h.result === 'Pending');
  const trigger = (scheduleId = 'med-1') => gateway.simulate({ type: 'trigger', scheduleId });
  const schedule: Omit<MedicineSchedule, 'id'> = { medicineName: 'Demo vitamin', compartment: 1, scheduledTime: '12:30', notes: '', enabled: true };
  beforeEach(async () => {
    vi.useFakeTimers(); now = new Date(2026, 9, 8, 11, 0, 0); stored = new Map();
    gateway = new DemoGateway({ getItem: key => stored.get(key) || null, setItem: (key, value) => { stored.set(key, value); } }, () => now);
    await gateway.connect();
  });
  afterEach(() => { gateway.disconnect(); vi.useRealTimers(); });
  it('creates, edits, persists and deletes schedules without changing historical records', async () => {
    await gateway.saveSchedule(schedule);
    const added = state().schedules.find(m => m.medicineName === schedule.medicineName)!;
    await gateway.saveSchedule({ ...added, medicineName: 'Edited vitamin', compartment: 2, scheduledTime: '16:30' });
    expect(state().compartments[1].currentMedicine).toContain('Edited vitamin');
    expect(JSON.parse(stored.get(STORAGE_KEY)!).schedules).toContainEqual(expect.objectContaining({ id: added.id, scheduledTime: '16:30' }));
    const count = state().history.length;
    await gateway.deleteSchedule(added.id);
    expect(state().schedules.some(m => m.id === added.id)).toBe(false);
    expect(state().history).toHaveLength(count);
  });
  it('validates medicine names, times, and duplicate active compartment times', async () => {
    await expect(gateway.saveSchedule({ ...schedule, scheduledTime: '25:00' })).rejects.toThrow();
    await expect(gateway.saveSchedule({ ...schedule, medicineName: '  ' })).rejects.toThrow();
    await expect(gateway.saveSchedule({ ...schedule, scheduledTime: '08:00' })).rejects.toThrow('already uses');
  });
  it('requires a healthy correct compartment before push-button acknowledgment', async () => {
    await trigger();
    expect(state().speakerActive).toBe(true);
    expect(state().compartments[0].ledStatus).toBe(true);
    await expect(gateway.simulate({ type: 'acknowledge' })).rejects.toThrow('Open compartment 1');
    await gateway.simulate({ type: 'open', compartment: 1 });
    await gateway.simulate({ type: 'acknowledge' });
    expect(pending()).toHaveLength(0);
    expect(state().history[0]).toMatchObject({ result: 'Acknowledged', acknowledged: true, openedCompartment: 1 });
    expect(state().speakerActive).toBe(false);
    expect(state().compartments[0]).toMatchObject({ doorStatus: 'closed', reedSwitch: 'detected', ledStatus: false });
  });
  it('records wrong openings while preserving the pending reminder', async () => {
    await trigger(); await gateway.simulate({ type: 'open', compartment: 2 });
    expect(state().alerts.some(a => a.type === 'wrong-compartment' && a.severity === 'critical')).toBe(true);
    expect(state().history.some(h => h.result === 'Wrong compartment')).toBe(true);
    expect(pending()).toHaveLength(1);
    await expect(gateway.simulate({ type: 'acknowledge' })).rejects.toThrow();
  });
  it('keeps alert review separate from intake acknowledgment', async () => {
    await trigger();
    await gateway.acknowledgeAlert(state().alerts[0].id);
    expect(pending()).toHaveLength(1); expect(state().speakerActive).toBe(true);
  });
  it('expires pending reminders and deactivates outputs', async () => {
    await trigger(); now = new Date(+now + 61000); gateway.tick();
    expect(pending()).toHaveLength(0);
    expect(state().alerts.some(a => a.type === 'missed-medicine')).toBe(true);
    expect(state().speakerActive).toBe(false);
    expect(state().compartments[0].ledStatus).toBe(false);
  });
  it('triggers editable schedules once at their configured time', async () => {
    await gateway.saveSchedule({ ...schedule, scheduledTime: '11:01' });
    now = new Date(+now + 60000); gateway.tick(); gateway.tick();
    expect(pending()).toHaveLength(1); expect(pending()[0].medicineName).toBe(schedule.medicineName);
  });
  it('catches a reminder across midnight after a browser sleep', async () => {
    now = new Date(2026, 9, 8, 23, 58); gateway.tick();
    await gateway.saveSchedule({ ...schedule, scheduledTime: '23:59' });
    now = new Date(2026, 9, 9, 0, 1); gateway.tick();
    expect(state().history.some(h => h.medicineName === schedule.medicineName && h.result === 'Pending')).toBe(true);
  });
  it('rejects commands offline and records a scheduled offline dose as missed', async () => {
    await gateway.saveSchedule({ ...schedule, scheduledTime: '11:01' });
    await gateway.simulate({ type: 'connection', online: false });
    await expect(gateway.command({ type: 'test-speaker' })).rejects.toThrow('offline');
    now = new Date(+now + 60000); gateway.tick();
    expect(state().history.some(h => h.medicineName === schedule.medicineName && h.result === 'Missed')).toBe(true);
    await gateway.simulate({ type: 'connection', online: true });
    expect(state().device.online).toBe(true);
  });
  it('does not misclassify simultaneous reminders for two compartments', async () => {
    await trigger(); await trigger('med-2');
    await gateway.simulate({ type: 'open', compartment: 2 });
    expect(state().alerts.some(a => a.type === 'wrong-compartment')).toBe(false);
    await gateway.simulate({ type: 'acknowledge' });
    expect(pending()).toHaveLength(1); expect(pending()[0].requiredCompartment).toBe(1);
  });
  it('blocks acknowledgment on reed faults and allows fault recovery', async () => {
    await trigger(); await gateway.simulate({ type: 'reed-fault', compartment: 1 });
    await gateway.simulate({ type: 'open', compartment: 1 });
    await expect(gateway.simulate({ type: 'acknowledge' })).rejects.toThrow('healthy reed');
    await gateway.simulate({ type: 'reed-fault', compartment: 1 });
    await gateway.simulate({ type: 'acknowledge' }); expect(pending()).toHaveLength(0);
  });
  it('blocks faulty servos and logs manual control without confirming intake', async () => {
    await gateway.simulate({ type: 'servo-fault', compartment: 1 });
    await expect(gateway.command({ type: 'set-door', compartment: 1, open: true })).rejects.toThrow('servo fault');
    await gateway.simulate({ type: 'servo-fault', compartment: 1 });
    await trigger(); await gateway.command({ type: 'set-door', compartment: 1, open: true });
    expect(state().history.some(h => h.result === 'Manual override' && !h.acknowledged)).toBe(true);
    expect(pending()).toHaveLength(1);
  });
  it('resets physical states and marks unresolved reminders missed on reload', async () => {
    await trigger(); gateway.disconnect();
    const restored = new DemoGateway({ getItem: key => stored.get(key) || null, setItem: (key, value) => { stored.set(key, value); } }, () => now);
    await restored.connect();
    const snapshot = restored.getSnapshot() as Snapshot;
    expect(snapshot.history.some(h => h.result === 'Pending')).toBe(false);
    expect(snapshot.compartments.every(c => c.doorStatus === 'closed')).toBe(true);
    restored.disconnect();
  });
  it('reports corrupt saved data and unavailable storage without crashing', async () => {
    const fallback = new DemoGateway({ getItem: () => '{bad json', setItem: () => { throw new Error('full'); } }, () => now);
    await fallback.connect(); expect(fallback.getSnapshot()?.storageWarning).toContain('session only'); fallback.disconnect();
  });
  it('deactivates diagnostic outputs after three seconds', async () => {
    await gateway.command({ type: 'test-led', compartment: 1 }); await gateway.command({ type: 'test-speaker' });
    expect(state().speakerActive).toBe(true); now = new Date(+now + 3001); gateway.tick();
    expect(state().speakerActive).toBe(false); expect(state().compartments[0].ledStatus).toBe(false);
  });
});
