#!/usr/bin/env node

/**
 * @StratCraft/create-plugin
 *
 * Interactive scaffold for new StratCraft plugins.
 *
 * Usage:
 *   npx @StratCraft/create-plugin
 *   npx @StratCraft/create-plugin my-plugin
 *   node packages/create-plugin/src/index.mjs my-plugin
 */

import { createInterface } from 'readline';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

// ---------------------------------------------------------------------------
// Interactive prompt helper (zero dependencies)
//
// When stdin is a TTY (interactive), prompts the user for input.
// When stdin is piped (CI/scripting), reads all lines upfront and uses them
// as answers in order, falling back to defaults for missing lines.
// ---------------------------------------------------------------------------

async function readPipedLines() {
  return new Promise((resolve) => {
    const lines = [];
    const rl = createInterface({ input: process.stdin });
    rl.on('line', (line) => lines.push(line.trim()));
    rl.on('close', () => resolve(lines));
  });
}

function createInteractivePrompt() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask(question, defaultValue) {
      return new Promise((res) => {
        const suffix = defaultValue ? ` (${defaultValue})` : '';
        rl.question(`  ${question}${suffix}: `, (answer) => {
          res(answer.trim() || defaultValue || '');
        });
      });
    },
    close() { rl.close(); },
  };
}

function createPipedPrompt(lines) {
  let idx = 0;
  return {
    ask(_question, defaultValue) {
      const answer = idx < lines.length ? lines[idx++] : '';
      return Promise.resolve(answer || defaultValue || '');
    },
    close() {},
  };
}

// ---------------------------------------------------------------------------
// Template generators
// ---------------------------------------------------------------------------

function manifestJson(cfg) {
  return JSON.stringify({
    id: cfg.id,
    name: cfg.name,
    displayName: cfg.displayName,
    version: '1.0.0',
    description: cfg.description,
    author: cfg.author,
    license: 'MIT',
    tier: cfg.tier,
    distribution: 'marketplace',
    main: `./ui/${cfg.nexusName}/dist/index.js`,
    dependencies: { plugins: [] },
  }, null, 2) + '\n';
}

function packageJson(cfg) {
  return JSON.stringify({
    name: cfg.nexusName,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite build --watch',
      build: 'tsc --noEmit && vite build',
      validate: 'node ../../scripts/validate.mjs',
    },
    dependencies: {
      react: '^18.2.0',
      'react-dom': '^18.2.0',
    },
    peerDependencies: {
      react: '^18.2.0',
      'react-dom': '^18.2.0',
    },
    devDependencies: {
      '@types/react': '^18.2.0',
      '@types/react-dom': '^18.2.0',
      '@vitejs/plugin-react': '^4.2.0',
      typescript: '^5.7.0',
      vite: '^5.4.0',
      'lucide-react': '^0.400.0',
    },
  }, null, 2) + '\n';
}

function viteConfig() {
  return `import { defineConfig } from 'vite';
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
    sourcemap: true,
  },
});
`;
}

function tsconfig() {
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      jsx: 'react-jsx',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  }, null, 2) + '\n';
}

function indexTsx(cfg) {
  return `import React from 'react';

const ${cfg.componentName}: React.FC = () => (
  <div style={{ padding: '16px', color: 'var(--color-text-primary)' }}>
    <h2>${cfg.displayName}</h2>
    <p>This panel is rendered by the ${cfg.displayName} plugin.</p>
  </div>
);

const pluginModule = {
  async activate(context: PluginContext) {
    context.log.info('${cfg.displayName} activating...');

    globalThis.nexus!.window.registerViewProvider('${cfg.name}.panel', {
      render: () => <${cfg.componentName} />,
    });

    return {
      activate: async () => {},
      deactivate: async () => {},
    };
  },

  async deactivate() {
    // Cleanup resources
  },
};

export default pluginModule;
`;
}

