import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    // le studio historique est volumineux : on le garde dans son propre fichier
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173 },
});
