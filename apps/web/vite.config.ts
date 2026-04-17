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
        runtimeCaching: [],
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
