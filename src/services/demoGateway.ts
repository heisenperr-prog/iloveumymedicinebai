import type { DashboardGateway } from './contracts';
import type { Alert, CompartmentId, DemoEvent, DeviceCommand, DeviceEvent, MedicineHistory, MedicineSchedule, Settings, Snapshot } from '../types';
import { createSeed } from '../data/seed';
import { persistedSchema, scheduleSchema, settingsSchema } from './validation';
import { scheduledDate } from '../utils/time';

export const STORAGE_KEY = 'medibox-demo-v1';
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export class DemoGateway implements DashboardGateway {
  readonly mode = 'demo' as const;
  private state: Snapshot | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTick = 0;
  private ledUntil = new Map<CompartmentId, number>();
  private speakerUntil = 0;
  constructor(private storage?: StoragePort, private clock = () => new Date()) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private get s() { if (!this.state) throw new Error('Controller is still loading.'); return this.state; }
  private id() { return globalThis.crypto.randomUUID(); }
  private event(message: string, level: DeviceEvent['level'] = 'info') { this.s.events.unshift({ id: this.id(), timestamp: this.clock().toISOString(), message, level }); }
  private alert(type: Alert['type'], severity: Alert['severity'], message: string) { this.s.alerts.unshift({ id: this.id(), timestamp: this.clock().toISOString(), type, severity, message, acknowledged: false }); this.event(message, severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'info'); }
  private commit() {
    const s = this.s;
    s.events = s.events.slice(0, 200); s.alerts = s.alerts.slice(0, 200);
    const pending = s.history.filter(h => h.result === 'Pending');
    s.history = [...pending, ...s.history.filter(h => h.result !== 'Pending').slice(0, Math.max(0, 500 - pending.length))].sort((a, b) => b.scheduledTime.localeCompare(a.scheduledTime));
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, settings: s.settings, schedules: s.schedules, history: s.history, alerts: s.alerts, events: s.events })); }
    catch { s.storageWarning = 'Browser storage is unavailable or full. Changes are kept for this session only.'; }
    this.state = structuredClone(s);
    this.listeners.forEach(listener => listener());
  }
  async connect() {
    if (this.timer) return;
    if (!this.state) {
      this.state = createSeed(this.clock());
      try {
        const raw = this.storage?.getItem(STORAGE_KEY);
        if (raw) {
          const saved = persistedSchema.parse(JSON.parse(raw));
          Object.assign(this.state, { settings: saved.settings, schedules: saved.schedules, history: saved.history, alerts: saved.alerts, events: saved.events });
          this.s.device.ipAddress = saved.settings.ipAddress;
          for (const record of this.s.history.filter(h => h.result === 'Pending')) {
            record.result = 'Missed'; record.remarks = 'Demo session ended before acknowledgment.';
            this.alert('missed-medicine', 'warning', `${record.medicineName}: previous demo session ended before acknowledgment.`);
          }
          this.event('Demo session restored · physical states reset to closed', 'success');
        }
      } catch { this.s.storageWarning = 'Saved demo data could not be loaded. A fresh demo session is running.'; }
      this.updateMedicineLabels();
    }
    this.lastTick = +this.clock(); this.commit();
    this.timer = setInterval(() => this.tick(), 1000);
  }
  disconnect() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private online() { if (!this.s.device.online) throw new Error('Demo ESP32 is offline. Restore the connection before sending commands.'); }
  private updateMedicineLabels() {
    for (const c of this.s.compartments) c.currentMedicine = this.s.schedules.filter(m => m.compartment === c.compartment && m.enabled).sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime)).map(m => m.medicineName).join(' / ') || 'No medicine assigned';
  }
  private pending() { return this.s.history.filter(h => h.result === 'Pending').sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime)); }
  private refreshOutputs() {
    for (const c of this.s.compartments) c.ledStatus = this.pending().some(h => h.requiredCompartment === c.compartment) || (this.ledUntil.get(c.compartment) || 0) > +this.clock();
    this.s.speakerActive = this.pending().length > 0 || this.speakerUntil > +this.clock();
  }
  /** Advances the simulator; exposed for deterministic controller tests. */
  tick() {
    const now = this.clock();
    const due: { schedule: MedicineSchedule; at: string }[] = [];
    // Also catch the last reminder when a sleeping browser resumes after midnight.
    for (const schedule of this.s.schedules.filter(m => m.enabled)) {
      const at = scheduledDate(schedule.scheduledTime, now);
      if (+at > +now) at.setDate(at.getDate() - 1);
      if (+at > this.lastTick && +at <= +now) due.push({ schedule, at: at.toISOString() });
    }
    this.lastTick = +now;
    for (const { schedule, at } of due) {
      if (!this.s.history.some(h => h.scheduleId === schedule.id && h.scheduledTime === at && h.result !== 'Wrong compartment' && h.result !== 'Manual override')) this.trigger(schedule, at);
    }
    for (const record of this.pending()) {
      if (+now - +new Date(record.actualTime || record.scheduledTime) >= this.s.settings.alertTimeout * 1000) {
        record.result = 'Missed'; record.actualTime = now.toISOString(); record.remarks = 'Acknowledgment timeout expired.';
        this.alert('missed-medicine', 'critical', `${record.medicineName}: medicine intake was not acknowledged before timeout.`);
        this.resolveReminderAlerts(record.requiredCompartment);
      }
    }
    this.refreshOutputs();
    if (this.s.device.online && +now - +new Date(this.s.device.lastSeen || 0) >= this.s.settings.refreshInterval * 1000) this.s.device.lastSeen = now.toISOString();
    this.commit();
  }
  private trigger(schedule: MedicineSchedule, at = this.clock().toISOString()) {
    const now = this.clock().toISOString();
    const record: MedicineHistory = { id: this.id(), scheduleId: schedule.id, medicineName: schedule.medicineName, requiredCompartment: schedule.compartment, openedCompartment: null, scheduledTime: at, actualTime: now, result: this.s.device.online ? 'Pending' : 'Missed', acknowledged: false, remarks: this.s.device.online ? 'Waiting for correct door opening and push-button acknowledgment.' : 'Demo device was offline at scheduled time.' };
    this.s.history.unshift(record);
    if (!this.s.device.online) { this.alert('missed-medicine', 'critical', `${schedule.medicineName}: schedule missed while demo ESP32 was offline.`); return; }
    this.alert('schedule-triggered', 'info', `${schedule.medicineName} reminder triggered · compartment ${schedule.compartment}.`);
    this.alert('acknowledgment-pending', 'warning', `Compartment ${schedule.compartment}: medicine intake acknowledgment pending.`);
    this.event(`Compartment ${schedule.compartment} LED on · reminder audio activated`);
    this.refreshOutputs();
  }
  private resolveReminderAlerts(compartment: CompartmentId | null) {
    if (this.pending().some(h => h.requiredCompartment === compartment)) return;
    this.s.alerts.filter(a => ['schedule-triggered', 'acknowledgment-pending'].includes(a.type) && a.message.toLowerCase().includes(`compartment ${compartment}`)).forEach(a => { a.acknowledged = true; });
  }
  private door(compartment: CompartmentId, open: boolean, manual: boolean) {
    this.online();
    const c = this.s.compartments.find(c => c.compartment === compartment)!;
    if (c.servoStatus === 'fault') throw new Error(`Compartment ${compartment} has a simulated servo fault. Use Restore sensors in Live Monitoring.`);
    c.doorStatus = open ? 'open' : 'closed'; c.servoStatus = open ? 'unlocked' : 'locked';
    if (c.reedSwitch !== 'fault') c.reedSwitch = open ? 'not-detected' : 'detected';
    this.event(`Compartment ${compartment} ${open ? 'opened' : 'closed'} · reed switch ${c.reedSwitch}`, manual ? 'warning' : 'info');
    const pending = this.pending().find(h => h.requiredCompartment === compartment) || this.pending()[0];
    if (manual) this.s.history.unshift({ id: this.id(), scheduleId: null, medicineName: c.currentMedicine, requiredCompartment: compartment, openedCompartment: compartment, scheduledTime: this.clock().toISOString(), actualTime: this.clock().toISOString(), result: 'Manual override', acknowledged: false, remarks: `Administrator ${open ? 'opened' : 'closed'} compartment.` });
    if (open && pending) {
      if (pending.requiredCompartment !== compartment) {
        this.alert('wrong-compartment', 'critical', `Wrong compartment opened. Compartment ${compartment} was opened while compartment ${pending.requiredCompartment} was scheduled.`);
        this.s.history.unshift({ ...pending, id: this.id(), openedCompartment: compartment, actualTime: this.clock().toISOString(), result: 'Wrong compartment', remarks: 'Incorrect door event; scheduled reminder remains pending.' });
      } else { pending.openedCompartment = compartment; }
    } else if (open && !manual) this.alert('unexpected-opening', 'warning', `Unexpected compartment ${compartment} opening: no medicine reminder is pending.`);
  }
  async command(command: DeviceCommand) {
    this.online();
    if (command.type === 'test-medicine' || command.type === 'acknowledge-medicine') throw new Error('Use the demo event simulator for simulated medicine tests and acknowledgment.');
    if (command.type === 'set-door') this.door(command.compartment, command.open, true);
    if (command.type === 'test-led') { this.ledUntil.set(command.compartment, +this.clock() + 3000); this.event(`LED ${command.compartment} test activated for 3 seconds`, 'success'); }
    if (command.type === 'test-speaker') { this.speakerUntil = +this.clock() + 3000; this.event('Speaker test activated for 3 seconds (simulated; no browser audio)', 'success'); }
    if (command.type === 'sync-rtc') { this.s.device.rtcStatus = 'synced'; this.event('Demo DS3231 RTC synchronized to browser clock', 'success'); }
    this.refreshOutputs(); this.commit();
  }
  async saveSchedule(input: Omit<MedicineSchedule, 'id'> & { id?: string }) {
    const parsed = scheduleSchema.parse(input);
    if (!parsed.id && this.s.schedules.length >= 200) throw new Error('The demo supports up to 200 schedules. Remove a schedule before adding another.');
    if (parsed.id && !this.s.schedules.some(s => s.id === parsed.id)) throw new Error('This schedule no longer exists.');
    if (this.s.schedules.some(s => s.id !== parsed.id && s.enabled && parsed.enabled && s.compartment === parsed.compartment && s.scheduledTime === parsed.scheduledTime)) throw new Error('An enabled schedule already uses this compartment at this time.');
    const schedule = { ...parsed, id: parsed.id || this.id() };
    this.s.schedules = [...this.s.schedules.filter(s => s.id !== schedule.id), schedule];
    this.updateMedicineLabels(); this.event(`Schedule ${parsed.id ? 'updated' : 'created'}: ${schedule.medicineName} · ${schedule.scheduledTime}`, 'success'); this.commit();
  }
  async deleteSchedule(id: string) {
    if (this.pending().some(h => h.scheduleId === id)) throw new Error('Resolve the pending reminder before deleting this schedule.');
    const schedule = this.s.schedules.find(s => s.id === id); if (!schedule) throw new Error('Schedule not found.');
    this.s.schedules = this.s.schedules.filter(s => s.id !== id); this.updateMedicineLabels(); this.event(`Schedule deleted: ${schedule.medicineName}`, 'warning'); this.commit();
  }
  async acknowledgeAlert(id: string) {
    const alert = this.s.alerts.find(a => a.id === id); if (!alert) throw new Error('Alert not found.');
    alert.acknowledged = true; this.event(`Alert reviewed: ${alert.type}`, 'success'); this.commit();
  }
  async saveSettings(settings: Settings) { this.s.settings = settingsSchema.parse(settings); this.s.device.ipAddress = settings.ipAddress; this.event('Demo device settings updated', 'success'); this.commit(); }
  async simulate(event: DemoEvent) {
    if (event.type === 'connection') {
      this.s.device.online = event.online;
      if (event.online) { this.s.device.lastSeen = this.clock().toISOString(); this.s.alerts.filter(a => a.type === 'device-disconnected').forEach(a => { a.acknowledged = true; }); this.event('Demo ESP32 reconnected', 'success'); }
      else this.alert('device-disconnected', 'critical', 'Demo ESP32 disconnected. Device controls are unavailable.');
    } else if (event.type === 'test-alert') this.alert('test', 'warning', 'Test alert generated by administrator. No physical fault detected.');
    else {
      this.online();
      if (event.type === 'open') this.door(event.compartment, true, false);
      if (event.type === 'trigger') {
        const schedule = this.s.schedules.find(s => s.id === event.scheduleId && s.enabled); if (!schedule) throw new Error('Choose an enabled medicine schedule first.');
        if (this.pending().some(h => h.scheduleId === schedule.id)) throw new Error('This medicine already has a pending reminder.');
        this.trigger(schedule);
      }
      if (event.type === 'wrong-compartment') {
        if (!this.pending().length) { const first = this.s.schedules.find(s => s.enabled); if (!first) throw new Error('Add an enabled schedule first.'); this.trigger(first); }
        this.door(this.pending()[0].requiredCompartment === 1 ? 2 : 1, true, false);
      }
      if (event.type === 'acknowledge') {
        const record = this.pending().find(h => this.s.compartments.some(c => c.compartment === h.requiredCompartment && c.doorStatus === 'open' && c.reedSwitch === 'not-detected')) || this.pending()[0]; if (!record) throw new Error('Trigger a reminder before acknowledging medicine intake.');
        const c = this.s.compartments.find(c => c.compartment === record.requiredCompartment)!;
        if (c.doorStatus !== 'open' || c.reedSwitch !== 'not-detected') throw new Error(`Open compartment ${record.requiredCompartment} with a healthy reed switch before acknowledging.`);
        record.result = 'Acknowledged'; record.acknowledged = true; record.actualTime = this.clock().toISOString(); record.openedCompartment = c.compartment; record.remarks = 'Correct compartment event and simulated push-button acknowledgment.';
        this.event(`${record.medicineName}: medicine intake acknowledged`, 'success');
        if (c.servoStatus !== 'fault') this.door(c.compartment, false, false);
        this.resolveReminderAlerts(c.compartment);
      }
      if (event.type === 'reed-fault' || event.type === 'servo-fault') {
        const c = this.s.compartments.find(c => c.compartment === event.compartment)!;
        const restoring = event.type === 'reed-fault' ? c.reedSwitch === 'fault' : c.servoStatus === 'fault';
        if (event.type === 'reed-fault') c.reedSwitch = restoring ? c.doorStatus === 'open' ? 'not-detected' : 'detected' : 'fault';
        else c.servoStatus = restoring ? c.doorStatus === 'open' ? 'unlocked' : 'locked' : 'fault';
        if (restoring) { this.s.alerts.filter(a => a.type === event.type && a.message.includes(`Compartment ${c.compartment}`)).forEach(a => { a.acknowledged = true; }); this.event(`Compartment ${c.compartment} ${event.type} restored`, 'success'); }
        else this.alert(event.type, 'critical', `Compartment ${c.compartment}: simulated ${event.type === 'reed-fault' ? 'reed switch' : 'servo'} problem.`);
      }
    }
    this.refreshOutputs(); this.commit();
  }
}
