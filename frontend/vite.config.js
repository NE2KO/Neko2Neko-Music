import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': join(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/stream': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/file': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/thumbnails': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/api/audio': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/audio/, '/stream/audio'),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
