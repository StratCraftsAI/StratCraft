#!/usr/bin/env node
/**
 * Sync Missing Keys Script
 * 
 * Adds missing keys from en_US baseline to other locales.
 * For missing keys, it copies the English value as a placeholder.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, '..', 'apps', 'desktop', 'src', 'i18n', 'locales');

const BASELINE = 'en_US';
const TARGET_LOCALES = [
  'de_DE', 'es_ES', 'fr_FR', 'it_IT', 'ja_JP', 'ko_KR', 
  'pt_PT', 'ru_RU', 'tr_TR', 'zh_CN', 'zh_TW'
];

const NAMESPACE_FILES = [
  'ui.json', 'trading.json', 'settings.json', 'marketplace.json', 'errors.json'
];

function readJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
    return null;
  }
}

function writeJson(filePath, data) {
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, content + '\n', 'utf-8');
}

function getAllKeys(obj, prefix = '') {
  let keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys = keys.concat(getAllKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function getNestedValue(obj, keyPath) {
  const parts = keyPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function setNestedValue(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function syncLocale(sourceData, targetData) {
  const sourceKeys = getAllKeys(sourceData);
  let addedCount = 0;
  
  for (const key of sourceKeys) {
    if (getNestedValue(targetData, key) === undefined) {
      const value = getNestedValue(sourceData, key);
      setNestedValue(targetData, key, value);
      addedCount++;
    }
  }
  
  return addedCount;
}

function sync() {
  console.log('=== Syncing Missing Keys from en_US Baseline ===\n');
  
  let totalAdded = 0;
  
  for (const nsFile of NAMESPACE_FILES) {
    const nsName = nsFile.replace('.json', '');
    console.log(`\n--- Namespace: ${nsName} (${nsFile}) ---`);
    
    const baselinePath = path.join(LOCALES_DIR, BASELINE, nsFile);
    const baselineData = readJson(baselinePath);
    
    if (!baselineData) {
      console.log(`  ⚠ Baseline file not found`);
      continue;
    }
    
    for (const locale of TARGET_LOCALES) {
      const localePath = path.join(LOCALES_DIR, locale, nsFile);
      const localeData = readJson(localePath);
      
      if (!localeData) {
        console.log(`  ⚠ ${locale}: File not found, skipping`);
        continue;
      }
      
      const added = syncLocale(baselineData, localeData);
      
      if (added > 0) {
        writeJson(localePath, localeData);
        console.log(`  ✓ ${locale}: Added ${added} missing key(s)`);
        totalAdded += added;
      } else {
        console.log(`  ✓ ${locale}: All keys present`);
      }
    }
  }
  
  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total keys added: ${totalAdded}`);
}

sync();
