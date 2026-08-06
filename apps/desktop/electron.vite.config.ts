import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve, join } from 'path';
import { homedir } from 'os';
import { readFileSync } from 'fs';

// TICKET_434: Build-time API URL injection for open-source compatibility
const apiBaseUrl = process.env.StratCraft_API_URL || '';
// TICKET_492: Build-time Auth URL injection for open-source compatibility
const authBaseUrl = process.env.StratCraft_AUTH_URL || '';
// TICKET_1304_6R_I10: The GlitchTip DSN is an operational ingest credential and
// must never be hardcoded in the public tree. Release builds supply it via the
// StratCraft_GLITCHTIP_DSN secret; source builds leave it unset, which disables
// error reporting rather than pointing forks at our telemetry project.
const glitchtipDsn = process.env.StratCraft_GLITCHTIP_DSN || '';

// TICKET_573_2 Phase 2: Inject app version for Sentry release tracking in renderer
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const appVersion = pkg.version;
const buildEntryContract = JSON.parse(
  readFileSync(resolve(__dirname, 'electron-build-entries.json'), 'utf-8'),
);
const buildProfile = pkg.distribution === 'public' ? 'public' : 'full';
const buildEntries = buildEntryContract.profiles[buildProfile];
const repositoryAliases = Object.fromEntries(
  Object.entries(buildEntryContract.repositoryAliases).map(([name, relativePath]) => [
    name,
    resolve(__dirname, relativePath as string),
  ]),
);
const resolveBuildEntries = (entries: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(entries).map(([name, relativePath]) => [
      name,
      resolve(__dirname, relativePath),
    ]),
  );

// TICKET_442: User plugins directory for dev server filesystem access
// Mirrors app.getPath('userData') logic: XDG_CONFIG_HOME || ~/.config + @StratCraft/desktop
const userPluginsDir = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
  '@StratCraft',
  'desktop',
  'plugins'
);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ include: ['onnxruntime-node'] })],
    define: {
      __API_BASE_URL__: JSON.stringify(apiBaseUrl || undefined),
      __AUTH_BASE_URL__: JSON.stringify(authBaseUrl || undefined),
      __GLITCHTIP_DSN__: JSON.stringify(glitchtipDsn || undefined),
    },
    resolve: {
      alias: {
        '@shared': repositoryAliases['@shared'],
      },
    },
    build: {
      sourcemap: true,
      outDir: resolve(__dirname, 'dist/main'),
      rollupOptions: {
        input: resolveBuildEntries(buildEntries.main),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __API_BASE_URL__: JSON.stringify(apiBaseUrl || undefined),
      __AUTH_BASE_URL__: JSON.stringify(authBaseUrl || undefined),
    },
    resolve: {
      alias: {
        '@shared': repositoryAliases['@shared'],
      },
    },
    build: {
      sourcemap: true,
      outDir: resolve(__dirname, 'dist/preload'),
      rollupOptions: {
        input: resolveBuildEntries(buildEntries.preload),
      },
    },
  },
  renderer: {
    plugins: [react()],
    define: {
      __API_BASE_URL__: JSON.stringify(apiBaseUrl || undefined),
      __AUTH_BASE_URL__: JSON.stringify(authBaseUrl || undefined),
      __GLITCHTIP_DSN__: JSON.stringify(glitchtipDsn || undefined),
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    resolve: {
      alias: {
        ...repositoryAliases,
        // TICKET_771 Step 8 (Layer 4): single @plugins/<plugin-id> alias style.
        // Old @strategy-plugin / @backtest-plugin aliases were removed; every
        // host import now matches the manifest.id-based naming.
        // TICKET_443: Quant Lab is a Marketplace plugin -- runtime loaded via ViewProvider, no compile-time alias
        // PLUGIN_TICKET_018: Tier 0 data-plugin foundation
        // TICKET_809_4a: Host UI exposure for plugin shells. Bundled plugins
        // import curated host renderer components via @host/<slice>. The
        // host's vite alias resolves these to the host barrel so the plugin
        // bundle does not embed a second copy of the component or its deps.
        // Runtime mirror lives in lib/host-module-registry.ts for the future
        // IIFE marketplace path.
        // TICKET_086: Ensure plugin components can resolve modules from main app
        'react-i18next': resolve(__dirname, 'node_modules/react-i18next'),
        'i18next': resolve(__dirname, 'node_modules/i18next'),
        // PLUGIN_TICKET_008: Ensure quant-lab plugin components can resolve lucide-react
        'lucide-react': resolve(__dirname, 'node_modules/lucide-react'),
      },
    },
    // TICKET_442: Allow Vite dev server to serve user-installed plugin files
    server: {
      fs: {
        allow: [
          resolve(__dirname, '../..'), // project root (bundled plugins)
          userPluginsDir,              // user-installed plugins (Marketplace)
        ],
      },
    },
    build: {
      sourcemap: true,
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: resolveBuildEntries(buildEntries.renderer),
      },
    },
  },
});