function globalDts() {
  return `interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

interface PluginCommands {
  register(id: string, handler: (...args: unknown[]) => unknown): void;
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  getAll(): string[];
}

interface PluginMessaging {
  send(target: string, message: unknown): void;
  broadcast(message: unknown): void;
  onMessage(handler: (source: string, message: unknown) => void): void;
}

interface PluginStateApi {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  subscribe(key: string, handler: (value: unknown) => void): () => void;
}

interface PluginUi {
  showNotification(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
}

interface PluginData {}

interface PluginContext {
  pluginId: string;
  pluginPath: string;
  log: PluginLogger;
  storage: PluginStorage;
  commands: PluginCommands;
  messaging: PluginMessaging;
  state: PluginStateApi;
  ui: PluginUi;
  data: PluginData;
}

interface PluginApi {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  getConfig?(): Record<string, unknown>;
  setConfig?(config: Record<string, unknown>): void;
}

interface ViewProvider {
  render: () => React.ReactNode;
}

interface NexusWindowApi {
  registerViewProvider(viewId: string, provider: ViewProvider): { dispose(): void };
  registerTreeDataProvider(viewId: string, provider: unknown): { dispose(): void };
  openView(viewId: string): void;
  closeView(viewId: string): void;
  showAlert(options: { title: string; message: string }): Promise<void>;
  showConfirm(options: { title: string; message: string }): Promise<boolean>;
  showNotification(options: { message: string; type?: string }): void;
}

interface ElectronAPI {
  // Declare only the IPC methods your plugin calls.
}

declare global {
  var nexus: { window: NexusWindowApi } | undefined;
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
`;
}

function validateScript(cfg) {
  return `#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let errors = 0;

function pass(msg) { console.log('  \\x1b[32m\\u2713\\x1b[0m ' + msg); }
function fail(msg) { console.log('  \\x1b[31m\\u2717\\x1b[0m ' + msg); errors++; }

console.log('\\nValidating plugin build...\\n');

const distPath = resolve(root, 'ui/${cfg.nexusName}/dist/index.js');
if (!existsSync(distPath)) {
  fail('dist/index.js not found. Run "pnpm build" first.');
} else {
  pass('dist/index.js exists');
  const code = readFileSync(distPath, 'utf-8');

  if (code.includes('__nexus_plugin_export__')) {
    pass('IIFE format detected (__nexus_plugin_export__)');
  } else {
    fail('Missing __nexus_plugin_export__. Check vite.config.ts lib.name');
  }

  if (code.includes('createElement') && code.includes('useState') && code.length > 50000) {
    fail('React appears bundled. Add "react" to rollupOptions.external');
  } else {
    pass('React is not bundled');
  }

  if (/^(import |export )/m.test(code)) {
    fail('ESM syntax detected. Output must be IIFE.');
  } else {
    pass('No ESM syntax in output');
  }
}

const manifestPath = resolve(root, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail('manifest.json not found');
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const required = ['id', 'name', 'version', 'tier', 'distribution', 'main'];
  for (const field of required) {
    if (manifest[field] === undefined) fail('manifest.json missing: "' + field + '"');
  }
  if (manifest.tier !== undefined && ![0, 1].includes(manifest.tier)) {
    fail('manifest.json "tier" must be 0 or 1');
  }
  if (errors === 0) pass('manifest.json valid');
}

console.log('');
if (errors > 0) {
  console.log('  \\x1b[31m' + errors + ' error(s). Fix before publishing.\\x1b[0m\\n');
  process.exit(1);
} else {
  console.log('  \\x1b[32mAll checks passed.\\x1b[0m\\n');
}
`;
}

function gitignore() {
  return `node_modules/
ui/*/dist/
.idea/
.vscode/
*.swp
*.swo
.DS_Store
Thumbs.db
*.log
.env
.env.local
`;
}

