import { z } from 'zod';
import { firmwareStatusSchema } from '../src/services/validation.ts';
import type { CompartmentId, CompartmentStatus, DeviceCommand, DeviceStatus, Esp32FirmwareStatus } from '../src/types/index.ts';

const slot = z.union([z.literal(1), z.literal(2)]);

const medicine = z.object({
  name: z.string().min(1),
  schedule: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  due: z.boolean().optional(),
  status: z.enum(['DUE', 'TAKEN', 'WAITING']).optional(),
  compartment: z.union([z.string(), z.number()]).optional(),
  reed: z.union([z.boolean(), z.string(), z.number()]).optional(),
  hour: z.number().optional(),
  minute: z.number().optional(),

  // NEW: ESP32 output telemetry
  servo: z.enum(['OPENING', 'OPEN', 'CLOSING', 'CLOSED']).optional(),
  led: z.boolean().optional()

}).refine(
  m => m.due !== undefined || m.status !== undefined,
  'Medicine requires due or DUE/TAKEN/WAITING status.'
);

const sensor = z.object({
  door: z.enum(['open', 'closed']).optional(),
  reed: z.boolean().optional(),
  servo: z.enum([
    'locked',
    'unlocked',
    'fault',
    'opening',
    'open',
    'closing',
    'closed'
  ]).optional(),
  led: z.boolean().optional()
});
const acknowledgment = z.union([z.boolean(), z.object({ acknowledged: z.boolean(), id: z.string().optional(), compartment: slot.optional(), medicineName: z.string().optional(), timestamp: z.string().datetime().optional() })]);
const extras = {
  acknowledgment: acknowledgment.optional(), acknowledgmentId: z.string().optional(),
  speaker: z.boolean().optional(), compartment1: sensor.optional(), compartment2: sensor.optional(),
  events: z.array(z.object({ id: z.string(), type: z.enum(['wrong-compartment', 'unexpected-opening', 'acknowledgment-pending', 'medicine-acknowledged', 'missed-medicine']), compartment: slot.optional(), medicineName: z.string().optional(), message: z.string().optional(), timestamp: z.string().datetime().optional() })).optional(),
};
// Observed on the physical ESP32 on 2026-10-08. No GPIO assumptions.
const legacy = z.object({ time: z.string(), date: z.string(), rtc: z.string(), ip: z.string().ip(), wifi: z.string(), med1: medicine, med2: medicine, alarm: z.union([z.boolean(), z.string()]).optional(), lastEvent: z.union([z.string(), z.object({ id: z.string().optional(), message: z.string(), timestamp: z.string().datetime().optional() })]).optional(), ...extras });
export const kkkStatusSchema = firmwareStatusSchema;
// Explicit optional firmware contract supplied in the project update.
const modern = z.object({ online: z.boolean(), device: z.string().optional(), ip: z.string().ip(), rtc: z.union([z.boolean(), z.string()]), timestamp: z.string().optional(), ...extras, compartment1: sensor, compartment2: sensor });

export interface DeviceReading {
  firmwareStatus?: Esp32FirmwareStatus;
  rtcReported: string | null; clockValid: boolean;
  profile: 'kkk' | 'legacy-medbox' | 'compartment-status';
  online: boolean; ip: string; name?: string;
  rtcStatus: DeviceStatus['rtcStatus']; deviceTime: string | null; deviceDate: string | null;
  compartments: CompartmentStatus[];
  medicines: { compartment: CompartmentId; name: string; time: string; due: boolean; status: 'DUE' | 'TAKEN' | 'WAITING' | 'unknown' }[];
  acknowledgment: { active: boolean; id?: string; compartment?: CompartmentId; medicineName?: string; timestamp?: string } | null;
  speaker: boolean | null; missing: string[];
  events: z.infer<typeof legacy>['events'];
  alarm: string | boolean | null; lastEvent: string | null;
}

