#!/usr/bin/env ts-node
/**
 * create-plugin.ts - Plugin Development Scaffold
 *
 * Usage:
 *   npx ts-node scripts/create-plugin.ts --name="my-plugin" --type="ui"
 *   npm run create-plugin -- --name="my-plugin" --type="ui"
 */

import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

interface PluginOptions {
  name: string;
  type: 'ui' | 'data-source' | 'indicator' | 'strategy' | 'execution' | 'analysis' | 'utility';
  author?: string;
  description?: string;
}

// =============================================================================
// Templates
// =============================================================================

function generateManifest(options: PluginOptions): string {
  const pluginId = `com.StratCraft.${options.name}`;
  const displayName = options.name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return JSON.stringify({
    "$schema": "https://StratCraft.io/schemas/plugin-manifest.json",
    "id": pluginId,
    "name": displayName,
    "version": "1.0.0",
    "description": options.description || `${displayName} plugin for StratCraft`,
    "author": options.author || "StratCraft",
    "license": "MIT",

    "main": "./dist/index.js",
    "type": options.type,
    "category": options.type === 'ui' ? 'visualization' : 'tools',

    "contributes": {
      "mainView": options.type === 'ui' ? [{
        "id": `${options.name}-view`,
        "title": displayName,
        "entry": `./dist/${pascalCase(options.name)}View.js`,
        "icon": "box",
        "route": `/${options.name}`,
        "order": 10
      }] : undefined,
      "commands": [{
        "id": `${options.name}.hello`,
        "title": `Hello from ${displayName}`,
        "category": displayName
      }]
    },

    "permissions": ["network:internal"],
    "isolation": "trusted",
    "activationEvents": ["onStartup"]
  }, null, 2);
}

function generatePackageJson(options: PluginOptions): string {
  return JSON.stringify({
    "name": `@StratCraft/plugin-${options.name}`,
    "version": "1.0.0",
    "description": options.description || `${options.name} plugin for StratCraft`,
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": {
      "build": "tsc",
      "dev": "tsc --watch",
      "clean": "rm -rf dist"
    },
    "peerDependencies": {
      "react": "^18.0.0",
      "react-dom": "^18.0.0"
    },
    "devDependencies": {
      "@types/react": "^18.2.0",
      "@types/react-dom": "^18.2.0",
      "typescript": "^5.3.0"
    }
  }, null, 2);
}

function generateTsConfig(): string {
  return JSON.stringify({
    "compilerOptions": {
      "target": "ES2020",
      "lib": ["ES2020", "DOM", "DOM.Iterable"],
      "module": "ESNext",
      "moduleResolution": "bundler",
      "jsx": "react-jsx",
      "strict": true,
      "skipLibCheck": true,
      "esModuleInterop": true,
      "allowSyntheticDefaultImports": true,
      "forceConsistentCasingInFileNames": true,
      "declaration": true,
      "declarationMap": true,
      "outDir": "./dist",
      "rootDir": "./src"
    },
    "include": ["src/**/*"],
    "exclude": ["node_modules", "dist"]
  }, null, 2);
}

function generateTypes(): string {
  return `/**
 * Plugin Types
 *
 * Type definitions imported from host application
 */

export interface PluginContext {
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

export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface PluginCommands {
  register(id: string, handler: (...args: unknown[]) => unknown): void;
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  getAll(): string[];
}

export interface PluginMessaging {
  send(target: string, message: unknown): void;
  broadcast(message: unknown): void;
  onMessage(handler: (source: string, message: unknown) => void): void;
}

export interface PluginStateApi {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  subscribe(key: string, handler: (value: unknown) => void): () => void;
}

export interface PluginUi {
  showNotification(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
  showDialog(options: DialogOptions): Promise<DialogResult>;
  showProgress(title: string): ProgressHandle;
}

export interface DialogOptions {
  title: string;
  message: string;
  buttons?: string[];
  type?: 'info' | 'warning' | 'error' | 'question';
}

export interface DialogResult {
  button: string;
  checkboxChecked?: boolean;
}

export interface ProgressHandle {
  update(progress: number, message?: string): void;
  done(): void;
}

export interface PluginData {
  getMarketData(symbol: string, interval: string, start: string, end: string): Promise<unknown[]>;
  getSymbols(): Promise<string[]>;
  subscribe(symbol: string, handler: (data: unknown) => void): () => void;
}

export interface PluginApi {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  getConfig?(): Record<string, unknown>;
  setConfig?(config: Record<string, unknown>): void;
}
`;
}