function license() {
  const year = new Date().getFullYear();
  return `MIT License

Copyright (c) ${year}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

function readme(cfg) {
  return `# ${cfg.displayName}

A StratCraft plugin.

## Quick Start

\`\`\`bash
cd ui/${cfg.nexusName}
pnpm install
pnpm build
pnpm validate
\`\`\`

## Install

\`\`\`bash
# Linux
cp -r . ~/.config/@StratCraft/desktop/plugins/${cfg.name}/

# macOS
cp -r . ~/Library/Application\\ Support/@StratCraft/desktop/plugins/${cfg.name}/
\`\`\`

Restart StratCraft and activate the plugin from the Nexus Hub.

## Development

\`\`\`bash
cd ui/${cfg.nexusName}
pnpm dev        # Watch mode
pnpm build      # Production build
pnpm validate   # Check output format
\`\`\`

## References

- [Plugin SDK Reference](https://github.com/StratCraftsAI/StratCraft/blob/main/docs/plugin/PLUGIN_SDK_REFERENCE.md)
- [Plugin Manifest Reference](https://github.com/StratCraftsAI/StratCraft/blob/main/docs/plugin/PLUGIN_MANIFEST_REFERENCE.md)
- [Quick Start Guide](https://github.com/StratCraftsAI/StratCraft/blob/main/docs/plugin/QUICKSTART.md)

## License

[MIT](LICENSE)
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function toPascalCase(str) {
  return str
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function toDisplayName(str) {
  return str
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

async function main() {
  console.log('\n  @StratCraft/create-plugin\n');

  const isTTY = process.stdin.isTTY;
  const prompt = isTTY
    ? createInteractivePrompt()
    : createPipedPrompt(await readPipedLines());

  // Plugin name from CLI arg or prompt
  let name = process.argv[2] || '';
  if (!name) {
    name = await prompt.ask('Plugin name (kebab-case)', 'my-plugin');
  }

  // Validate name
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error('\n  Error: Plugin name must be lowercase kebab-case (e.g., "my-plugin")\n');
    process.exit(1);
  }

  const author = await prompt.ask('Author', '');
  const description = await prompt.ask('Description', `A StratCraft plugin`);
  const tierInput = await prompt.ask('Tier (0=Foundation, 1=Business)', '1');
  const tier = tierInput === '0' ? 0 : 1;

  prompt.close();

  const cfg = {
    name,
    displayName: toDisplayName(name),
    componentName: toPascalCase(name) + 'Panel',
    nexusName: `${name}-nexus`,
    id: `com.example.${name}`,
    author,
    description,
    tier,
  };

  const outDir = resolve(process.cwd(), name);

  if (existsSync(outDir)) {
    console.error(`\n  Error: Directory "${name}" already exists.\n`);
    process.exit(1);
  }

  // Create directories
  const dirs = [
    '',
    `ui/${cfg.nexusName}/src/types`,
    `ui/${cfg.nexusName}/src/components`,
    `ui/${cfg.nexusName}/src/pages`,
    `ui/${cfg.nexusName}/src/hooks`,
    `locales/${name}`,
    'scripts',
  ];

  for (const dir of dirs) {
    mkdirSync(join(outDir, dir), { recursive: true });
  }

  // Write files
  const files = [
    ['manifest.json', manifestJson(cfg)],
    ['.gitignore', gitignore()],
    ['LICENSE', license()],
    ['README.md', readme(cfg)],
    ['scripts/validate.mjs', validateScript(cfg)],
    [`ui/${cfg.nexusName}/package.json`, packageJson(cfg)],
    [`ui/${cfg.nexusName}/tsconfig.json`, tsconfig()],
    [`ui/${cfg.nexusName}/vite.config.ts`, viteConfig()],
    [`ui/${cfg.nexusName}/src/index.tsx`, indexTsx(cfg)],
    [`ui/${cfg.nexusName}/src/types/global.d.ts`, globalDts()],
  ];

  for (const [path, content] of files) {
    writeFileSync(join(outDir, path), content);
  }

  // Summary
  console.log(`
  Plugin created at ./${name}/

  Next steps:

    cd ${name}/ui/${cfg.nexusName}
    pnpm install
    pnpm build
    pnpm validate

  Then copy to StratCraft plugins directory:

    cp -r ../${name} ~/.config/@StratCraft/desktop/plugins/${name}/

  Docs:
    SDK Reference:      https://github.com/StratCraftsAI/StratCraft/blob/main/docs/plugin/PLUGIN_SDK_REFERENCE.md
    Manifest Reference: https://github.com/StratCraftsAI/StratCraft/blob/main/docs/plugin/PLUGIN_MANIFEST_REFERENCE.md
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
