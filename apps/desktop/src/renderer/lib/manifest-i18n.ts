/**
 * TICKET_786_6 Phase 1: Manifest i18n resolver
 *
 * Plugin manifests carry user-visible strings (`displayName`, `description`,
 * service `name` / `category`, view `title`, command `title`, configSchema
 * `description` / `category`). Without an i18n contract these strings ship in
 * a single language regardless of the user's locale.
 *
 * This helper provides a render-time resolver: pass a manifest, get back a
 * shallow copy whose user-visible fields are replaced with `t(*Key)` values
 * when (a) the manifest declares the optional `*Key` sibling AND (b) the key
 * resolves to a non-empty string in the plugin's own i18n namespace.
 *
 * Locale changes propagate automatically because consumers call this helper
 * inside render bodies that already re-render via `useTranslation()`.
 */
import type {
  PluginManifest,
  ServiceEntitlementDefinition,
  ViewContribution,
  ViewContainerItem,
  EditorContribution,
  CommandContribution,
  ConfigurationContribution,
  ConfigurationProperty,
  MainViewContribution,
  SidePanelContribution,
  BottomPanelContribution,
} from '@shared/types';
import i18n from 'i18next';

/**
 * Translator function signature accepted by the resolver.
 *
 * The default exported `resolveManifestI18n` uses the live `i18next` instance,
 * but tests inject a stub via `resolveManifestI18nWith`.
 */
export type ManifestTranslator = (
  ns: string,
  key: string,
  fallback: string,
) => string;

/**
 * Default translator: delegates to `i18next.t(key, { ns, defaultValue })`.
 */
function defaultTranslator(ns: string, key: string, fallback: string): string {
  const value = i18n.t(key, { ns, defaultValue: fallback });
  return typeof value === 'string' ? value : fallback;
}

/**
 * Infer a plugin's primary i18n namespace from its manifest.
 *
 * Order:
 *   1. `manifest.contributes.i18n.namespaces[0]` (explicit declaration).
 *   2. `null` -- caller should skip resolution; falls back to literal strings.
 */
export function getManifestNamespace(manifest: PluginManifest): string | null {
  const ns = manifest.contributes?.i18n?.namespaces?.[0];
  return typeof ns === 'string' && ns.length > 0 ? ns : null;
}

/**
 * Internal: invoke the translator for one field.
 *
 * Returns `fallback` when (a) no namespace is known for this plugin, (b) the
 * field declares no `*Key`, or (c) the translator returns a non-string or
 * empty string. Defending against empty strings matters because some
 * placeholder pipelines (TICKET_786_5) seed `""` and i18next can return that
 * verbatim when a key resolves to an empty translation node.
 */
function translate(
  t: ManifestTranslator,
  ns: string | null,
  key: string | undefined,
  fallback: string,
): string {
  if (!ns || !key) return fallback;
  const result = t(ns, key, fallback);
  if (typeof result !== 'string' || result.length === 0) return fallback;
  return result;
}

function resolveService(
  svc: ServiceEntitlementDefinition,
  t: ManifestTranslator,
  ns: string | null,
): ServiceEntitlementDefinition {
  return {
    ...svc,
    name: translate(t, ns, svc.nameKey, svc.name),
    description: svc.description !== undefined || svc.descriptionKey
      ? translate(t, ns, svc.descriptionKey, svc.description ?? '')
      : svc.description,
    category: svc.category !== undefined || svc.categoryKey
      ? translate(t, ns, svc.categoryKey, svc.category ?? '')
      : svc.category,
  };
}

function resolveView(
  view: ViewContribution,
  t: ManifestTranslator,
  ns: string | null,
): ViewContribution {
  return {
    ...view,
    name: translate(t, ns, view.nameKey, view.name),
  };
}

function resolveViewContainer(
  item: ViewContainerItem,
  t: ManifestTranslator,
  ns: string | null,
): ViewContainerItem {
  return {
    ...item,
    title: translate(t, ns, item.titleKey, item.title),
  };
}

function resolveEditor(
  ed: EditorContribution,
  t: ManifestTranslator,
  ns: string | null,
): EditorContribution {
  return {
    ...ed,
    displayName: translate(t, ns, ed.displayNameKey, ed.displayName),
  };
}

function resolveCommand(
  cmd: CommandContribution,
  t: ManifestTranslator,
  ns: string | null,
): CommandContribution {
  return {
    ...cmd,
    title: translate(t, ns, cmd.titleKey, cmd.title),
    category: cmd.category !== undefined || cmd.categoryKey
      ? translate(t, ns, cmd.categoryKey, cmd.category ?? '')
      : cmd.category,
  };
}

