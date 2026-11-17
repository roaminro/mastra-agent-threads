import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The Mastra server runs on its own port (`pnpm mastra dev` in the parent
// folder). Proxying its routes keeps the app same-origin in development.
const server = process.env.MASTRA_URL ?? 'http://localhost:4111';

export default defineConfig(({ command }) => ({
  // Built for the Mastra server, which serves it at /ui (src/mastra/routes/web.ts).
  base: command === 'build' ? '/ui/' : '/',
  build: { outDir: '../src/mastra/public/ui', emptyOutDir: true },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: { proxy: { '/api': server, '/app': server } },
}));
