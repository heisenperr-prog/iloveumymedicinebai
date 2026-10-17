import { gateway } from './index';
import type { DemoEvent, DeviceCommand, Settings } from '../types';
export const deviceService = {
  command: (command: DeviceCommand) => gateway.command(command),
  saveSettings: (settings: Settings) => gateway.saveSettings(settings),
  simulate: (event: DemoEvent) => gateway.simulate ? gateway.simulate(event) : Promise.reject(new Error('Demo events are unavailable in live mode.')),
};
