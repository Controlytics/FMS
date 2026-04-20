import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'DigiLog - Filter Management',
        short_name: 'DigiLog',
        description: 'Digital Filter Management System - 21 CFR Part 11 Compliant',
        theme_color: '#0891b2',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'any',
        start_url: '/m',
        scope: '/',
        categories: ['business', 'productivity'],
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          {
            name: 'Filter Operations',
            short_name: 'Operations',
            url: '/m',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        // Runtime caching for read-only API GETs that benefit from offline
        // access if IndexedDB cache misses. Writes still go through
        // executeOrQueue (IndexedDB) — these strategies only help GETs.
        runtimeCaching: [
          {
            // Checklist profile definitions (rarely change)
            urlPattern: /\/api\/checklists(\/[^?]*)?(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-checklists',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Filter cleaning profiles (pipeline graphs)
            urlPattern: /\/api\/cleaning-profiles(\/[^?]*)?(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cleaning-profiles',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Config endpoints (password-policy, branding, themes, report-settings)
            urlPattern: /\/api\/config\/[^?]+\/current(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-config-current',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 30, maxAgeSeconds: 12 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Public active roles for contact-admin
            urlPattern: /\/api\/roles\/active(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-roles-active',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 5, maxAgeSeconds: 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          swr: ['swr'],
          reactflow: ['reactflow'],
          monaco: ['@monaco-editor/react'],
          charts: ['recharts'],
          qrcode: ['qrcode.react'],
        },
      },
    },
  },
  server: (() => {
    // Only enable HTTPS if both cert files exist locally
    const keyPath = path.resolve(__dirname, '../../certs/server.key');
    const certPath = path.resolve(__dirname, '../../certs/server.crt');
    const useHttps = fs.existsSync(keyPath) && fs.existsSync(certPath);
    const apiTarget = useHttps ? 'https://localhost:3000' : 'http://localhost:3000';
    return {
      port: 5175,
      strictPort: true,
      host: true,
      ...(useHttps && {
        https: {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        },
      }),
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
        '/uploads': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    };
  })(),
});
