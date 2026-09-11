import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isCloudflare = process.env.CF_PAGES === 'true' || process.env.WRANGLER === 'true';
const base = process.env.VITE_BASE || (isCloudflare ? '/' : '/Tradehub/')
const outDir = (base === '/' || isCloudflare) ? 'dist' : 'dist/Tradehub'

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
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
})
