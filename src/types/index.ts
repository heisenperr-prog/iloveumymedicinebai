export type CompartmentId = 1 | 2;
/** Exact kkk.ino payload. Boolean reed=true means the compartment is OPEN. */
export interface Esp32MedicineStatus {
  name: string; hour: number; minute: number; schedule: string;
  status: 'WAITING' | 'DUE' | 'TAKEN'; compartment: 'OPEN' | 'CLOSED'; reed: boolean;
}
export interface Esp32FirmwareStatus {
  time: string; date: string; rtc: string; wifi: string; ip: string;
  med1: Esp32MedicineStatus; med2: Esp32MedicineStatus;
  alarm: boolean; lastEvent: string;
}
export interface DeviceStatus {
  online: boolean;
  ipAddress: string;
  lastSeen: string | null;
  rtcStatus: 'synced' | 'unsynced' | 'error' | 'unknown';
  rtcReported?: string | null;
  clockValid?: boolean;
  deviceTime?: string | null;
  deviceDate?: string | null;
  acknowledgment?: boolean | null;
  alarm?: string | boolean | null;
  lastEvent?: string | null;
}
export interface MedicineSchedule {
  id: string;
  medicineName: string;
  compartment: CompartmentId;
  scheduledTime: string;
  enabled: boolean;
  notes: string;
  source?: 'device' | 'backend';
  syncStatus?: 'synced' | 'draft';
}
export interface CompartmentStatus {
  compartment: CompartmentId;
  doorStatus: 'open' | 'closed' | 'unknown';
  reedSwitch: 'detected' | 'not-detected' | 'fault' | 'unknown';
  /** Original firmware boolean, never inverted; undefined for existing demo data. */
  reed?: boolean | null;
  servoStatus: 'locked' | 'unlocked' | 'fault' | 'unknown';
  ledStatus: boolean | null;
  doorSource?: 'reported' | 'reed' | 'unavailable';
  medicineStatus?: 'DUE' | 'TAKEN' | 'WAITING' | 'unknown';
  currentMedicine: string;
}
export type AlertType = 'wrong-compartment' | 'schedule-triggered' | 'acknowledgment-pending' | 'missed-medicine' | 'device-disconnected' | 'reed-fault' | 'servo-fault' | 'unexpected-opening' | 'test' | 'medicine-acknowledged' | 'communication-failure';
export interface Alert {
  id: string;
  type: AlertType;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  timestamp: string;
  acknowledged: boolean;
}
export type HistoryResult = 'Acknowledged' | 'Wrong compartment' | 'Missed' | 'Pending' | 'Manual override' | 'Unconfirmed';
export interface MedicineHistory {
  id: string;
  scheduleId: string | null;
  medicineName: string;
  requiredCompartment: CompartmentId | null;
  openedCompartment: CompartmentId | null;
  scheduledTime: string;
  actualTime: string | null;
  result: HistoryResult;
  acknowledged: boolean;
  remarks: string;
}
export interface DeviceEvent {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}
export interface Settings {
  deviceName: string;
  ipAddress: string;
  refreshInterval: number;
  alertTimeout: number;
}
export interface Snapshot {
  firmwareStatus?: Esp32FirmwareStatus;
  device: DeviceStatus;
  compartments: CompartmentStatus[];
  schedules: MedicineSchedule[];
  alerts: Alert[];
  history: MedicineHistory[];
  events: DeviceEvent[];
  settings: Settings;
  speakerActive: boolean | null;
  storageWarning: string | null;
  integration?: {
    firmwareProfile: 'kkk' | 'legacy-medbox' | 'compartment-status' | null;
    missingTelemetry: string[];
    scheduleSync: 'partial' | 'unavailable';
    lastError: string | null;
    pollIntervalMs: number;
  };
}
export type DeviceCommand =
  | { type: 'set-door'; compartment: CompartmentId; open: boolean }
  | { type: 'test-led'; compartment: CompartmentId }
  | { type: 'test-speaker' }
  | { type: 'test-medicine'; compartment: CompartmentId }
  | { type: 'acknowledge-medicine' }
  | { type: 'sync-rtc' };
export type DemoEvent =
  | { type: 'connection'; online: boolean }
  | { type: 'open'; compartment: CompartmentId }
  | { type: 'trigger'; scheduleId: string }
  | { type: 'wrong-compartment' }
  | { type: 'acknowledge' }
  | { type: 'reed-fault'; compartment: CompartmentId }
  | { type: 'servo-fault'; compartment: CompartmentId }
  | { type: 'test-alert' };
