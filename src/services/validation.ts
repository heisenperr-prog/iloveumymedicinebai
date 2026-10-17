import { z } from 'zod';

export const scheduleSchema = z.object({
  id: z.string().optional(), medicineName: z.string().trim().min(1, 'Enter a medicine name.').max(80),
  compartment: z.union([z.literal(1), z.literal(2)]),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a valid time.'),
  enabled: z.boolean(), notes: z.string().max(500),
  source: z.enum(['device', 'backend']).optional(), syncStatus: z.enum(['synced', 'draft']).optional(),
});
export const settingsSchema = z.object({
  deviceName: z.string().trim().min(1).max(80),
  ipAddress: z.string().ip({ version: 'v4', message: 'Enter a valid IPv4 address.' }),
  refreshInterval: z.number().int().min(1).max(60),
  alertTimeout: z.number().int().min(10).max(3600),
});
const iso = z.string().datetime();
const compartment = z.union([z.literal(1), z.literal(2)]);
const firmwareMedicineSchema = z.object({
  name: z.string().min(1), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59),
  schedule: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), status: z.enum(['DUE', 'TAKEN', 'WAITING']),
  compartment: z.enum(['CLOSED', 'OPEN']), reed: z.boolean(),
});
export const firmwareStatusSchema = z.object({
  time: z.string(), date: z.string(), rtc: z.string(), wifi: z.string(), ip: z.string().ip(),
  med1: firmwareMedicineSchema, med2: firmwareMedicineSchema, alarm: z.boolean(), lastEvent: z.string(),
});
export const persistedSchema = z.object({
  version: z.literal(1), settings: settingsSchema,
  schedules: z.array(scheduleSchema.extend({ id: z.string() })).max(200),
  history: z.array(z.object({ id: z.string(), scheduleId: z.string().nullable(), medicineName: z.string(), requiredCompartment: compartment.nullable(), openedCompartment: compartment.nullable(), scheduledTime: iso, actualTime: iso.nullable(), result: z.enum(['Acknowledged', 'Wrong compartment', 'Missed', 'Pending', 'Manual override', 'Unconfirmed']), acknowledged: z.boolean(), remarks: z.string() })).max(500),
  alerts: z.array(z.object({ id: z.string(), type: z.enum(['wrong-compartment', 'schedule-triggered', 'acknowledgment-pending', 'missed-medicine', 'device-disconnected', 'reed-fault', 'servo-fault', 'unexpected-opening', 'test', 'medicine-acknowledged', 'communication-failure']), severity: z.enum(['critical', 'warning', 'info']), message: z.string(), timestamp: iso, acknowledged: z.boolean() })).max(200),
  events: z.array(z.object({ id: z.string(), timestamp: iso, level: z.enum(['info', 'success', 'warning', 'error']), message: z.string() })).max(200),
});

export const snapshotSchema = persistedSchema.omit({ version: true }).extend({
  firmwareStatus: firmwareStatusSchema.optional(),
  device: z.object({ online: z.boolean(), ipAddress: z.string(), lastSeen: iso.nullable(), rtcStatus: z.enum(['synced', 'unsynced', 'error', 'unknown']), rtcReported: z.string().nullable().optional(), clockValid: z.boolean().optional(), deviceTime: z.string().nullable().optional(), deviceDate: z.string().nullable().optional(), acknowledgment: z.boolean().nullable().optional(), alarm: z.union([z.string(), z.boolean()]).nullable().optional(), lastEvent: z.string().nullable().optional() }),
  compartments: z.array(z.object({ compartment, doorStatus: z.enum(['open', 'closed', 'unknown']), reedSwitch: z.enum(['detected', 'not-detected', 'fault', 'unknown']), reed: z.boolean().nullable().optional(), servoStatus: z.enum(['locked', 'unlocked', 'fault', 'unknown']), ledStatus: z.boolean().nullable(), currentMedicine: z.string(), doorSource: z.enum(['reported', 'reed', 'unavailable']).optional(), medicineStatus: z.enum(['DUE', 'TAKEN', 'WAITING', 'unknown']).optional() })).length(2),
  speakerActive: z.boolean().nullable(), storageWarning: z.string().nullable(),
  integration: z.object({ firmwareProfile: z.enum(['kkk', 'legacy-medbox', 'compartment-status']).nullable(), missingTelemetry: z.array(z.string()), scheduleSync: z.enum(['partial', 'unavailable']), lastError: z.string().nullable(), pollIntervalMs: z.number() }).optional(),
});
