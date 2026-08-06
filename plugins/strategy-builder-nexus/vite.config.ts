import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// TICKET_771 Step 7 (Layer 1b): Migrate strategy-builder-nexus to the canonical
// vite library-mode build (matches plugin-template/ and quant-lab-nexus). ES
// format because this is a bundled plugin loaded by the host via dynamic
// import() -- see apps/desktop/src/renderer/lib/plugin-loader.ts:494.
// Strategy-builder has no cross-plugin imports; only @shared/* is externalised.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, '../../apps/desktop/src/shared'),
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
        '@radix-ui/react-dropdown-menu',
        /^@shared\//,
        // TICKET_809_4a: host UI exposure -- @host/<slice> imports resolve
        // against the host's vite alias at host build time (bundled path)
        // or globalThis.__nexus_host__ at runtime (IIFE marketplace path).
        /^@host\//,
      ],
    },
  },
});
