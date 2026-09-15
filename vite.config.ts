import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Portas (env-overridable). O backend espelha o mesmo default em server/env.ts.
const API_PORT = process.env.DIPLOMA_PORT ?? '8980';
const WEB_PORT = Number(process.env.DIPLOMA_WEB_PORT ?? 5980);

export default defineConfig({
  root: 'web',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@': resolve(__dirname, 'web/src'),
    },
  },
  server: {
    port: WEB_PORT,
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        // Server-Sent Events: nunca bufferizar, manter a conexão fluindo.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