function resolveConfigProperty(
  prop: ConfigurationProperty,
  t: ManifestTranslator,
  ns: string | null,
): ConfigurationProperty {
  return {
    ...prop,
    description: prop.description !== undefined || prop.descriptionKey
      ? translate(t, ns, prop.descriptionKey, prop.description ?? '')
      : prop.description,
    category: prop.category !== undefined || prop.categoryKey
      ? translate(t, ns, prop.categoryKey, prop.category ?? '')
      : prop.category,
  };
}

function resolveConfiguration(
  cfg: ConfigurationContribution,
  t: ManifestTranslator,
  ns: string | null,
): ConfigurationContribution {
  const properties: Record<string, ConfigurationProperty> = {};
  for (const [propKey, prop] of Object.entries(cfg.properties)) {
    properties[propKey] = resolveConfigProperty(prop, t, ns);
  }
  return {
    ...cfg,
    title: translate(t, ns, cfg.titleKey, cfg.title),
    properties,
  };
}

function resolvePanel<P extends MainViewContribution | SidePanelContribution | BottomPanelContribution>(
  panel: P,
  t: ManifestTranslator,
  ns: string | null,
): P {
  return {
    ...panel,
    title: translate(t, ns, panel.titleKey, panel.title),
  };
}

/**
 * Resolve a manifest's user-visible strings against a translator.
 *
 * Returns a shallow-modified copy; the original manifest is not mutated. Fields
 * without `*Key` siblings (or whose key fails to resolve) keep their literal
 * value, so this function is safe to call on manifests that have not yet been
 * back-filled by Phase 1 sub-phases.
 */
export function resolveManifestI18nWith(
  manifest: PluginManifest,
  t: ManifestTranslator,
): PluginManifest {
  const ns = getManifestNamespace(manifest);
  const contributes = manifest.contributes;

  const resolved: PluginManifest = {
    ...manifest,
    displayName: translate(t, ns, manifest.displayNameKey, manifest.displayName),
    description: manifest.description !== undefined || manifest.descriptionKey
      ? translate(t, ns, manifest.descriptionKey, manifest.description ?? '')
      : manifest.description,
  };

  if (manifest.entitlements?.services) {
    resolved.entitlements = {
      ...manifest.entitlements,
      services: manifest.entitlements.services.map((svc) =>
        resolveService(svc, t, ns),
      ),
    };
  }

  if (contributes) {
    const resolvedContributes = { ...contributes };

    if (contributes.viewsContainers) {
      resolvedContributes.viewsContainers = {
        sidebar: contributes.viewsContainers.sidebar?.map((v) =>
          resolveViewContainer(v, t, ns),
        ),
        activitybar: contributes.viewsContainers.activitybar?.map((v) =>
          resolveViewContainer(v, t, ns),
        ),
      };
    }

    if (contributes.views) {
      const views: Record<string, ViewContribution[]> = {};
      for (const [containerId, viewList] of Object.entries(contributes.views)) {
        views[containerId] = viewList.map((v) => resolveView(v, t, ns));
      }
      resolvedContributes.views = views;
    }

    if (contributes.editors) {
      resolvedContributes.editors = contributes.editors.map((ed) =>
        resolveEditor(ed, t, ns),
      );
    }

    if (contributes.commands) {
      resolvedContributes.commands = contributes.commands.map((cmd) =>
        resolveCommand(cmd, t, ns),
      );
    }

    if (contributes.configuration) {
      resolvedContributes.configuration = resolveConfiguration(
        contributes.configuration,
        t,
        ns,
      );
    }

    if (contributes.mainView) {
      resolvedContributes.mainView = contributes.mainView.map((p) =>
        resolvePanel(p, t, ns),
      );
    }
    if (contributes.sidePanel) {
      resolvedContributes.sidePanel = contributes.sidePanel.map((p) =>
        resolvePanel(p, t, ns),
      );
    }
    if (contributes.bottomPanel) {
      resolvedContributes.bottomPanel = contributes.bottomPanel.map((p) =>
        resolvePanel(p, t, ns),
      );
    }

    resolved.contributes = resolvedContributes;
  }

  return resolved;
}

/**
 * Default-export convenience: resolves against the live `i18next` instance.
 *
 * Use this inside React render bodies that already subscribe to locale changes
 * via `useTranslation()`. The function itself is not a hook; it just reads
 * `i18n.t` at call time, so React's re-render on locale change automatically
 * re-invokes it with fresh values.
 */
export function resolveManifestI18n(manifest: PluginManifest): PluginManifest {
  return resolveManifestI18nWith(manifest, defaultTranslator);
}
