import { describe, expect, it, vi } from 'vitest';
import { Esp32Service, parseDeviceStatus } from './esp32Service';

import { firmwareStatus } from './testFixtures';
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

describe('kkk.ino device adapter (isolated fixture tests, no physical device)', () => {
  it('parses the user-confirmed exact schema and closed reed polarity', () => {
    const status = parseDeviceStatus(firmwareStatus());
    expect(status.profile).toBe('kkk'); expect(status.rtcStatus).toBe('synced');
    expect(status.compartments[0]).toMatchObject({ doorStatus: 'closed', reed: false, reedSwitch: 'detected', servoStatus: 'unknown', ledStatus: null, medicineStatus: 'WAITING' });
    expect(status.speaker).toBeNull(); expect(status.alarm).toBe(false);
  });
  it('maps reed=true to NOT DETECTED and preserves OPEN', () => {
    const fixture = firmwareStatus(); fixture.med1.reed = true; fixture.med1.compartment = 'OPEN';
    expect(parseDeviceStatus(fixture).compartments[0]).toMatchObject({ doorStatus: 'open', reed: true, reedSwitch: 'not-detected' });
  });
  it('does not interpret raw numeric GPIO levels as reed detection', () => {
    expect(() => parseDeviceStatus({ ...firmwareStatus(), med1: { ...firmwareStatus().med1, reed: 0 } })).toThrow();
  });
  it('maps ACTIVE to synced while preserving invalid device clock values verbatim', () => {
    const input = { ...firmwareStatus(), time: '79:40:09', date: '2165-25-45' };
    const reading = parseDeviceStatus(input);
    expect(reading).toMatchObject({ rtcStatus: 'synced', rtcReported: 'ACTIVE', clockValid: false, deviceTime: input.time, deviceDate: input.date });
    expect(reading.firmwareStatus).toEqual(input);
  });
  it('preserves every original firmware medicine field without changing boolean polarity', () => {
    const input = firmwareStatus(); input.med1.compartment = 'OPEN'; input.med1.reed = true;
    const reading = parseDeviceStatus(input);
    expect(reading.firmwareStatus).toEqual(input);
    expect(reading.compartments.map(c => c.reed)).toEqual([true, false]);
    expect(reading.deviceTime).toBe(input.time); expect(reading.deviceDate).toBe(input.date);
  });
  it('supports the smaller response actually observed on the network without inventing sensors', () => {
    const reading = parseDeviceStatus({ time: '00:00:00', date: '2000-00-00', rtc: 'ACTIVE', ip: '10.216.159.229', wifi: 'CONNECTED', med1: { name: 'biogesic', schedule: '12:56', due: false }, med2: { name: 'katol', schedule: '12:57', due: false } });
    expect(reading.profile).toBe('legacy-medbox'); expect(reading.compartments[0].doorStatus).toBe('unknown'); expect(reading.acknowledgment).toBeNull();
  });
  it('rejects unsupported direct controls without sending any network request', async () => {
    const fetcher = vi.fn(); const service = new Esp32Service('http://127.0.0.1', 100, fetcher);
    for (const command of [{ type: 'set-door', compartment: 1, open: true }, { type: 'test-led', compartment: 2 }, { type: 'test-speaker' }, { type: 'sync-rtc' }] as const) await expect(service.command(command)).rejects.toThrow('does not expose');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses GET /api/test?med=1 and the exact firmware plain-text confirmation', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(firmwareStatus())).mockResolvedValueOnce(new Response('Medicine test started')).mockResolvedValueOnce(json(firmwareStatus('DUE')));
    const result = await new Esp32Service('http://127.0.0.1', 100, fetcher).command({ type: 'test-medicine', compartment: 1 });
    expect(result.success).toBe(true); expect(fetcher.mock.calls[1][0]).toBe('http://127.0.0.1/api/test?med=1'); expect(fetcher.mock.calls[1][1].method).toBe('GET');
  });
  it('uses GET /api/ack with acknowledged status readback', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(firmwareStatus('DUE'))).mockResolvedValueOnce(new Response('Medicine 1 acknowledged')).mockResolvedValueOnce(json(firmwareStatus('TAKEN')));
    expect((await new Esp32Service('http://127.0.0.1', 100, fetcher).command({ type: 'acknowledge-medicine' })).reading.medicines[0].status).toBe('TAKEN');
    expect(fetcher.mock.calls[1][0]).toBe('http://127.0.0.1/api/ack');
  });
  it('does not treat No active medicine alert as a successful acknowledgment', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(firmwareStatus('DUE'))).mockResolvedValueOnce(new Response('No active medicine alert'));
    await expect(new Esp32Service('http://127.0.0.1', 100, fetcher).command({ type: 'acknowledge-medicine' })).rejects.toThrow('no active medicine alert');
  });
  it('rejects generic HTML 200 responses rather than reporting fake command success', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(firmwareStatus())).mockResolvedValueOnce(new Response('<html>Home page</html>')).mockResolvedValueOnce(json(firmwareStatus()));
    await expect(new Esp32Service('http://127.0.0.1', 100, fetcher).command({ type: 'test-medicine', compartment: 1 })).rejects.toThrow('not confirmed');
  });
  it('reports HTTP and network failures without retrying hardware commands', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(firmwareStatus())).mockResolvedValueOnce(new Response('Not found', { status: 404 }));
    await expect(new Esp32Service('http://127.0.0.1', 100, fetcher).command({ type: 'test-medicine', compartment: 2 })).rejects.toThrow('not available');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('writes the actual /api/set route and requires matching readback', async () => {
    const changed = firmwareStatus(); changed.med1.name = 'Updated vitamin'; changed.med1.schedule = '14:20'; changed.med1.hour = 14; changed.med1.minute = 20;
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('Schedule saved successfully!')).mockResolvedValueOnce(json(changed));
    await new Esp32Service('http://127.0.0.1', 100, fetcher).updateLegacySchedule(1, 'Updated vitamin', '14:20', 'kkk');
    const url = new URL(fetcher.mock.calls[0][0]); expect(url.pathname).toBe('/api/set'); expect(url.searchParams.get('name')).toBe('Updated vitamin'); expect(url.searchParams.get('hour')).toBe('14');
  });
  it('rejects schedule changes if the device does not confirm the new values', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('Schedule saved successfully!')).mockResolvedValueOnce(json(firmwareStatus()));
    await expect(new Esp32Service('http://127.0.0.1', 100, fetcher).updateLegacySchedule(1, 'Other', '15:00', 'kkk')).rejects.toThrow('not confirmed');
  });
});
