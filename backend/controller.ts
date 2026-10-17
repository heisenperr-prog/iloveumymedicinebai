import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { persistedSchema, scheduleSchema, settingsSchema } from '../src/services/validation.ts';
import type { Alert, CompartmentId, DeviceCommand, MedicineSchedule, Settings, Snapshot } from '../src/types/index.ts';
import { DeviceApiError, Esp32Service } from './esp32Service.ts';
import type { DeviceReading } from './esp32Service.ts';

export function emptyRealSnapshot(baseUrl: string): Snapshot {
  const ipAddress = new URL(baseUrl).hostname;
  return {
    device: { online: false, ipAddress, lastSeen: null, rtcStatus: 'unknown', deviceTime: null, deviceDate: null, acknowledgment: null },
    compartments: ([1, 2] as const).map(compartment => ({ compartment, doorStatus: 'unknown', doorSource: 'unavailable', reedSwitch: 'unknown', servoStatus: 'unknown', ledStatus: null, currentMedicine: 'Not reported by device' })),
    settings: { deviceName: 'Medicine Box 01', ipAddress, refreshInterval: 1, alertTimeout: 60 },
    schedules: [], alerts: [], history: [], events: [], speakerActive: null, storageWarning: null,
    integration: { firmwareProfile: null, missingTelemetry: ['Waiting for the first ESP32 response'], scheduleSync: 'unavailable', lastError: null, pollIntervalMs: 1000 },
  };
}

