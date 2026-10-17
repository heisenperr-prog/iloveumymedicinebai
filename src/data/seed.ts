import type { Snapshot } from '../types';
import { scheduledDate } from '../utils/time';

export function createSeed(now = new Date()): Snapshot {
  const morning = scheduledDate('08:00', now);
  const history: Snapshot['history'] = [];
  for (let days = 6; days >= 0; days--) {
    const at = new Date(morning); at.setDate(at.getDate() - days);
    if (at >= now) continue;
    history.push({ id: `seed-${days}`, scheduleId: 'med-1', medicineName: 'Paracetamol', requiredCompartment: 1, openedCompartment: days === 3 ? null : 1, scheduledTime: at.toISOString(), actualTime: days === 3 ? null : new Date(+at + 65000).toISOString(), result: days === 3 ? 'Missed' : 'Acknowledged', acknowledged: days !== 3, remarks: 'Illustrative demo record' });
  }
  return {
    device: { online: true, ipAddress: '192.168.1.108', lastSeen: now.toISOString(), rtcStatus: 'synced' },
    compartments: [1, 2].map(compartment => ({ compartment: compartment as 1 | 2, doorStatus: 'closed', reedSwitch: 'detected', servoStatus: 'locked', ledStatus: false, currentMedicine: compartment === 1 ? 'Paracetamol' : 'Biogesic' })),
    schedules: [
      { id: 'med-1', medicineName: 'Paracetamol', compartment: 1, scheduledTime: '08:00', enabled: true, notes: 'Demo medicine and time. Edit to match your project.' },
      { id: 'med-2', medicineName: 'Biogesic', compartment: 2, scheduledTime: '20:00', enabled: true, notes: 'Demo medicine and time. Edit to match your project.' },
    ],
    alerts: [], history: history.reverse(),
    events: [
      { id: 'boot-1', timestamp: now.toISOString(), level: 'success', message: 'Demo ESP32 connected · waiting for medicine schedule' },
      { id: 'boot-2', timestamp: new Date(+now - 1000).toISOString(), level: 'info', message: 'DS3231 RTC synchronized · both reed switches detected' },
      { id: 'boot-3', timestamp: new Date(+now - 2000).toISOString(), level: 'info', message: 'Demo controller initialized · no physical device connected' },
    ],
    settings: { deviceName: 'Medicine Box 01', ipAddress: '192.168.1.108', refreshInterval: 2, alertTimeout: 60 },
    speakerActive: false, storageWarning: null,
  };
}
