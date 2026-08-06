import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// TICKET_771 Step 6 (Layer 1d): Migrate data-plugin/ui/data-nexus to the
// canonical vite library-mode build. Tier 0 foundation; back-test-nexus
// reverse-depends via @plugins/data-plugin/* compile-time alias on the host
// (apps/desktop/electron.vite.config.ts:85) -- that path is unaffected here,
// only the lifecycle dist artifact moves to ./dist/index.js.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../../../../apps/desktop/src/shared'),
    },
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react-i18next',
        'i18next',
        'lucide-react',
        'zustand',
        'zustand/vanilla',
        /^@shared\//,
      ],
    },
  },
});