export class RealDeviceController {
  snapshot: Snapshot;
  private service: Esp32Service;
  private storagePath?: string;
  private previous: DeviceReading | null = null;
  private observedIds = new Set<string>();
  private ackBaseline: boolean | null = null;
  private pollJob?: Promise<void>;
  private saveJob = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private commandBusy = false;
  private listeners = new Set<() => void>();
  constructor(service: Esp32Service, storagePath?: string) { this.service = service; this.storagePath = storagePath; this.snapshot = emptyRealSnapshot(service.baseUrl); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private event(message: string, level: Snapshot['events'][number]['level'] = 'info') {
    this.snapshot.events.unshift({ id: randomUUID(), timestamp: new Date().toISOString(), message, level });
  }
  private alert(type: Alert['type'], severity: Alert['severity'], message: string) {
    this.snapshot.alerts.unshift({ id: randomUUID(), timestamp: new Date().toISOString(), type, severity, message, acknowledged: false });
    this.event(message, severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'success');
  }
  
private publish() {
  const s = this.snapshot;

  s.events = s.events.slice(0, 200);
  s.alerts = s.alerts.slice(0, 200);
  s.history = s.history.slice(0, 500);

  this.listeners.forEach(listener => listener());

  if (!this.storagePath) return;

  const path = this.storagePath;

  const data = JSON.stringify({
    version: 1,
    settings: s.settings,
    schedules: s.schedules,
    history: s.history,
    alerts: s.alerts,
    events: s.events,
    lastSeen: s.device.lastSeen,
    observedIds: [...this.observedIds].slice(-1000)
  }, null, 2);

  this.saveJob = this.saveJob
    .then(async () => {

      // Ensure storage directory exists
      await mkdir(dirname(path), { recursive: true });

      // Write to temporary file first
      await writeFile(`${path}.tmp`, data, 'utf8');

      // Replace saved file after successful write
      await rename(`${path}.tmp`, path);

      // Clear warning only after successful save
      s.storageWarning = null;

    })
    .catch((error) => {

      console.error(
        '[AUDIT STORAGE ERROR]',
        error
      );

      console.error(
        '[AUDIT STORAGE PATH]',
        path
      );

      s.storageWarning =
        'Real-device audit storage could not be written. Check backend filesystem access.';

    });
}

  async initialize() {
    if (!this.storagePath) return;
    try {
      const raw = JSON.parse(await readFile(this.storagePath, 'utf8'));
      const saved = persistedSchema.parse(raw);
      Object.assign(this.snapshot, saved);
      // The configured backend URL is authoritative; saved settings never redirect commands.
      this.snapshot.settings.ipAddress = new URL(this.service.baseUrl).hostname;
      this.snapshot.settings.refreshInterval = Math.min(2, saved.settings.refreshInterval);
      this.snapshot.device.lastSeen = typeof raw.lastSeen === 'string' && Number.isFinite(Date.parse(raw.lastSeen)) ? raw.lastSeen : null;
      if (Array.isArray(raw.observedIds)) this.observedIds = new Set(raw.observedIds.filter((id: unknown) => typeof id === 'string').slice(-1000));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.snapshot.storageWarning = 'Real-device storage could not be loaded. No demo records were substituted.';
    }
  }
  start() {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      const started = Date.now(); await this.poll();
      if (this.running) this.timer = setTimeout(() => { void loop(); }, Math.max(50, this.snapshot.settings.refreshInterval * 1000 - (Date.now() - started)));
    };
    void loop();
  }
  async stop() { this.running = false; clearTimeout(this.timer); await this.pollJob; await this.saveJob; }
  poll(): Promise<void> {
    if (this.commandBusy) return Promise.resolve();
    if (this.pollJob) return this.pollJob;
    this.pollJob = this.service.status().then(reading => {
      if (!reading.online) throw new DeviceApiError('ESP32 responded but reported its Wi-Fi/device state offline.');
      this.apply(reading);
    }).catch(error => { this.fail(error); }).finally(() => { this.pollJob = undefined; });
    return this.pollJob;
  }
  private fail(error: unknown) {
    const s = this.snapshot;
    const message = error instanceof Error ? error.message : 'ESP32 communication failed.';
    if (s.device.online || !s.alerts.some(a => a.type === 'device-disconnected' && !a.acknowledged)) this.alert('device-disconnected', 'critical', 'ESP32 disconnected. Retrying automatically; last-seen time and values are preserved.');
    if (s.integration!.lastError !== message) this.event(message, 'error');
    s.device.online = false; s.integration!.lastError = message;
    this.previous = null; this.ackBaseline = null;
    this.publish();
  }
  private acknowledge(compartment?: CompartmentId, medicineName?: string, timestamp?: string) {
    const s = this.snapshot;
    const matches = s.history.filter(h => h.result === 'Pending' && (compartment === undefined || h.requiredCompartment === compartment));
    const pending = matches.length === 1 ? matches[0] : undefined;
    const at = timestamp || new Date().toISOString();
    if (pending) { pending.result = 'Acknowledged'; pending.acknowledged = true; pending.actualTime = at; pending.remarks = 'Acknowledgment confirmed by ESP32 status/API; no claim of ingestion.'; }
    else s.history.unshift({ id: randomUUID(), scheduleId: null, medicineName: medicineName || 'Not identified by device', requiredCompartment: compartment ?? null, openedCompartment: null, scheduledTime: at, actualTime: at, result: 'Acknowledged', acknowledged: true, remarks: 'Acknowledgment confirmed by ESP32 status/API. Medicine/compartment is recorded only when unambiguous; no claim of ingestion.' });
    this.alert('medicine-acknowledged', 'info', 'Medicine intake acknowledged');
    if (pending) s.alerts.filter(a => a.type === 'acknowledgment-pending' && a.message.includes(`Compartment ${pending.requiredCompartment}:`)).forEach(a => { a.acknowledged = true; });
  }
  private apply(reading: DeviceReading) {
    const s = this.snapshot; const at = new Date().toISOString();
    if (!s.device.online) {
      this.event(s.device.lastSeen ? 'ESP32 reconnected; real telemetry resumed.' : 'ESP32 connected; real telemetry received.', 'success');
      s.alerts.filter(a => a.type === 'device-disconnected').forEach(a => { a.acknowledged = true; });
    }
    s.firmwareStatus = reading.firmwareStatus;
    s.device = { online: true, ipAddress: reading.ip, lastSeen: at, rtcStatus: reading.rtcStatus, rtcReported: reading.rtcReported, clockValid: reading.clockValid, deviceTime: reading.deviceTime, deviceDate: reading.deviceDate, acknowledgment: reading.acknowledgment?.active ?? (reading.profile === 'kkk' ? reading.medicines.some(m => m.status === 'TAKEN') : null), alarm: reading.alarm, lastEvent: reading.lastEvent };
    if (reading.name) s.settings.deviceName = reading.name;
    s.settings.ipAddress = new URL(this.service.baseUrl).hostname;
    s.integration = { firmwareProfile: reading.profile, missingTelemetry: reading.missing, lastError: null, scheduleSync: reading.medicines.length ? 'partial' : 'unavailable', pollIntervalMs: s.settings.refreshInterval * 1000 };
    if (reading.lastEvent && reading.lastEvent !== this.previous?.lastEvent) this.event(`ESP32: ${reading.lastEvent}`);
    s.speakerActive = reading.speaker;
    for (const m of reading.medicines) {
      const id = `esp32-slot-${m.compartment}`;
      const existing = s.schedules.find(schedule => schedule.id === id);
      const schedule: MedicineSchedule = { id, medicineName: m.name, compartment: m.compartment, scheduledTime: m.time, enabled: true, notes: existing?.notes || '', source: 'device', syncStatus: 'synced' };
      s.schedules = [...s.schedules.filter(item => item.id !== id), schedule];
      if (m.due && !s.history.some(h => h.scheduleId === id && h.result === 'Pending')) {
        s.history.unshift({ id: randomUUID(), scheduleId: id, medicineName: m.name, requiredCompartment: m.compartment, openedCompartment: null, scheduledTime: at, actualTime: null, result: 'Pending', acknowledged: false, remarks: 'ESP32 reported medicine due. Time is the backend observation time; no browser scheduler is running.' });
        this.alert('acknowledgment-pending', 'warning', `Compartment ${m.compartment}: ${m.name} is due; awaiting physical acknowledgment.`);
      }
    }
    for (const c of reading.compartments) {
      const previous = this.previous?.compartments.find(p => p.compartment === c.compartment);
      if (previous && previous.doorStatus !== 'unknown' && c.doorStatus !== previous.doorStatus && c.doorStatus !== 'unknown') {
        this.event(`Compartment ${c.compartment} ${c.doorStatus}; ${c.doorSource === 'reed' ? 'derived from reed switch' : 'reported by ESP32'}.`);
        if (c.doorStatus === 'open') {
          const due = reading.medicines.filter(m => m.due);
          const correct = due.find(m => m.compartment === c.compartment);
          const record = s.history.find(h => h.result === 'Pending' && h.requiredCompartment === c.compartment);
          if (correct && record) record.openedCompartment = c.compartment;
          else if (due.length) {
            const required = due[0];
            this.alert('wrong-compartment', 'critical', `Wrong compartment opened: compartment ${c.compartment}; required compartment ${required.compartment}.`);
            s.history.unshift({ id: randomUUID(), scheduleId: `esp32-slot-${required.compartment}`, medicineName: required.name, requiredCompartment: required.compartment, openedCompartment: c.compartment, scheduledTime: at, actualTime: at, result: 'Wrong compartment', acknowledged: false, remarks: 'Observed door transition and firmware-reported due state.' });
          } else if (reading.medicines.length) this.alert('unexpected-opening', 'warning', `Unexpected compartment ${c.compartment} opening; firmware reports neither medicine due.`);
          // Without firmware due state, an opening alone cannot be classified as wrong/unexpected.
        }
      }
    }
    s.compartments = reading.compartments;
    for (const m of reading.medicines) {
      const old = this.previous?.medicines.find(item => item.compartment === m.compartment);
      if (old && old.status !== 'TAKEN' && m.status === 'TAKEN') this.acknowledge(m.compartment, m.name);
    }
    const ack = reading.acknowledgment;
    if (ack) {
      if (ack.active && (ack.id ? !this.observedIds.has(`ack:${ack.id}`) : this.ackBaseline === false)) {
        if (ack.id) this.observedIds.add(`ack:${ack.id}`);
        this.acknowledge(ack.compartment, ack.medicineName, ack.timestamp);
      }
      this.ackBaseline = ack.active;
    }
    for (const event of reading.events || []) {
      if (this.observedIds.has(`event:${event.id}`)) continue;
      this.observedIds.add(`event:${event.id}`);
      if (event.type === 'medicine-acknowledged') this.acknowledge(event.compartment, event.medicineName, event.timestamp);
      else this.alert(event.type, event.type === 'wrong-compartment' || event.type === 'missed-medicine' ? 'critical' : 'warning', event.message || `ESP32 event: ${event.type}${event.compartment ? `; compartment ${event.compartment}` : ''}`);
    }
    // A cleared due flag is never treated as proof of a button press.
    for (const m of reading.medicines.filter(m => !m.due)) {
      for (const h of s.history.filter(h => h.scheduleId === `esp32-slot-${m.compartment}` && h.result === 'Pending')) {
        h.result = 'Unconfirmed'; h.actualTime = at; h.remarks = 'Firmware cleared its due flag without reporting a physical acknowledgment. Intake remains unconfirmed.';
      }
      s.alerts.filter(a => a.type === 'acknowledgment-pending' && a.message.includes(`Compartment ${m.compartment}:`)).forEach(a => { a.acknowledged = true; });
    }
    this.previous = reading;
    if (this.observedIds.size > 1000) this.observedIds = new Set([...this.observedIds].slice(-1000));
    this.publish();
  }
  async command(command: DeviceCommand) {
    if (this.commandBusy) throw new DeviceApiError('Another device command is in progress. Wait for confirmation.', 409);
    this.commandBusy = true;
    try {
      // Drain an older status request before sending a mutation; stale reads must not
      // turn a confirmed TAKEN state back into DUE and duplicate acknowledgment history.
      await this.pollJob;
      const confirmation = await this.service.command(command);
      const acknowledgmentsBefore = this.snapshot.history.filter(h => h.result === 'Acknowledged').length;
      if (confirmation.reading.online) this.apply(confirmation.reading);
      else this.fail(new DeviceApiError('ESP32 reported offline after command acceptance.'));
      if (confirmation.acknowledgedCompartment && this.snapshot.history.filter(h => h.result === 'Acknowledged').length === acknowledgmentsBefore) this.acknowledge(confirmation.acknowledgedCompartment, confirmation.reading.medicines.find(m => m.compartment === confirmation.acknowledgedCompartment)?.name);
      this.event(`ESP32 confirmed ${command.type}${'compartment' in command ? ` for compartment ${command.compartment}` : ''}.`, 'success');
      this.publish(); return { success: confirmation.success, message: confirmation.message };
    } catch (error) { this.event(`Command failed: ${error instanceof Error ? error.message : 'not confirmed'}`, 'error'); this.publish(); throw error; }
    finally { this.commandBusy = false; }
  }
  async saveSchedule(input: unknown, id?: string) {
    const parsed = scheduleSchema.parse(input);
    const existing = id ? this.snapshot.schedules.find(s => s.id === id) : undefined;
    if (id && !existing) throw new DeviceApiError('Schedule not found.', 404);
    if (existing?.source === 'device') {
      if (!parsed.enabled || parsed.compartment !== existing.compartment) throw new DeviceApiError('Current firmware supports name/time edits only. Disabling or moving a device slot requires the flashed .ino to expose those operations. No hardware change was made.', 501);
      if (parsed.medicineName !== existing.medicineName || parsed.scheduledTime !== existing.scheduledTime) {
        if (this.commandBusy) throw new DeviceApiError('Another firmware command is in progress. Wait for confirmation.', 409);
        this.commandBusy = true;
        try {
          await this.pollJob;
          const reading = await this.service.updateLegacySchedule(existing.compartment, parsed.medicineName, parsed.scheduledTime, this.snapshot.integration?.firmwareProfile || 'legacy-medbox');
          this.apply(reading);
        } finally { this.commandBusy = false; }
      }
      this.snapshot.schedules = this.snapshot.schedules.map(s => s.id === id ? { ...s, notes: parsed.notes } : s);
      this.event(`Device schedule confirmed: ${parsed.medicineName} at ${parsed.scheduledTime}.`, 'success');
    } else {
      if (!id && this.snapshot.schedules.length >= 200) throw new DeviceApiError('Maximum 200 schedules.', 400);
      const schedule: MedicineSchedule = { ...parsed, id: id || randomUUID(), source: 'backend', syncStatus: 'draft' };
      this.snapshot.schedules = [...this.snapshot.schedules.filter(s => s.id !== id), schedule];
      this.event(`Backend schedule draft ${id ? 'updated' : 'created'}: ${schedule.medicineName}. Not synchronized to ESP32.`);
    }
    this.publish(); await this.saveJob;
  }
  async deleteSchedule(id: string) {
    const schedule = this.snapshot.schedules.find(s => s.id === id);
    if (!schedule) throw new DeviceApiError('Schedule not found.', 404);
    if (schedule.source === 'device') throw new DeviceApiError('Current firmware has no confirmed schedule delete/disable route. Device schedule was preserved. Provide the flashed .ino to add this capability.', 501);
    this.snapshot.schedules = this.snapshot.schedules.filter(s => s.id !== id);
    this.event(`Backend schedule draft deleted: ${schedule.medicineName}.`); this.publish(); await this.saveJob;
  }
  acknowledgeAlert(id: string) {
    const alert = this.snapshot.alerts.find(a => a.id === id);
    if (!alert) throw new DeviceApiError('Alert not found.', 404);
    alert.acknowledged = true; this.event('Administrator reviewed a real-device alert; physical acknowledgment state is unchanged.'); this.publish();
  }
  async saveSettings(input: unknown) {
    const settings: Settings = settingsSchema.parse(input);
    if (settings.ipAddress !== new URL(this.service.baseUrl).hostname) throw new DeviceApiError('Change ESP32_URL in .env.local and restart the backend to change the hardware target.', 400);
    if (settings.refreshInterval > 2) throw new DeviceApiError('Real-device refresh interval must be 1 or 2 seconds.', 400);
    this.snapshot.settings = settings; this.snapshot.integration!.pollIntervalMs = settings.refreshInterval * 1000;
    this.event('Backend monitoring settings saved. Firmware RTC/reminder timing was not changed.'); this.publish(); await this.saveJob;
  }
}