function generateIndex(options: PluginOptions): string {
  const displayName = pascalCase(options.name);

  return `/**
 * ${displayName} Plugin Entry Point
 */

import type { PluginContext, PluginApi } from './types';

class ${displayName}PluginApi implements PluginApi {
  private context: PluginContext;

  constructor(context: PluginContext) {
    this.context = context;
  }

  async activate(): Promise<void> {
    this.context.log.info('${displayName} plugin activated');

    // Register commands
    this.context.commands.register('hello', () => {
      this.context.ui.showNotification('Hello from ${displayName}!', 'info');
    });
  }

  async deactivate(): Promise<void> {
    this.context.log.info('${displayName} plugin deactivated');
  }

  getConfig(): Record<string, unknown> {
    return {};
  }

  setConfig(_config: Record<string, unknown>): void {
    // Handle config updates
  }
}

export async function activate(context: PluginContext): Promise<PluginApi> {
  const api = new ${displayName}PluginApi(context);
  await api.activate();
  return api;
}

export async function deactivate(): Promise<void> {
  // Cleanup if needed
}

export default { activate, deactivate };
`;
}

function generateMainView(options: PluginOptions): string {
  const displayName = pascalCase(options.name);

  return `/**
 * ${displayName}View - Main View Component
 */

import React from 'react';

interface ${displayName}ViewProps {
  className?: string;
}

export function ${displayName}View({ className }: ${displayName}ViewProps): JSX.Element {
  return (
    <div className={\`flex flex-col h-full p-6 \${className ?? ''}\`}>
      <div className="flex items-center justify-center flex-1">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">
            ${displayName} Plugin
          </h1>
          <p className="text-gray-400">
            Start building your plugin here!
          </p>
        </div>
      </div>
    </div>
  );
}

export default ${displayName}View;
`;
}

// =============================================================================
// Helpers
// =============================================================================

function pascalCase(str: string): string {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function parseArgs(): PluginOptions {
  const args = process.argv.slice(2);
  const options: Partial<PluginOptions> = {};

  for (const arg of args) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'name') options.name = value;
    if (key === 'type') options.type = value as PluginOptions['type'];
    if (key === 'author') options.author = value;
    if (key === 'description') options.description = value;
  }

  if (!options.name) {
    console.error('Error: --name is required');
    console.log('Usage: create-plugin --name="my-plugin" --type="ui"');
    process.exit(1);
  }

  return {
    name: options.name,
    type: options.type || 'ui',
    author: options.author,
    description: options.description,
  };
}

// =============================================================================
// Main
// =============================================================================

function main(): void {
  const options = parseArgs();
  const pluginDir = path.join(process.cwd(), 'plugins', options.name);

  console.log(`Creating plugin: ${options.name}`);
  console.log(`Type: ${options.type}`);
  console.log(`Directory: ${pluginDir}`);
  console.log('');

  // Check if directory exists
  if (fs.existsSync(pluginDir)) {
    console.error(`Error: Directory already exists: ${pluginDir}`);
    process.exit(1);
  }

  // Create directories
  fs.mkdirSync(path.join(pluginDir, 'src', 'components'), { recursive: true });

  // Write files
  const files: [string, string][] = [
    ['manifest.json', generateManifest(options)],
    ['package.json', generatePackageJson(options)],
    ['tsconfig.json', generateTsConfig()],
    ['src/types.ts', generateTypes()],
    ['src/index.ts', generateIndex(options)],
  ];

  if (options.type === 'ui') {
    files.push([`src/${pascalCase(options.name)}View.tsx`, generateMainView(options)]);
  }

  for (const [filename, content] of files) {
    const filepath = path.join(pluginDir, filename);
    fs.writeFileSync(filepath, content, 'utf-8');
    console.log(`  Created: ${filename}`);
  }

  console.log('');
  console.log('Plugin created successfully!');
  console.log('');
  console.log('Next steps:');
  console.log(`  cd plugins/${options.name}`);
  console.log('  npm install');
  console.log('  npm run build');
}

main();
