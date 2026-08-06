/**
 * TICKET_1335_1 AC1 / AC2 / AC11: live verification in a real Electron window.
 *
 * These three criteria were left UNCHECKED by Phases 1-5 for one reason: no
 * node-environment test can prove that the markup carrying a name reaches the
 * accessibility tree, that a focus ring is VISIBLE rather than merely declared,
 * or that a click on a real rail button changes the real active view. Every
 * assertion below is therefore made against a rendered window -- computed
 * styles, the Chromium accessibility snapshot, and real keyboard input.
 *
 * What this file does NOT claim to discharge: Orca reading the page aloud. The
 * Chromium a11y snapshot proves the name/role/state a screen reader would be
 * handed by AT-SPI; it does not prove Orca's own speech. That distinction is
 * recorded in the ticket rather than papered over here.
 */

import { expect, test } from '@playwright/test';
import { closeApp, launchApp, type AppContext } from './fixtures';

const RAIL_RESEARCH = '[data-onboarding="sidebar-research-environment"]';
const RAIL_SETTINGS = '[data-onboarding="sidebar-settings"]';

/** Minimum and narrow supported window sizes named by verification step 8. */
const WINDOW_SIZES = [
  { label: 'minimum', width: 1024, height: 768 },
  { label: 'narrow', width: 1280, height: 800 },
];

/**
 * Relative luminance and contrast ratio per WCAG 2.1. AC11 requires the focus
 * indicator to MEET the contrast contract, and "meet" is a number, not an
 * opinion -- so it gets computed rather than eyeballed.
 */
