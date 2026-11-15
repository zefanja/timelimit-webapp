import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// The timelimit-server only sends CORS headers for /admin, so the web app
// must be served from the same origin as the API. In development the vite
// server proxies the API paths (like nginx does in production).
const apiTarget = process.env.TIMELIMIT_SERVER ?? 'http://localhost:8080'
const apiPaths = ['/auth', '/parent', '/sync', '/child', '/purchase', '/admin', '/time']
const proxy = {
  ...Object.fromEntries(apiPaths.map((path) => [path, { target: apiTarget, changeOrigin: true }])),
  '/socket.io': { target: apiTarget, changeOrigin: true, ws: true },
}

export default defineConfig({
  // relative base: the app also works under a sub path behind a reverse proxy
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: { proxy },
  preview: { proxy },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'TimeLimit Eltern',
        short_name: 'TimeLimit',
        description: 'Eltern-Steuerung für einen selbst gehosteten TimeLimit-Server',
        lang: 'de',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#f6f7f9',
        theme_color: '#2f6f4f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }
        ]
      },
      workbox: {
        // only the app shell is cached; API requests always go to the network
        navigateFallback: 'index.html',
        // never answer API requests from the service worker
        navigateFallbackDenylist: [/^\/(auth|parent|sync|child|purchase|admin|time|socket\.io)/],
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}']
      }
    })
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