function validRtcDate(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return year >= 2020 && parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

export function parseDeviceStatus(raw: unknown): DeviceReading {
  const exact = kkkStatusSchema.safeParse(raw);
  const old = legacy.safeParse(raw);
  // Add no fields to the physical contract; optional metadata is only backend-owned.
  // Parse with the updated schema so Zod preserves med1/med2 servo and led.
  // The older firmwareStatusSchema can strip these newly added fields.
  const data: z.infer<typeof legacy> | z.infer<typeof modern> =
    old.success ? old.data : modern.parse(raw);
  const isLegacy = 'med1' in data;
  const isKkk = isLegacy && data.med1.status !== undefined && data.med2.status !== undefined;
  const missing: string[] = [];
  const compartments = ([1, 2] as const).map(compartment => {
    const m = isLegacy ? (compartment === 1 ? data.med1 : data.med2) : undefined;
    const rawReed = m?.reed;
    // Numeric GPIO levels are intentionally not inverted or interpreted without kkk.ino.
    // kkk.ino explicitly reports reed=true for OPEN (magnet not detected).
    const reportedReed = typeof rawReed === 'boolean' ? (isKkk ? rawReed : undefined) : typeof rawReed === 'string' && ['DETECTED', 'CLOSED'].includes(rawReed.toUpperCase()) ? true : typeof rawReed === 'string' && ['NOT DETECTED', 'NOT_DETECTED', 'NOT-DETECTED', 'OPEN'].includes(rawReed.toUpperCase()) ? false : undefined;
    const reportedDoor = typeof m?.compartment === 'string' && ['OPEN', 'CLOSED'].includes(m.compartment.toUpperCase()) ? m.compartment.toLowerCase() as 'open' | 'closed' : undefined;

const reportedServo = m?.servo?.toLowerCase() as
  | 'opening'
  | 'open'
  | 'closing'
  | 'closed'
  | undefined;

const reportedLed = m?.led;

const existingSensor =
  compartment === 1
    ? data.compartment1
    : data.compartment2;

const c = {
  ...existingSensor,
  reed: existingSensor?.reed ?? reportedReed,
  door: existingSensor?.door ?? reportedDoor,
  servo: existingSensor?.servo ?? reportedServo,
  led: existingSensor?.led ?? reportedLed
};
    if (c?.reed === undefined) missing.push(`Compartment ${compartment} reed switch`);
    if (c?.door === undefined && c?.reed === undefined) missing.push(`Compartment ${compartment} door`);
    if (c?.servo === undefined) missing.push(`Compartment ${compartment} servo command state`);
    if (c?.led === undefined) missing.push(`Compartment ${compartment} LED`);
    return {
      compartment, doorStatus: c?.door ?? (c?.reed === undefined ? 'unknown' : c.reed ? 'closed' : 'open'),
      doorSource: c?.door !== undefined ? 'reported' : c?.reed !== undefined ? 'reed' : 'unavailable',
      reed: isKkk ? rawReed as boolean : undefined,
      reedSwitch: c?.reed === undefined ? 'unknown' : isKkk ? (c.reed ? 'not-detected' : 'detected') : c.reed ? 'detected' : 'not-detected',
      // Preserve the actual commanded servo state from the ESP32.
      // Type assertion keeps this file compatible with the existing shared type;
      // add these values to CompartmentStatus['servoStatus'] in src/types/index.ts
      // if you want the frontend type to explicitly recognize them.
      servoStatus: (c?.servo ?? 'unknown') as CompartmentStatus['servoStatus'],
      ledStatus: c?.led ?? null,
      currentMedicine: isLegacy ? (compartment === 1 ? data.med1.name : data.med2.name) : 'Not reported by device',
      medicineStatus: m?.status ?? (m?.due === true ? 'DUE' : 'unknown'),
    } satisfies CompartmentStatus;
  });
  if (data.acknowledgment === undefined && !isKkk) missing.push('Push-button acknowledgment');
  if (data.speaker === undefined) missing.push('Speaker output');
  const ack = data.acknowledgment;
  const rtc = typeof data.rtc === 'string' ? data.rtc.toUpperCase() : data.rtc;
  const rtcStatus: DeviceStatus['rtcStatus'] = rtc === false || rtc === 'ERROR' || rtc === 'INACTIVE' ? 'error' : rtc === true || rtc === 'SYNCED' || rtc === 'ACTIVE' ? 'synced' : 'unknown';
  return {
    firmwareStatus: exact.success ? exact.data : undefined,
    rtcReported: typeof data.rtc === 'string' ? data.rtc : null,
    clockValid: isLegacy ? validRtcDate(data.date, data.time) : false,
    profile: isKkk ? 'kkk' : isLegacy ? 'legacy-medbox' : 'compartment-status',
    online: isLegacy ? data.wifi.toUpperCase() === 'CONNECTED' : data.online, ip: data.ip,
    name: 'device' in data ? data.device : undefined, rtcStatus,
    deviceTime: isLegacy ? data.time : ('timestamp' in data ? data.timestamp ?? null : null),
    deviceDate: isLegacy ? data.date : null,
    compartments,
    medicines: isLegacy ? ([1, 2] as const).map(compartment => { const m = compartment === 1 ? data.med1 : data.med2; return { compartment, name: m.name, time: m.schedule, due: m.status ? m.status === 'DUE' : m.due === true, status: m.status ?? (m.due === true ? 'DUE' : 'unknown') }; }) : [],
    acknowledgment: ack === undefined ? null : typeof ack === 'boolean' ? { active: ack, id: data.acknowledgmentId } : { active: ack.acknowledged, id: ack.id, compartment: ack.compartment, medicineName: ack.medicineName, timestamp: ack.timestamp },
    speaker: data.speaker ?? null, missing, events: data.events,
    alarm: isLegacy ? data.alarm ?? null : null,
    lastEvent: isLegacy ? typeof data.lastEvent === 'string' ? data.lastEvent : data.lastEvent?.message ?? null : null,
  };
}

export class DeviceApiError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

export class Esp32Service {
  readonly baseUrl: string;
  private timeoutMs: number;
  private fetcher: typeof fetch;
  constructor(baseUrl: string, timeoutMs = 1800, fetcher: typeof fetch = fetch) {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('ESP32_URL must be an HTTP(S) device URL without credentials.');
    this.baseUrl = parsed.origin; this.timeoutMs = timeoutMs; this.fetcher = fetcher;
  }
  private async request(path: string, method: 'GET' | 'POST') {
    let response: Response;
    try { response = await this.fetcher(`${this.baseUrl}${path}`, { method, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error', headers: { Accept: 'application/json' } }); }
    catch (error) { throw new DeviceApiError(`ESP32 communication failed: ${error instanceof Error ? error.message : 'network error'}`, 504); }
    if (!response.ok) throw new DeviceApiError(`ESP32 returned HTTP ${response.status} for ${method} ${path}. ${response.status === 404 ? 'This route is not available in the current firmware.' : 'The command was not confirmed.'}`, response.status === 404 ? 501 : 502);
    const body = await response.text();
    return { body, contentType: response.headers.get('content-type') || '' };
  }
  async status(): Promise<DeviceReading> {
  const response = await this.request('/api/status', 'GET');

  try {
    const raw = JSON.parse(response.body);
    return parseDeviceStatus(raw);
  } catch (error) {
    console.error('ESP32 PARSE ERROR:', error);
    console.error('ESP32 RAW BODY:', response.body);

    throw new DeviceApiError(
      `ESP32 /api/status parse error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
  async command(command: DeviceCommand) {
    if (command.type !== 'test-medicine' && command.type !== 'acknowledge-medicine') throw new DeviceApiError('kkk.ino does not expose direct servo open/close, LED-only, speaker-only, or RTC-sync commands. Use its existing medicine test/acknowledgment functions. No unsupported request was sent to the ESP32.', 501);
    const before = await this.status();
    if (!before.online) throw new DeviceApiError('ESP32 reports offline.', 503);
    if (command.type === 'acknowledge-medicine' && !before.medicines.some(m => m.due)) throw new DeviceApiError('ESP32 reports no active medicine to acknowledge.', 409);
    const path = command.type === 'test-medicine' ? `/api/test?med=${command.compartment}` : '/api/ack';
    const { body } = await this.request(path, 'GET');
    const text = body.trim();
    if (text === 'No active medicine alert') throw new DeviceApiError('ESP32 reports no active medicine alert. No acknowledgment was recorded.', 409);
    let explicit = command.type === 'test-medicine' ? text === 'Medicine test started' : /^Medicine [12] acknowledged$/.test(text);
    try {
      const confirmation = z.object({ success: z.boolean().optional(), ok: z.boolean().optional(), status: z.string().optional() }).parse(JSON.parse(body));
      if (confirmation.success === false || confirmation.ok === false) throw new DeviceApiError('ESP32 explicitly rejected the command.');
      explicit ||= confirmation.success === true || confirmation.ok === true || ['success', 'ok', 'completed', 'accepted'].includes(confirmation.status?.toLowerCase() || '');
    } catch (error) { if (error instanceof DeviceApiError) throw error; }
    const after = await this.status();
    const readback = after.online && (command.type === 'test-medicine'
      ? !before.medicines.some(m => m.compartment === command.compartment && m.due) && after.medicines.some(m => m.compartment === command.compartment && m.due)
      : before.medicines.some(m => m.due && after.medicines.some(next => next.compartment === m.compartment && next.status === 'TAKEN')));
    if (!explicit && !readback) throw new DeviceApiError('Command not confirmed: the ESP32 returned no explicit JSON acknowledgment and status readback did not confirm the requested change. The request may have reached the device; inspect it before retrying.');
    const acknowledgmentMatch = /^Medicine ([12]) acknowledged$/.exec(text);
    const acknowledgedCompartment = command.type === 'acknowledge-medicine' && acknowledgmentMatch ? Number(acknowledgmentMatch[1]) as CompartmentId : undefined;
    return { success: true as const, message: 'ESP32 confirmed the medicine command.', reading: after, acknowledgedCompartment };
  }
  async updateLegacySchedule(compartment: CompartmentId, name: string, time: string, profile: DeviceReading['profile']) {
    const [hour, minute] = time.split(':').map(Number);
    const query = new URLSearchParams({ med: String(compartment), name, hour: String(hour), minute: String(minute) });
    // GET is used only because this write route was discovered in the ESP32's existing page.
    const response = await this.request(`${profile === 'kkk' ? '/api/set' : '/set'}?${query}`, 'GET');
    if (profile === 'kkk' && response.body.trim() !== 'Schedule saved successfully!') throw new DeviceApiError('ESP32 did not return its documented schedule confirmation. Check device state before retrying.');
    const reading = await this.status();
    if (!reading.online || !reading.medicines.some(m => m.compartment === compartment && m.name === name && m.time === time)) throw new DeviceApiError('Schedule write was not confirmed by the ESP32 status readback.');
    return reading;
  }
}
