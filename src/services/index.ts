import type { DashboardGateway } from './contracts';
import { DemoGateway } from './demoGateway';
import { ApiGateway } from './apiGateway';

// Integration seam: replace this factory with your backend gateway, preserving the contract.
export function configuredMode(): 'demo' | 'live' {
  try { const saved = window.localStorage.getItem('medibox-device-mode'); if (saved === 'demo' || saved === 'live') return saved; } catch { /* Use environment default. */ }
  return import.meta.env.VITE_DEVICE_MODE === 'live' ? 'live' : 'demo';
}
export function switchDeviceMode(mode: 'demo' | 'live') {
  window.localStorage.setItem('medibox-device-mode', mode);
  window.location.reload();
}
function createGateway(): DashboardGateway {
  if (configuredMode() === 'live') {
    return new ApiGateway(import.meta.env.VITE_API_BASE_URL || '/api', import.meta.env.VITE_WS_URL);
  }
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { /* Session-only fallback. */ }
  return new DemoGateway(storage);
}
export const gateway = createGateway();
