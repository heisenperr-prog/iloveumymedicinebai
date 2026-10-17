/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEVICE_MODE?: 'demo' | 'live';
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_URL?: string;
}
