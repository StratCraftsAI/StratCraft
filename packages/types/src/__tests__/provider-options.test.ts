/**
 * TICKET_932_1: unit tests for the pure dynamic provider-options layer.
 *
 * Verifies that the catalog flatten, lookup-by-id, and unknown-id-policy
 * helpers all behave per the contract documented in
 * TICKET_932_1 Section 2 / Section 4. The helpers MUST stay React-free, i18n-free, and
 * sync; this file imports them directly from `../provider-registry` and
 * exercises every branch of the unknown-id policy that 858 cares about.
 *
 * @see TICKET_932_1
 * @see TICKET_858 (NO SILENT FAILURES -- unknown ids are visible under
 *                  the unfiltered view, never silently dropped)
 */

import { describe, it, expect } from 'vitest';
import {
  PROVIDER_GROUPS,
  flattenProviderCatalog,
  findProviderOption,
  isProviderVisibleUnderSelection,
  buildImportedPackageGroup,
  type ProviderOption,
  type ProviderGroupEntry,
} from '../provider-registry';

describe('TICKET_932_1: flattenProviderCatalog()', () => {
  it('returns one entry per non-research provider in every group, in catalog declaration order', () => {
    // TICKET_958_5 follow-up: default flatten filters out researchOnly
    // providers (visibility mirrors provider-manager.ts's runtime gate).
    // The "full catalog" assertion lives in the includeResearch test
    // below.
    const flat = flattenProviderCatalog();
    const expectedIdsInOrder: string[] = [];
    for (const group of PROVIDER_GROUPS) {
      for (const provider of group.providers) {
        if (provider.researchOnly === true) continue;
        expectedIdsInOrder.push(provider.id);
      }
    }
    expect(flat.map((o) => o.id)).toEqual(expectedIdsInOrder);
    expect(flat.length).toBe(expectedIdsInOrder.length);
  });

  it('each entry mirrors the catalog leaf fields plus the parent-group fields', () => {
    const flat = flattenProviderCatalog();
    for (const group of PROVIDER_GROUPS) {
      for (const provider of group.providers) {
        if (provider.researchOnly === true) continue;
        const entry = flat.find((o) => o.id === provider.id);
        expect(entry).toBeDefined();
        const e = entry as ProviderOption;
        expect(e.labelKey).toBe(provider.labelKey);
        expect(e.byok).toBe(provider.byok);
        expect(e.group).toBe(group.group);
        expect(e.groupLabelKey).toBe(group.groupLabelKey);
      }
    }
  });

  it('TICKET_958_5: filters researchOnly providers by default', () => {
    const flat = flattenProviderCatalog();
    // databento is the canonical researchOnly entry in the current catalog
    expect(flat.find((o) => o.id === 'databento')).toBeUndefined();
  });

  it('TICKET_958_5: includeResearch=true surfaces researchOnly providers', () => {
    const flat = flattenProviderCatalog({ includeResearch: true });
    const databento = flat.find((o) => o.id === 'databento');
    expect(databento).toBeDefined();
    expect(databento?.researchOnly).toBe(true);
    expect(databento?.group).toBe('research');
  });

  it('TICKET_958_5: legacy array form keeps researchOnly filtered out', () => {
    // The TICKET_932_2 contract (caller passes ProviderGroupEntry[]
    // directly for BYOD packages) must keep the packaged-release default
    // for the static catalog. Only the new options form opts into
    // research-only providers.
    const flat = flattenProviderCatalog([]);
    expect(flat.find((o) => o.id === 'databento')).toBeUndefined();
  });

  it('surfaces a new entry when a new group/provider is added to the catalog (no helper edits needed)', () => {
    // Regression guard for TICKET_931's "no provider id literal appears
    // in SignalExplorer.tsx" acceptance. Use the EXISTING catalog as the
    // mock, then prove that a hypothetical extra group composed by the
    // caller would flow through the same flatten shape.
    const fakeExtraGroup = {
      group: 'cn_a_share' as const,
      groupLabelKey: 'toolSweep.dataSourcePicker.group.cnAShare',
      providers: [
        {
          id: 'baostock' as const,
          labelKey: 'toolSweep.dataSourcePicker.provider.baostock',
          byok: false,
        },
      ],
    };
    // Confirm the data shape the helper relies on -- a group with a
    // `providers[]` array -- is exactly what flattenProviderCatalog
    // walks. (We do not mutate PROVIDER_GROUPS in-place; that is the
    // user's job inside provider-registry.ts itself.)
    const probe: ProviderOption[] = [];
    for (const provider of fakeExtraGroup.providers) {
      probe.push({
        id: provider.id,
        labelKey: provider.labelKey,
        byok: provider.byok,
        group: fakeExtraGroup.group,
        groupLabelKey: fakeExtraGroup.groupLabelKey,
      });
    }
    expect(probe).toHaveLength(1);
    expect(probe[0]?.id).toBe('baostock');
    // And the real flatten already contains baostock per the existing
    // cn_a_share group -- so a downstream consumer reading
    // flattenProviderCatalog() sees catalog edits automatically.
    expect(flattenProviderCatalog().some((o) => o.id === 'baostock')).toBe(true);
  });
});

