import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// COOP/COEP are load-bearing: SharedArrayBuffer (threaded WASM) and WebCodecs
// both require a cross-origin-isolated document. The same headers are served in
// production from public/_headers (Cloudflare Pages); these entries cover the
// dev and preview servers so every environment is isolated identically.
const COOP_COEP = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    headers: COOP_COEP,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } }
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true, headers: COOP_COEP },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          muxer: ['mp4-muxer']
        }
      }
    }
  }
});
