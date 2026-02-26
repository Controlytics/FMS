import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
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
  server: {
    port: 5175,
    strictPort: true, // Never auto-switch to another port
    host: true, // Expose to network
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
