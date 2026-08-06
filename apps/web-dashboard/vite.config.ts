import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { MCP_STREAMABLE_HTTP_PORT } from './src/constants'
import fs from 'node:fs'
import path from 'node:path'

function commercialFallback(): Plugin {
  return {
    name: 'commercial-fallback',
    resolveId(source, importer) {
      if (source.endsWith('/commercial-pages') && importer) {
        const dir = path.dirname(importer)
        const resolved = path.resolve(dir, source)
        if (!fs.existsSync(resolved + '.tsx') && !fs.existsSync(resolved + '.ts')) {
          return { id: '\0commercial-pages-stub', moduleSideEffects: false }
        }
      }
      return null
    },
    load(id) {
      if (id === '\0commercial-pages-stub') return 'export default {};'
      return null
    },
  }
}

export default defineConfig({
  plugins: [commercialFallback(), react()],
  server: {
    proxy: {
      '/mcp/events': {
        target: `http://localhost:${MCP_STREAMABLE_HTTP_PORT}`,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
              proxyRes.pipe(res)
            }
          })
        },
      },
      '/mcp': {
        target: `http://localhost:${MCP_STREAMABLE_HTTP_PORT}`,
        changeOrigin: true,
      },
      '/api/auth': {
        target: `http://localhost:${MCP_STREAMABLE_HTTP_PORT}`,
        changeOrigin: true,
      },
      '/api/control': {
        target: `http://localhost:${MCP_STREAMABLE_HTTP_PORT}`,
        changeOrigin: true,
      },
    },
  },
})
