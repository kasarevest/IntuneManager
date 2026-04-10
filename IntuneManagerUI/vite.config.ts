/**
 * vite.config.ts — Web/Azure build config
 *
 * Use this config for:
 *   npm run dev    → local browser development
 *   npm run build  → production bundle for Docker / Azure Container Apps
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