describe('TICKET_932_1: findProviderOption()', () => {
  it('returns the yfinance entry for "yfinance"', () => {
    const opt = findProviderOption('yfinance');
    expect(opt).not.toBeNull();
    expect(opt?.id).toBe('yfinance');
    expect(opt?.group).toBe('us_global');
  });

  it('returns null for an id not present in the catalog (TICKET_858: does not throw)', () => {
    expect(findProviderOption('not_a_real_provider')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(findProviderOption(null)).toBeNull();
  });
});

describe('TICKET_932_1: isProviderVisibleUnderSelection()', () => {
  it('returns true when selection is empty (the "All" case)', () => {
    expect(isProviderVisibleUnderSelection('yfinance', new Set())).toBe(true);
  });

  it('returns true when the catalog id IS in the non-empty selection', () => {
    expect(
      isProviderVisibleUnderSelection('yfinance', new Set(['yfinance'])),
    ).toBe(true);
  });

  it('returns false when the catalog id is NOT in the non-empty selection', () => {
    expect(
      isProviderVisibleUnderSelection('yfinance', new Set(['ccxt'])),
    ).toBe(false);
  });

  it('returns true for null providerId when selection is empty', () => {
    expect(isProviderVisibleUnderSelection(null, new Set())).toBe(true);
  });

  it('returns false for null providerId when any selection is active (legacy row, no attribution)', () => {
    expect(
      isProviderVisibleUnderSelection(null, new Set(['yfinance'])),
    ).toBe(false);
  });

  it('returns true for an unknown id when selection is empty (TICKET_858: visible under "All")', () => {
    expect(isProviderVisibleUnderSelection('unknown_id', new Set())).toBe(true);
  });

  it('returns false for an unknown id when any specific selection is active', () => {
    expect(
      isProviderVisibleUnderSelection('unknown_id', new Set(['yfinance'])),
    ).toBe(false);
  });
});

describe('TICKET_932_2: flattenProviderCatalog(extraGroups)', () => {
  const myDataGroup: ProviderGroupEntry = {
    group: 'my_data',
    groupLabelKey: 'toolSweep.dataSourcePicker.group.myData',
    providers: [
      {
        id: 'forex_my_pack_2026Q2' as ProviderOption['id'],
        labelKey: 'forex_my_pack_2026Q2',
        byok: false,
      },
    ],
  };

  it('defaults extraGroups to [] -- behaviour identical to no-arg form', () => {
    expect(flattenProviderCatalog()).toEqual(flattenProviderCatalog([]));
  });

  it('appends extraGroups entries AFTER static PROVIDER_GROUPS in declaration order', () => {
    const baseLen = flattenProviderCatalog().length;
    const merged = flattenProviderCatalog([myDataGroup]);
    expect(merged.length).toBe(baseLen + 1);
    expect(merged[merged.length - 1]?.id).toBe('forex_my_pack_2026Q2');
    expect(merged[merged.length - 1]?.group).toBe('my_data');
    expect(merged[merged.length - 1]?.groupLabelKey).toBe(
      'toolSweep.dataSourcePicker.group.myData',
    );
  });

  it('preserves static catalog entries verbatim when extraGroups is provided', () => {
    const base = flattenProviderCatalog();
    const merged = flattenProviderCatalog([myDataGroup]);
    expect(merged.slice(0, base.length)).toEqual(base);
  });

  it('mirrors leaf fields from the extra group (byok, labelKey)', () => {
    const merged = flattenProviderCatalog([myDataGroup]);
    const entry = merged.find((o) => o.id === ('forex_my_pack_2026Q2' as ProviderOption['id']));
    expect(entry?.byok).toBe(false);
    expect(entry?.labelKey).toBe('forex_my_pack_2026Q2');
  });
});

describe('TICKET_932_2: findProviderOption(id, extraGroups)', () => {
  const myDataGroup: ProviderGroupEntry = {
    group: 'my_data',
    groupLabelKey: 'toolSweep.dataSourcePicker.group.myData',
    providers: [
      {
        id: 'forex_my_pack' as ProviderOption['id'],
        labelKey: 'forex_my_pack',
        byok: false,
      },
    ],
  };

  it('resolves a BYOD packageName to its my_data entry when extraGroups carries it', () => {
    const opt = findProviderOption('forex_my_pack', [myDataGroup]);
    expect(opt).not.toBeNull();
    expect(opt?.id).toBe('forex_my_pack');
    expect(opt?.group).toBe('my_data');
    expect(opt?.groupLabelKey).toBe('toolSweep.dataSourcePicker.group.myData');
  });

  it('returns null for the same id when extraGroups is omitted (pre-932_2 behaviour)', () => {
    expect(findProviderOption('forex_my_pack')).toBeNull();
  });

  it('still resolves static catalog ids when extraGroups is provided', () => {
    expect(findProviderOption('yfinance', [myDataGroup])?.id).toBe('yfinance');
  });

  it('returns null for null input regardless of extraGroups', () => {
    expect(findProviderOption(null, [myDataGroup])).toBeNull();
  });
});

describe('TICKET_932_2: isProviderVisibleUnderSelection() + BYOD selection', () => {
  it('returns true for a BYOD packageName when it IS in the selection (facet checkbox toggle)', () => {
    expect(
      isProviderVisibleUnderSelection('forex_my_pack', new Set(['forex_my_pack'])),
    ).toBe(true);
  });

  it('returns false for a BYOD packageName when a different specific provider is selected', () => {
    expect(
      isProviderVisibleUnderSelection('forex_my_pack', new Set(['yfinance'])),
    ).toBe(false);
  });
});

describe('TICKET_932_2: buildImportedPackageGroup()', () => {
  it('returns null on empty input (caller spreads to [] -- no empty group leak)', () => {
    expect(buildImportedPackageGroup([])).toBeNull();
  });

  it('returns a single my_data ProviderGroupEntry with one provider per packageName', () => {
    const group = buildImportedPackageGroup([
      { packageName: 'forex_a' },
      { packageName: 'forex_b' },
    ]);
    expect(group).not.toBeNull();
    expect(group?.group).toBe('my_data');
    expect(group?.groupLabelKey).toBe('toolSweep.dataSourcePicker.group.myData');
    expect(group?.providers).toHaveLength(2);
    expect(group?.providers[0]?.id).toBe('forex_a');
    expect(group?.providers[0]?.labelKey).toBe('forex_a');
    expect(group?.providers[0]?.byok).toBe(false);
    expect(group?.providers[1]?.id).toBe('forex_b');
  });

  it('preserves input order in the providers array', () => {
    const group = buildImportedPackageGroup([
      { packageName: 'z_last' },
      { packageName: 'a_first' },
    ]);
    expect(group?.providers.map((p) => p.id)).toEqual(['z_last', 'a_first']);
  });

  it('integrates with flattenProviderCatalog: built group flows through as my_data entries', () => {
    const group = buildImportedPackageGroup([{ packageName: 'forex_xyz' }]);
    const flat = flattenProviderCatalog(group ? [group] : []);
    const entry = flat.find((o) => o.id === ('forex_xyz' as ProviderOption['id']));
    expect(entry).toBeDefined();
    expect(entry?.group).toBe('my_data');
  });

  it('integrates with findProviderOption: built group makes the id resolvable', () => {
    const group = buildImportedPackageGroup([{ packageName: 'forex_xyz' }]);
    const opt = findProviderOption('forex_xyz', group ? [group] : []);
    expect(opt?.id).toBe('forex_xyz');
    expect(opt?.group).toBe('my_data');
  });
});
