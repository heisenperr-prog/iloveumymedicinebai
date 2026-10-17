import type { MedicineSchedule } from '../types';

export const time = (value: Date | string) => new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
export const seconds = (value: Date | string | null) => value === null ? 'Never seen' : new Date(value).toLocaleTimeString('en-GB');
export const date = (value: Date | string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const dayKey = (value: Date | string) => { const d = new Date(value); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
export function scheduledDate(hhmm: string, now = new Date()) { const d = new Date(now); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; }
export const scheduleTime = (hhmm: string) => time(scheduledDate(hhmm));
export function nextSchedule(schedules: MedicineSchedule[], now: Date) {
  return schedules.filter(s => s.enabled).map(schedule => {
    const at = scheduledDate(schedule.scheduledTime, now);
    if (at <= now) at.setDate(at.getDate() + 1);
    return { schedule, at };
  }).sort((a, b) => +a.at - +b.at)[0];
}
export function countdown(at: Date, now: Date) {
  const diff = Math.max(0, Math.floor((+at - +now) / 1000));
  return [Math.floor(diff / 3600), Math.floor(diff % 3600 / 60), diff % 60].map(n => String(n).padStart(2, '0')).join(':');
}
