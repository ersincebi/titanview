import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
  root: '.',
  plugins: [solid()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Grafik kütüphanesi ayrı parça: uygulama kodu değişince ~150 KB yeniden indirilmez
      output: { manualChunks: { charts: ['lightweight-charts'] } },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8080',
        ws: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['frontend/src/**/*.test.{ts,tsx}'],
    server: { deps: { inline: [/solid-js/, /@solidjs/] } },
    coverage: {
      provider: 'v8',
      include: ['frontend/src/**/*.{ts,tsx}'],
      exclude: ['**/__tests__/**', 'frontend/src/main.tsx', 'frontend/src/vite-env.d.ts', 'frontend/src/types/**', 'frontend/src/script/ast.ts'],
      reporter: ['text-summary', 'json-summary'],
      // Alt sınır: düşüşü yakalar. Yükseldikçe sıkılaştırın.
      thresholds: { statements: 84, branches: 81, functions: 84, lines: 84 },
    },
  },
  resolve: {
    conditions: ['development', 'browser'],
  },
});