function luminance(r: number, g: number, b: number): number {
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(...a);
  const lb = luminance(...b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function parseRgb(value: string): [number, number, number] | null {
  const m = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

let ctx: AppContext;

test.beforeAll(async () => {
  ctx = await launchApp();

  /**
   * The privacy consent modal is a first-run overlay that intercepts pointer
   * events across the whole window, so a rail click lands on the backdrop and
   * times out rather than navigating.
   *
   * `launchApp` already tries to dismiss it, but with a 2s probe that loses the
   * race on a cold start -- the modal renders after the shared fixture has
   * stopped looking. This waits properly instead of widening the shared
   * fixture's timeout, which would slow every other E2E suite for a problem
   * only a first-run window has (TICKET_853).
   */
  // Wait on the OVERLAY, not on the button label. `isVisible()` resolves
  // false immediately when the modal has not mounted yet, so a label probe
  // silently no-ops on a cold start -- which is exactly how this was missed.
  // The overlay is also locale-independent; the button text is translated.
  const overlay = ctx.window.locator('div.fixed.inset-0.z-50').first();
  await overlay.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => undefined);

  if (await overlay.isVisible().catch(() => false)) {
    await ctx.window
      .getByRole('button', { name: /no thanks/i })
      .click({ timeout: 15_000 });
    await overlay.waitFor({ state: 'detached', timeout: 15_000 });
  }
});

test.afterAll(async () => {
  /**
   * Teardown, not verification -- but it needs its own budget.
   *
   * This page deliberately leaves a module-scoped poll timer running so a job
   * survives the page unmounting (AC6), so the renderer does not go idle just
   * because the last test finished. `closeApp` already falls back to SIGKILL;
   * the default 60s hook timeout was firing BEFORE that fallback could run and
   * reporting it as a failure of the last test, whose own assertions had all
   * passed. Giving teardown room turns a misattributed red into an honest one.
   */
  test.setTimeout(180_000);
  if (ctx) await closeApp(ctx);
});

/**
 * Put the app on the Research Environment view, from wherever it currently is.
 *
 * Each test states its own precondition rather than inheriting one from the
 * test before it. Playwright starts a FRESH WORKER after a failure, so a suite
 * that navigates once and assumes it stays there reports every later test as a
 * failure the moment any earlier one fails -- which is a false signal about the
 * page, not a finding.
 */
async function gotoResearchEnvironment(): Promise<void> {
  const { window } = ctx;
  await window.setViewportSize({ width: 1280, height: 800 });

  const summary = window.getByTestId('environment-summary');
  if (await summary.isVisible().catch(() => false)) return;

  await window.locator(RAIL_RESEARCH).click({ timeout: 30_000 });
  await expect(summary).toBeVisible({ timeout: 30_000 });
}

test.describe('TICKET_1335_1 AC1/AC2/AC11 live verification', () => {
  test('AC1: Research Environment sits directly above System Settings at every supported size', async () => {
    const { window } = ctx;

    for (const size of WINDOW_SIZES) {
      await window.setViewportSize({ width: size.width, height: size.height });

      const research = window.locator(RAIL_RESEARCH);
      const settings = window.locator(RAIL_SETTINGS);

      await expect(research, `research rail button visible at ${size.label}`).toBeVisible();
      await expect(settings, `settings rail button visible at ${size.label}`).toBeVisible();

      const researchBox = await research.boundingBox();
      const settingsBox = await settings.boundingBox();
      expect(researchBox, `research box at ${size.label}`).not.toBeNull();
      expect(settingsBox, `settings box at ${size.label}`).not.toBeNull();

      // "Directly above" is two claims: above, and with nothing between them.
      expect(
        researchBox!.y + researchBox!.height,
        `research bottom is above settings top at ${size.label}`,
      ).toBeLessThanOrEqual(settingsBox!.y + 1);

      const gap = settingsBox!.y - (researchBox!.y + researchBox!.height);
      expect(gap, `no element fits between the two entries at ${size.label}`).toBeLessThan(
        researchBox!.height,
      );

      // Both live in the bottom zone of the rail, not among the nav items.
      const railHeight = size.height;
      expect(
        researchBox!.y,
        `research entry is in the bottom half of the rail at ${size.label}`,
      ).toBeGreaterThan(railHeight / 2);
    }
  });

  test('AC2: selecting the entry navigates through the registry and highlights only that entry', async () => {
    const { window } = ctx;
    await window.setViewportSize({ width: 1280, height: 800 });

    const research = window.locator(RAIL_RESEARCH);
    const settings = window.locator(RAIL_SETTINGS);

    await research.click();

    // The canonical registry component actually mounted -- not merely a
    // highlight change. The summary region is owned by this view alone.
    await expect(window.getByTestId('environment-summary')).toBeVisible({ timeout: 20_000 });

    // Mutually exclusive active state, read from the accessibility property
    // that conveys it, not from a CSS class.
    await expect(research).toHaveAttribute('aria-current', 'page');
    expect(await settings.getAttribute('aria-current')).toBeNull();

    // ... and the reverse direction, which is the half AC2 says must also hold.
    await settings.click();
    await expect(settings).toHaveAttribute('aria-current', 'page');
    expect(await research.getAttribute('aria-current')).toBeNull();
    await expect(window.getByTestId('environment-summary')).toHaveCount(0);

    // Return to the view under test for the AC11 checks.
    await research.click();
    await expect(window.getByTestId('environment-summary')).toBeVisible({ timeout: 20_000 });
  });

  test('AC11: both rail entries expose an accessible name and role to the a11y tree', async () => {
    const { window } = ctx;

    // getByRole resolves through the accessibility tree, so a name that never
    // reaches AT-SPI cannot satisfy this.
    await expect(
      window.getByRole('button', { name: 'Research Environment', exact: true }),
    ).toBeVisible();
    await expect(
      window.getByRole('button', { name: 'System Settings', exact: true }),
    ).toBeVisible();
  });

  test('AC11: every tab stop on the page shows a VISIBLE focus indicator', async () => {
    const { window } = ctx;
    await gotoResearchEnvironment();

    const researchButton = window.getByRole('button', {
      name: 'Research Environment',
      exact: true,
    });
    await researchButton.focus();

    const visited: string[] = [];
    const missingIndicator: string[] = [];
    const foreignMissingIndicator: string[] = [];

    // Walk forward through the page's focusable elements. 25 is a ceiling, not
    // an expectation -- the loop exits when focus wraps back to the start.
    for (let step = 0; step < 25; step += 1) {
      const probe = await window.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;

        const style = window.getComputedStyle(el);
        const describe =
          el.getAttribute('data-testid') ||
          el.getAttribute('data-onboarding') ||
          el.getAttribute('aria-label') ||
          `${el.tagName.toLowerCase()}`;

        /**
         * Does this element belong to TICKET_1335_1?
         *
         * The tab order is global, so the walk can reach host chrome this
         * ticket does not own -- a modal Close button, a header control. Those
         * are reported separately rather than asserted on: fixing them here
         * would be an unrelated change (TICKET_853), and asserting on them
         * would make this suite red for a defect in someone else's component.
         */
        const owned =
          el.closest('[data-onboarding="sidebar-research-environment"]') !== null ||
          el.closest('[data-onboarding="sidebar-settings"]') !== null ||
          el.closest('[data-testid="environment-summary"]') !== null ||
          el.closest('[data-testid="environment-job-progress"]') !== null ||
          el.closest('[data-testid="environment-failure-panel"]') !== null ||
          /^research-capability-card-/.test(describe) ||
          el.closest('[data-testid^="research-capability-card-"]') !== null;

        // An indicator is real if it paints: a non-zero outline, a box-shadow
        // ring, or a border/background that changes under :focus-visible.
        const outlineWidth = parseFloat(style.outlineWidth) || 0;
        const hasOutline = outlineWidth > 0 && style.outlineStyle !== 'none';
        const hasShadowRing = style.boxShadow !== 'none' && style.boxShadow !== '';

        return {
          describe,
          owned,
          tag: el.tagName.toLowerCase(),
          hasOutline,
          hasShadowRing,
          outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
          boxShadow: style.boxShadow,
          matchesFocusVisible: el.matches(':focus-visible'),
        };
      });

      if (!probe) break;

      if (visited.includes(probe.describe) && step > 0) break;
      visited.push(probe.describe);

      if (!probe.hasOutline && !probe.hasShadowRing) {
        const report =
          `${probe.describe} (${probe.tag}) outline="${probe.outline}" ` +
          `boxShadow="${probe.boxShadow}" :focus-visible=${probe.matchesFocusVisible}`;
        (probe.owned ? missingIndicator : foreignMissingIndicator).push(report);
      }

      await window.keyboard.press('Tab');
    }

    expect(visited.length, 'keyboard reached at least one focusable element').toBeGreaterThan(0);
    expect(
      missingIndicator,
      `TICKET_1335_1-owned tab stops with NO visible focus indicator:\n${missingIndicator.join('\n')}`,
    ).toEqual([]);

    // Not an assertion: host chrome outside this ticket's scope. Surfaced so a
    // real gap is recorded rather than silently swallowed by the scope filter.
    if (foreignMissingIndicator.length > 0) {
      console.warn(
        'Focus indicators missing on elements OUTSIDE TICKET_1335_1 scope ' +
          `(not fixed here per TICKET_853):\n${foreignMissingIndicator.join('\n')}`,
      );
    }
  });

  test('AC11: the focus ring meets the 3:1 non-text contrast contract', async () => {
    const { window } = ctx;
    await gotoResearchEnvironment();

    // The primary action carries the declared focus-visible ring. Its measured
    // contrast against the surface it paints on is the number AC11 needs.
    const action = window.getByTestId('environment-primary-action');
    if ((await action.count()) === 0) {
      test.skip(true, 'primary action not rendered in this environment state');
    }

    await action.focus();

    const measured = await action.evaluate((el) => {
      const style = window.getComputedStyle(el);

      // Walk up for the first non-transparent painted background, which is what
      // the ring is actually seen against.
      let node: HTMLElement | null = el.parentElement;
      let surface = 'rgb(255, 255, 255)';
      while (node) {
        const bg = window.getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          surface = bg;
          break;
        }
        node = node.parentElement;
      }

      return {
        boxShadow: style.boxShadow,
        outlineColor: style.outlineColor,
        outlineWidth: style.outlineWidth,
        surface,
        matchesFocusVisible: el.matches(':focus-visible'),
      };
    });

    expect(
      measured.matchesFocusVisible,
      'keyboard focus put the element into :focus-visible',
    ).toBe(true);

    // Extract the ring colour from whichever property paints it.
    const ringSource = measured.boxShadow !== 'none' ? measured.boxShadow : measured.outlineColor;
    const ring = parseRgb(ringSource);
    const surface = parseRgb(measured.surface);

    expect(ring, `could not parse a ring colour from "${ringSource}"`).not.toBeNull();
    expect(surface, `could not parse surface "${measured.surface}"`).not.toBeNull();

    const ratio = contrastRatio(ring!, surface!);
    expect(
      ratio,
      `focus ring ${ringSource} on ${measured.surface} measured ${ratio.toFixed(2)}:1, ` +
        'WCAG 2.1 SC 1.4.11 requires >= 3:1',
    ).toBeGreaterThanOrEqual(3);
  });

  test('AC11: badge subjects and the PySR two-layer split carry their own names (D8c)', async () => {
    const { window } = ctx;
    await gotoResearchEnvironment();

    // D8c: read the element's text aloud on its own; if it does not say what it
    // is describing, it needs an accessible name. The environment badge and the
    // capability badges are the elements that rule was written for.
    const environmentState = window.getByTestId('environment-state');
    if ((await environmentState.count()) > 0) {
      const name = await environmentState.getAttribute('aria-label');
      expect(name, 'environment badge names its subject').toBeTruthy();
      expect(name!.toLowerCase()).toContain('environment state');
    }

    const pysrLayers = window.getByTestId('pysr-layers');
    if ((await pysrLayers.count()) > 0) {
      // Both layers must be independently announced -- AC8's claim is that
      // Python readiness and Julia readiness are separately legible, and an
      // unnamed badge collapses them for a screen-reader user.
      for (const layer of ['python', 'julia']) {
        const el = window.getByTestId(`pysr-layer-${layer}`);
        if ((await el.count()) === 0) continue;
        const text = await el.innerText();
        expect(text.trim().length, `pysr ${layer} layer is not empty`).toBeGreaterThan(0);
      }
    }
  });

  test('AC11: the page-level live region exists and is polite/atomic (D8a)', async () => {
    const { window } = ctx;
    await gotoResearchEnvironment();

    const region = window.getByTestId('environment-live-region');
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toHaveAttribute('aria-atomic', 'true');
  });
});
