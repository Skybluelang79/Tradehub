import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isCloudflare = process.env.CF_PAGES === 'true' || process.env.WRANGLER === 'true';
const base = process.env.VITE_BASE || (isCloudflare ? '/' : '/Tradehub/')
const outDir = (base === '/' || isCloudflare) ? 'dist' : 'dist/Tradehub'
// Dev API/proxy target. Point this at whichever backend is running: the Node
// server or the Python (FastAPI) server — both listen on 3001 by default.
const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  base,
  build: {
    outDir,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react')) return 'react';
          if (id.includes('node_modules/socket.io-client') || id.includes('node_modules/engine.io-client')) return 'socket';
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      ignored: ['**/dist/**'],
    },
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
      '/uploads': {
        target: proxyTarget,
        changeOrigin: true,
      },
      '/socket.io': {
        target: proxyTarget,
        ws: true,
      },
    },
  },
})
