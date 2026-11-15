import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
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
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}']
      }
    })
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
