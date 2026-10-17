import type { DashboardGateway } from './contracts';
import type { DeviceCommand, MedicineSchedule, Settings, Snapshot } from '../types';
import { snapshotSchema } from './validation';

/** Backend owns device state and medicine timing. MQTT should terminate at the backend. */
export class ApiGateway implements DashboardGateway {
  readonly mode = 'live' as const;
  private snapshot: Snapshot | null = null;
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;
  private socket?: WebSocket;
  private generation = 0;
  private refreshJob?: Promise<void>;
  constructor(private baseUrl: string, private websocketUrl?: string) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(snapshot: unknown) {
    this.snapshot = snapshotSchema.parse(snapshot);
    this.listeners.forEach(listener => listener());
  }
  private async request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method, credentials: 'same-origin', signal: AbortSignal.timeout(10000),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error || `Backend request failed (${response.status}). Check the API connection.`);
    }
    return response.status === 204 ? undefined : response.json();
  }
  private refresh(): Promise<void> {
    if (this.refreshJob) return this.refreshJob.then(() => this.snapshot ? undefined : this.refresh());
    const generation = this.generation;
    this.refreshJob = this.request('/snapshot').then(data => { if (generation === this.generation) this.publish(data); }).catch(error => {
      if (generation !== this.generation) return;
      if (!this.snapshot) throw error;
      this.publish({ ...this.snapshot, device: { ...this.snapshot.device, online: false }, storageWarning: 'Backend unavailable. Showing the last received device state.' });
    }).finally(() => { this.refreshJob = undefined; });
    return this.refreshJob;
  }
  async connect() {
    const generation = this.generation;
    await this.refresh();
    if (generation !== this.generation || this.timer) return;
    // Polling remains active as a fallback if the WebSocket closes.
    this.timer = setInterval(() => { void this.refresh(); }, 1000);
    if (this.websocketUrl) {
      this.socket = new WebSocket(this.websocketUrl);
      this.socket.onmessage = event => {
        try { const data = JSON.parse(event.data); this.publish(data.type === 'snapshot' ? data.payload : data); }
        catch { /* Ignore malformed messages; polling obtains a validated snapshot. */ }
      };
    }
  }
  disconnect() { this.generation++; clearInterval(this.timer); this.timer = undefined; this.socket?.close(); this.socket = undefined; }
  private async mutate(path: string, method: string, body?: unknown) {
    await this.request(path, method, body);
    await this.refreshJob;
    await this.refresh();
  }
  command(command: DeviceCommand) { return this.mutate('/commands', 'POST', command); }
  saveSchedule(schedule: Omit<MedicineSchedule, 'id'> & { id?: string }) {
    return this.mutate(schedule.id ? `/schedules/${encodeURIComponent(schedule.id)}` : '/schedules', schedule.id ? 'PUT' : 'POST', schedule);
  }
  deleteSchedule(id: string) { return this.mutate(`/schedules/${encodeURIComponent(id)}`, 'DELETE'); }
  acknowledgeAlert(id: string) { return this.mutate(`/alerts/${encodeURIComponent(id)}/acknowledge`, 'POST'); }
  saveSettings(settings: Settings) { return this.mutate('/settings', 'PUT', settings); }
}
