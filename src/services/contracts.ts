import type { DemoEvent, DeviceCommand, MedicineSchedule, Settings, Snapshot } from '../types';

/** Implement this port with a backend REST/WebSocket client. UI modules never import DemoGateway. */
export interface DashboardGateway {
  readonly mode: 'demo' | 'live';
  getSnapshot(): Snapshot | null;
  subscribe(listener: () => void): () => void;
  connect(): Promise<void>;
  disconnect(): void;
  command(command: DeviceCommand): Promise<void>;
  saveSchedule(schedule: Omit<MedicineSchedule, 'id'> & { id?: string }): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  acknowledgeAlert(id: string): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
  simulate?(event: DemoEvent): Promise<void>;
}
