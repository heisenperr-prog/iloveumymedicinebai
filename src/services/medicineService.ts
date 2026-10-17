import { gateway } from './index';
import type { MedicineSchedule } from '../types';
export const medicineService = {
  save: (schedule: Omit<MedicineSchedule, 'id'> & { id?: string }) => gateway.saveSchedule(schedule),
  remove: (id: string) => gateway.deleteSchedule(id),
};
