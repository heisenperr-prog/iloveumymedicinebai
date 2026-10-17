import { gateway } from './index';
export const alertService = { acknowledge: (id: string) => gateway.acknowledgeAlert(id) };
