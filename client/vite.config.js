import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      includeAssets: ['icons/*.png', 'icons/*.svg', 'favicon.ico', 'icons/apple-touch-icon.png'],

      manifest: {
        name: 'FitLife',
        short_name: 'FitLife',
        description: 'Transform your health, one day at a time',
        theme_color: '#c9a227',
        // Was #ffffff, which flashed a white screen on every cold start before
        // the app painted. Matching the app's own background removes the flash.
        background_color: '#0b0b0e',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          // "any" and "maskable" are split deliberately. A single icon marked
          // 'any maskable' gets its rounded corners cropped by launchers that
          // apply a circular mask, because the art runs to the edge. The
          // maskable files below keep the artwork inside the centre 80% safe
          // zone and fill the rest with the background colour.
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-192-maskable.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png',
          },
        ],
      },

      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },

      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor':   ['react', 'react-dom', 'react-router-dom'],
          'chart-vendor':   ['recharts'],
          'socket-vendor':  ['socket.io-client'],
          'store-vendor':   ['zustand', 'axios'],
        },
      },
    },
  },
});
