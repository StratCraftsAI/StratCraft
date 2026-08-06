import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// TICKET_771 Step 5 (Layer 1a): Migrate back-test-nexus/ui to the canonical
// vite library-mode build. ES format because this is a bundled plugin loaded
// by the host via dynamic import() -- see plugin-loader.ts:494.
//
// rollupOptions.external MUST keep /^@plugins\// so the 7 runtime imports of
// @plugins/data-plugin/* (verified specifiers: config/data-providers, index,
// types/executor, utils/chart-utils, utils/downsample-utils, utils/format-utils)
// are left as bare imports for the host's renderer to resolve via its alias map
// (apps/desktop/electron.vite.config.ts:85). Inlining data-plugin code here
// would violate Tier 0/1 isolation and double-load the shared module.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, '../../../apps/desktop/src/shared'),
      '@plugins/data-plugin': resolve(__dirname, '../../data-plugin/ui/data-nexus/src'),
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
        /^@shared\//,
        /^@plugins\//,
      ],
    },
  },
});
