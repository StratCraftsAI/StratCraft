#!/usr/bin/env node
/**
 * i18n Audit Script
 * 
 * Compares key structure across all locales using en_US as baseline.
 * Outputs missing keys for each locale.
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

function audit() {
  console.log('=== i18n Locale Audit ===\n');
  console.log(`Baseline: ${BASELINE}\n`);
  
  const results = {};
  
  for (const nsFile of NAMESPACE_FILES) {
    const nsName = nsFile.replace('.json', '');
    console.log(`\n--- Namespace: ${nsName} (${nsFile}) ---`);
    
    const baselinePath = path.join(LOCALES_DIR, BASELINE, nsFile);
    const baselineData = readJson(baselinePath);
    
    if (!baselineData) {
      console.log(`  [WARN] Baseline file not found or invalid`);
      continue;
    }
    
    const baselineKeys = getAllKeys(baselineData);
    console.log(`  Baseline keys: ${baselineKeys.length}`);
    
    results[nsName] = { baselineKeys: baselineKeys.length, locales: {} };
    
    for (const locale of TARGET_LOCALES) {
      const localePath = path.join(LOCALES_DIR, locale, nsFile);
      const localeData = readJson(localePath);
      
      if (!localeData) {
        console.log(`  [FAIL] ${locale}: File not found`);
        results[nsName].locales[locale] = { missing: baselineKeys.length, fileMissing: true };
        continue;
      }
      
      const localeKeys = new Set(getAllKeys(localeData));
      const missingKeys = baselineKeys.filter(key => !localeKeys.has(key));
      
      if (missingKeys.length === 0) {
        console.log(`  [OK] ${locale}: All keys present`);
      } else {
        console.log(`  [WARN] ${locale}: Missing ${missingKeys.length} keys`);
        if (missingKeys.length <= 10) {
          missingKeys.forEach(key => console.log(`    - ${key}`));
        }
      }
      
      results[nsName].locales[locale] = { 
        missing: missingKeys.length, 
        fileMissing: false,
        missingKeys: missingKeys
      };
    }
  }
  
  // Summary
  console.log('\n\n=== SUMMARY ===');
  console.log('Locale coverage vs en_US baseline:\n');
  
  const localeSummary = {};
  for (const locale of TARGET_LOCALES) {
    let totalMissing = 0;
    let totalBaseline = 0;
    let fileMissing = 0;
    
    for (const nsName of Object.keys(results)) {
      const localeData = results[nsName].locales[locale];
      totalBaseline += results[nsName].baselineKeys;
      if (localeData.fileMissing) {
        totalMissing += results[nsName].baselineKeys;
        fileMissing++;
      } else {
        totalMissing += localeData.missing;
      }
    }
    
    const coverage = totalBaseline > 0 ? ((totalBaseline - totalMissing) / totalBaseline * 100).toFixed(1) : 0;
    console.log(`${locale}: ${coverage}% coverage (${totalMissing}/${totalBaseline} keys missing, ${fileMissing} files missing)`);
    localeSummary[locale] = { coverage, totalMissing, totalBaseline, fileMissing };
  }
  
  return results;
}

audit();
