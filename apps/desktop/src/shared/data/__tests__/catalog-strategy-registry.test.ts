import { describe, it, expect } from 'vitest';
import {
  CATALOG_STRATEGIES,
  CATALOG_CATEGORIES,
} from '../catalog-strategy-registry';

describe('catalog-strategy-registry', () => {
  describe('CATALOG_STRATEGIES', () => {
    it('contains 67 strategies', () => {
      expect(CATALOG_STRATEGIES).toHaveLength(67);
    });

    it('all strategies have required fields', () => {
      for (const s of CATALOG_STRATEGIES) {
        expect(s.id).toBeTruthy();
        expect(s.title).toBeTruthy();
        expect(s.subtitle).toBeTruthy();
        expect(s.category).toBeTruthy();
        expect(s.categoryTitle).toBeTruthy();
        expect(s.riskLevel).toBeTruthy();
        expect(s.timeframe.length).toBeGreaterThan(0);
        expect(s.marketType.length).toBeGreaterThan(0);
        expect(s.worksIn.length).toBeGreaterThan(0);
        expect(s.failsIn.length).toBeGreaterThan(0);
        expect(s.pipeline.length).toBe(5);
        expect(s.indicators.length).toBeGreaterThanOrEqual(3);
        expect(s.entryRules.length).toBeGreaterThan(0);
        expect(s.exitRules.length).toBeGreaterThan(0);
        expect(s.riskRules.length).toBeGreaterThan(0);
      }
    });

    it('all strategy IDs are unique', () => {
      const ids = CATALOG_STRATEGIES.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('all strategy titles are unique', () => {
      const titles = CATALOG_STRATEGIES.map(s => s.title);
      expect(new Set(titles).size).toBe(titles.length);
    });

    it('risk levels are valid values', () => {
      const validRisk = ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'];
      for (const s of CATALOG_STRATEGIES) {
        expect(validRisk).toContain(s.riskLevel);
      }
    });

    it('every pipeline stage has a title and 3 conditions', () => {
      for (const s of CATALOG_STRATEGIES) {
        for (const stage of s.pipeline) {
          expect(stage.title).toBeTruthy();
          expect(stage.conditions).toHaveLength(3);
          for (const cond of stage.conditions) {
            expect(cond).toBeTruthy();
          }
        }
      }
    });

    it('every indicator has name, role, and formula', () => {
      for (const s of CATALOG_STRATEGIES) {
        for (const ind of s.indicators) {
          expect(ind.name).toBeTruthy();
          expect(ind.role).toBeTruthy();
          expect(ind.formula).toBeTruthy();
        }
      }
    });

    it('category of every strategy matches a known category id', () => {
      const catIds = new Set(CATALOG_CATEGORIES.map(c => c.id));
      for (const s of CATALOG_STRATEGIES) {
        expect(catIds.has(s.category)).toBe(true);
      }
    });
  });

  describe('CATALOG_CATEGORIES', () => {
    it('contains 11 categories', () => {
      expect(CATALOG_CATEGORIES).toHaveLength(11);
    });

    it('all categories have required fields', () => {
      for (const c of CATALOG_CATEGORIES) {
        expect(c.id).toBeTruthy();
        expect(c.title).toBeTruthy();
        expect(c.count).toBeGreaterThan(0);
      }
    });

    it('all category IDs are unique', () => {
      const ids = CATALOG_CATEGORIES.map(c => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('category counts match actual strategy count per category', () => {
      for (const cat of CATALOG_CATEGORIES) {
        const actual = CATALOG_STRATEGIES.filter(s => s.category === cat.id).length;
        expect(actual).toBe(cat.count);
      }
    });

    it('total of all category counts equals 67', () => {
      const total = CATALOG_CATEGORIES.reduce((sum, c) => sum + c.count, 0);
      expect(total).toBe(67);
    });
  });
});
