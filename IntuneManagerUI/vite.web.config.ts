/**
 * vite.web.config.ts — Web/Azure build config (no Electron plugins)
 *
 * Use this config for:
 *   npm run dev:web        → local browser development
 *   npm run build:web      → production bundle for Azure Static Web Apps / App Service
 *
 * The Electron build continues to use vite.config.ts unchanged.
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  build: {
    outDir: 'builds/dist-web'
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // SSE requires no request buffering
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, req) => {
            if (req.url?.startsWith('/api/events')) {
              // Disable buffering for SSE
            }
          })
        }
      }
    }
  }
})
