import { defineConfig } from 'vite';

// Réglages recommandés par Tauri : port fixe, pas d'écran effacé, cible récente.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: ['es2022', 'chrome110', 'safari16'],
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
});
