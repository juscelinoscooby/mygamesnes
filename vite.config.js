import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    emptyOutDir: false,
    chunkSizeWarningLimit: 1000,
    copyPublicDir: false,
    assetsDir: '',
    rollupOptions: {
      input: 'index.html',
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: (info) => {
          if (info.name && info.name.endsWith('.html')) return '[name][extname]'
          return '[name][extname]'
        },
      },
    },
  },
  publicDir: false,
  server: {
    port: 5173,
    host: true,
    strictPort: true,
  },
  preview: {
    port: 5173,
    host: true,
  },
})
