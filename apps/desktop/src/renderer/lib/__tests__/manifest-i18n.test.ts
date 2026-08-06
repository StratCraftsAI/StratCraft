/**
 * TICKET_786_6 Phase 1: tests for `resolveManifestI18nWith`.
 *
 * Coverage:
 *  - `*Key` resolves through the translator into the plugin's namespace.
 *  - Missing key falls back to the literal value (no crash, no empty string).
 *  - Plugin without `contributes.i18n` skips resolution entirely.
 *  - Empty translation result also falls back to the literal value.
 *  - Namespace isolation: a different plugin's keys never leak in.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PluginManifest } from '@shared/types';
import i18next from 'i18next';
import { resolveManifestI18nWith, getManifestNamespace, resolveManifestI18n } from '../manifest-i18n';

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'com.test.fixture',
    name: 'fixture',
    displayName: 'Fixture Plugin',
    displayNameKey: 'manifest.displayName',
    description: 'A test plugin',
    descriptionKey: 'manifest.description',
    version: '1.0.0',
    main: './index.js',
    type: 'utility',
    contributes: {
      i18n: { path: './locales', namespaces: ['fixture'] },
      commands: [
        { id: 'fx.run', title: 'Run', titleKey: 'manifest.commands.run' },
      ],
      viewsContainers: {
        sidebar: [
          {
            id: 'fx.sidebar',
            title: 'FIXTURE',
            titleKey: 'manifest.viewsContainers.sidebar',
            icon: 'icon.svg',
          },
        ],
      },
      views: {
        'fx.sidebar': [
          {
            id: 'fx.tree',
            name: 'Tree',
            nameKey: 'manifest.views.tree',
          },
        ],
      },
      editors: [
        {
          viewType: 'fx.editor',
          displayName: 'Fixture Editor',
          displayNameKey: 'manifest.editors.fxEditor',
          selector: [{ resourceScheme: 'fixture' }],
        },
      ],
      configuration: {
        title: 'Fixture Settings',
        titleKey: 'manifest.configuration.title',
        properties: {
          'fx.opt': {
            type: 'string',
            description: 'An option',
            descriptionKey: 'manifest.configuration.properties.fxOpt.description',
            category: 'General',
            categoryKey: 'manifest.configuration.properties.fxOpt.category',
            default: '',
          },
        },
      },
    },
    entitlements: {
      services: [
        {
          id: 'svc.alpha',
          name: 'ALPHA',
          nameKey: 'manifest.services.alpha.name',
          description: 'Alpha service',
          descriptionKey: 'manifest.services.alpha.description',
          category: 'ALPHA MODE',
          categoryKey: 'manifest.services.alpha.category',
          tier: 'free',
          defaultEnabled: true,
        },
      ],
    },
    ...overrides,
  };
}

describe('getManifestNamespace', () => {
  it('returns the first declared namespace', () => {
    const m = makeManifest();
    expect(getManifestNamespace(m)).toBe('fixture');
  });

  it('returns null when no i18n contribution is declared', () => {
    const m = makeManifest({ contributes: {} });
    expect(getManifestNamespace(m)).toBeNull();
  });

  it('returns null when namespaces array is empty', () => {
    const m = makeManifest({
      contributes: { i18n: { path: './locales', namespaces: [] } },
    });
    expect(getManifestNamespace(m)).toBeNull();
  });
});

describe('resolveManifestI18nWith', () => {
  it('replaces *Key fields with translator output, isolated to the plugin namespace', () => {
    const translations: Record<string, string> = {
      'manifest.displayName': 'StratForge (translated)',
      'manifest.description': 'A translated description',
      'manifest.commands.run': 'Run (translated)',
      'manifest.viewsContainers.sidebar': 'FIXTURE (translated)',
      'manifest.views.tree': 'Tree (translated)',
      'manifest.editors.fxEditor': 'Fixture Editor (translated)',
      'manifest.configuration.title': 'Fixture Settings (translated)',
      'manifest.configuration.properties.fxOpt.description': 'An option (translated)',
      'manifest.configuration.properties.fxOpt.category': 'General (translated)',
      'manifest.services.alpha.name': 'ALPHA (translated)',
      'manifest.services.alpha.description': 'Alpha service (translated)',
      'manifest.services.alpha.category': 'ALPHA MODE (translated)',
    };
    const t = vi.fn((ns: string, key: string, fallback: string): string => {
      expect(ns).toBe('fixture');
      return translations[key] ?? fallback;
    });

    const manifest = makeManifest();
    const resolved = resolveManifestI18nWith(manifest, t);

    expect(resolved.displayName).toBe('StratForge (translated)');
    expect(resolved.description).toBe('A translated description');
    expect(resolved.contributes?.commands?.[0]?.title).toBe('Run (translated)');
    expect(resolved.contributes?.viewsContainers?.sidebar?.[0]?.title).toBe(
      'FIXTURE (translated)',
    );
    expect(resolved.contributes?.views?.['fx.sidebar']?.[0]?.name).toBe(
      'Tree (translated)',
    );
    expect(resolved.contributes?.editors?.[0]?.displayName).toBe(
      'Fixture Editor (translated)',
    );
    expect(resolved.contributes?.configuration?.title).toBe(
      'Fixture Settings (translated)',
    );
    expect(
      resolved.contributes?.configuration?.properties['fx.opt']?.description,
    ).toBe('An option (translated)');
    expect(
      resolved.contributes?.configuration?.properties['fx.opt']?.category,
    ).toBe('General (translated)');
    expect(resolved.entitlements?.services[0]?.name).toBe('ALPHA (translated)');
    expect(resolved.entitlements?.services[0]?.description).toBe(
      'Alpha service (translated)',
    );
    expect(resolved.entitlements?.services[0]?.category).toBe(
      'ALPHA MODE (translated)',
    );
  });

  it('falls back to literal when key is missing', () => {
    const t = vi.fn((_ns: string, _key: string, fallback: string) => fallback);
    const manifest = makeManifest();
    const resolved = resolveManifestI18nWith(manifest, t);

    expect(resolved.displayName).toBe('Fixture Plugin');
    expect(resolved.contributes?.commands?.[0]?.title).toBe('Run');
    expect(resolved.entitlements?.services[0]?.name).toBe('ALPHA');
  });

  it('skips translation when no namespace is declared', () => {
    const t = vi.fn();
    const manifest = makeManifest({ contributes: { commands: [{ id: 'a', title: 'A', titleKey: 'irrelevant' }] } });
    const resolved = resolveManifestI18nWith(manifest, t);

    expect(t).not.toHaveBeenCalled();
    expect(resolved.displayName).toBe('Fixture Plugin');
    expect(resolved.contributes?.commands?.[0]?.title).toBe('A');
  });

  it('does not mutate the input manifest', () => {
    const t = vi.fn(() => 'translated');
    const manifest = makeManifest();
    const snapshot = JSON.stringify(manifest);
    resolveManifestI18nWith(manifest, t);
    expect(JSON.stringify(manifest)).toBe(snapshot);
  });

  it('treats an empty translator result as missing and falls back to the literal', () => {
    const t = vi.fn(() => '');
    const manifest = makeManifest();
    const resolved = resolveManifestI18nWith(manifest, t);
    // The translator returned '' for every call; the helper still uses
    // literals so users never see a blank label.
    expect(resolved.displayName).toBe('Fixture Plugin');
    expect(resolved.contributes?.commands?.[0]?.title).toBe('Run');
  });

  it('integrates with a live i18next instance via the default-export wrapper', async () => {
    // Bootstrap a real i18next instance scoped to the test.
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      ns: ['fixture'],
      defaultNS: 'fixture',
      resources: {
        en: {
          fixture: {
            manifest: {
              displayName: 'StratForge (live)',
              commands: { run: 'Run (live)' },
            },
          },
        },
      },
      interpolation: { escapeValue: false },
    });

    const manifest = makeManifest();
    const resolved = resolveManifestI18n(manifest);
    expect(resolved.displayName).toBe('StratForge (live)');
    expect(resolved.contributes?.commands?.[0]?.title).toBe('Run (live)');
  });

  it('leaves a field unchanged when no *Key is declared on it', () => {
    const t = vi.fn((_ns, _key, fallback) => `T:${fallback}`);
    const manifest: PluginManifest = {
      id: 'com.test.nokeys',
      name: 'nokeys',
      displayName: 'Untranslated',
      version: '1.0.0',
      main: './index.js',
      type: 'utility',
      contributes: {
        i18n: { path: './locales', namespaces: ['nokeys'] },
        commands: [{ id: 'a', title: 'Plain' }],
      },
    };
    const resolved = resolveManifestI18nWith(manifest, t);
    expect(resolved.displayName).toBe('Untranslated');
    expect(resolved.contributes?.commands?.[0]?.title).toBe('Plain');
  });
});
