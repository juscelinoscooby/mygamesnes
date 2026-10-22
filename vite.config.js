import { defineConfig } from 'vite'

export default defineConfig({
  base: '/',
  build: {
    target: 'es2020',
    modulePreload: { polyfill: true },
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          emulator: ['emulatorjs'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true,
  },
  preview: {
    port: 5173,
    host: true,
  },
  resolve: {
    alias: {
      // Permite que o EmulatorJS localize seus assets via caminho relativo
    },
  },
})