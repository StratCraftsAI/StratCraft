import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/index.tsx',
      name: '__nexus_plugin_export__',
      formats: ['iife'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react-i18next',
        'i18next',
        'lucide-react',
      ],
      output: {
        globals: {
          react: '__nexus_modules__.react',
          'react-dom': '__nexus_modules__["react-dom"]',
          'react/jsx-runtime': '__nexus_modules__["react/jsx-runtime"]',
          'react-i18next': '__nexus_modules__["react-i18next"]',
          i18next: '__nexus_modules__.i18next',
          'lucide-react': '__nexus_modules__["lucide-react"]',
        },
      },
    },
    outDir: 'dist',
  },
});
