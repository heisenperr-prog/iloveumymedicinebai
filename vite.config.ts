import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = { '/api': { target: `http://127.0.0.1:${env.BACKEND_PORT || 3000}`, changeOrigin: true } };
  return {
  plugins: [react(), tailwindcss()],
  server: { proxy }, preview: { proxy },
  build: { rollupOptions: { output: { manualChunks: { charts: ['recharts'] } } } },
  };
});
