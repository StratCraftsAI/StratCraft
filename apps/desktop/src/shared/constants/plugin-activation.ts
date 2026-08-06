/**
 * Plugin Activation Events (TICKET_1231, TICKET_1231_1)
 *
 * Vocabulary for the manifest `activationEvents` field. A plugin that does not
 * declare `activationEvents` keeps the legacy behavior: eager activation at
 * boot (equivalent to declaring `["*"]`).
 *
 * Event vocabulary keys off the HOST ViewId (the unit of navigation in
 * VIEW_REGISTRY), not plugin-internal provider ids. The preferred
 * view-triggered form is the bare `onView` token (TICKET_1231_1): the host
 * derives the view set from its own registry, so the manifest never restates
 * a binding it does not own.
 *
 * @see docs/design/TICKET_1231_PLUGIN_LAZY_ACTIVATION_EVENTS.md
 * @see docs/design/TICKET_1231_1_DERIVED_ONVIEW_SINGLE_SOURCE.md
 */

/** Unconditional activation at boot (legacy default; discouraged for new plugins). */
export const ACTIVATION_EVENT_EAGER = '*';

/** Deferred activation after the initial render, off the boot critical path. */
export const ACTIVATION_EVENT_STARTUP_FINISHED = 'onStartupFinished';

/**
 * Bare view-triggered activation (TICKET_1231_1, preferred): activate on
 * first navigation to any view the HOST registers for this plugin. The view
 * set is derived from VIEW_REGISTRY, never declared by the plugin.
 */
export const ACTIVATION_EVENT_ON_VIEW = 'onView';

/** Prefix for explicit view-triggered activation: `onView:<hostViewId>`. */
export const ACTIVATION_EVENT_ON_VIEW_PREFIX = 'onView:';

/**
 * Classification of a plugin's declared activation events into exactly one
 * activation strategy.
 */
export type ActivationStrategy =
  | { kind: 'eager' }
  | { kind: 'startupFinished' }
  | { kind: 'onView'; viewIds: string[] };

/**
 * Resolve the effective activation events for a manifest-like object.
 * Absent or empty `activationEvents` means legacy eager activation.
 */
export function getEffectiveActivationEvents(manifest: { activationEvents?: string[] }): string[] {
  const events = manifest.activationEvents;
  if (!events || events.length === 0) {
    return [ACTIVATION_EVENT_EAGER];
  }
  return events;
}

/**
 * Callbacks and host bindings for classification (TICKET_1231_1).
 */
export interface ClassifyActivationEventsOptions {
  /** An event outside the vocabulary (or unresolvable in this host context). */
  onUnknownEvent?: (event: string) => void;
  /**
   * Host resolver for the bare `onView` token: the view ids the host
   * registers for this plugin (VIEW_REGISTRY is the single owner of that
   * binding). Without a resolver the bare token cannot be honored and is
   * reported through `onUnknownEvent`.
   */
  resolveViewIds?: (pluginId: string) => string[];
  /**
   * Bare `onView` resolved to an empty view set: the plugin declared lazy
   * view-triggered activation but the host registers no view for it -- a
   * dead-lazy manifest error. The caller must surface it (TICKET_858); the
   * classifier falls back to eager so the plugin stays usable (TICKET_856).
   */
  onEmptyDerivedViews?: (pluginId: string) => void;
}

/**
 * Classify declared activation events into one strategy.
 *
 * Precedence: `*` wins over everything (eager), then `onStartupFinished`,
 * then `onView` / `onView:*`. Unrecognized event names are reported via
 * `onUnknownEvent` and -- if no recognized event remains -- the plugin falls
 * back to eager so a typo can never silently disable a plugin (fail-visible,
 * availability-preserving; TICKET_857 / TICKET_858).
 */
export function classifyActivationEvents(
  manifest: { id?: string; activationEvents?: string[] },
  options?: ClassifyActivationEventsOptions,
): ActivationStrategy {
  const events = getEffectiveActivationEvents(manifest);
  const { onUnknownEvent, resolveViewIds, onEmptyDerivedViews } = options ?? {};

  const viewIds: string[] = [];
  let hasEager = false;
  let hasStartupFinished = false;

  for (const event of events) {
    if (event === ACTIVATION_EVENT_EAGER) {
      hasEager = true;
    } else if (event === ACTIVATION_EVENT_STARTUP_FINISHED) {
      hasStartupFinished = true;
    } else if (event === ACTIVATION_EVENT_ON_VIEW) {
      // TICKET_1231_1: derived binding -- the host owns viewId -> pluginId.
      if (!resolveViewIds || manifest.id === undefined) {
        onUnknownEvent?.(event);
        continue;
      }
      const derived = resolveViewIds(manifest.id);
      if (derived.length === 0) {
        onEmptyDerivedViews?.(manifest.id);
        continue;
      }
      viewIds.push(...derived);
    } else if (event.startsWith(ACTIVATION_EVENT_ON_VIEW_PREFIX)) {
      const viewId = event.slice(ACTIVATION_EVENT_ON_VIEW_PREFIX.length);
      if (viewId.length > 0) {
        viewIds.push(viewId);
      } else {
        onUnknownEvent?.(event);
      }
    } else {
      onUnknownEvent?.(event);
    }
  }

  if (hasEager) return { kind: 'eager' };
  if (hasStartupFinished) return { kind: 'startupFinished' };
  if (viewIds.length > 0) return { kind: 'onView', viewIds };

  // Only unrecognized events were declared: fall back to eager, never to dead.
  return { kind: 'eager' };
}
