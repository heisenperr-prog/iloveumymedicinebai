import type { HistoryResult, MedicineHistory } from '../types';
import { dayKey } from '../utils/time';
export const historyService = {
  filter: (history: MedicineHistory[], query: string, result: HistoryResult | 'all', day: string) => history.filter(h =>
    h.medicineName.toLowerCase().includes(query.toLowerCase()) && (result === 'all' || h.result === result) && (!day || dayKey(h.scheduledTime) === dayKey(`${day}T00:00:00`))),
};
