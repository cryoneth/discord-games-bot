import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../dist/public', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/.proxy/api': { target: 'http://localhost:3000', rewrite: (p) => p.replace(/^\/\.proxy/, '') },
      '/.proxy/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
