import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Resolve the shared PF2e domain package from source. It's a workspace
      // package, but Vercel builds apps/web in isolation and its npm install
      // can't link workspaces — aliasing to the source avoids depending on the
      // install linking it (and keeps a single implementation in packages/core).
      '@pathway/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
