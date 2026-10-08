import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    // le studio historique est volumineux : on le garde dans son propre fichier
    chunkSizeWarningLimit: 1200,
    // deux pages : la landing (légère, sans le code Solana) et l'outil
    rollupOptions: { input: { landing: 'index.html', app: 'app.html' } },
  },
  server: { port: 5173 },
});
