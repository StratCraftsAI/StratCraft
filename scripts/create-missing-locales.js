#!/usr/bin/env node
/**
 * Create ru_RU and tr_TR locale files from en_US baseline
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, '..', 'apps', 'desktop', 'src', 'i18n', 'locales');

const NAMESPACE_FILES = [
  'ui.json', 'trading.json', 'settings.json', 'marketplace.json', 'errors.json'
];

function copyLocale(sourceLocale, targetLocale) {
  const sourceDir = path.join(LOCALES_DIR, sourceLocale);
  const targetDir = path.join(LOCALES_DIR, targetLocale);
  
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    console.log(`Created directory: ${targetDir}`);
  }
  
  for (const nsFile of NAMESPACE_FILES) {
    const sourcePath = path.join(sourceDir, nsFile);
    const targetPath = path.join(targetDir, nsFile);
    
    if (fs.existsSync(sourcePath)) {
      const content = fs.readFileSync(sourcePath, 'utf-8');
      fs.writeFileSync(targetPath, content);
      console.log(`  ✓ Created ${targetLocale}/${nsFile}`);
    } else {
      console.log(`  ⚠ Source ${sourcePath} not found`);
    }
  }
}

console.log('Creating ru_RU locale from en_US baseline...');
copyLocale('en_US', 'ru_RU');

console.log('\nCreating tr_TR locale from en_US baseline...');
copyLocale('en_US', 'tr_TR');

console.log('\nDone! Note: These files contain English text and need to be translated.');
