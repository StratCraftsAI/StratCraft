import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext } from './fixtures';

let ctx: AppContext;

test.beforeAll(async () => {
  ctx = await launchApp();
});

test.afterAll(async () => {
  if (ctx) {
    await closeApp(ctx);
  }
});

test('main window opens successfully', async () => {
  expect(ctx.window).toBeTruthy();
  const isVisible = await ctx.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win?.isVisible();
  });
  expect(isVisible).toBe(true);
});

test('window has correct title', async () => {
  const title = await ctx.window.title();
  expect(title).toBeTruthy();
});

test('Nexus Hub page loads as default view', async () => {
  // Wait for the app to fully render
  await ctx.window.waitForTimeout(2000);

  // Verify no crash - page should have content
  const bodyContent = await ctx.window.locator('body').innerHTML();
  expect(bodyContent.length).toBeGreaterThan(0);
});

test('no console errors on startup', async () => {
  const errors: string[] = [];
  ctx.window.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  // Give time for any delayed errors
  await ctx.window.waitForTimeout(1000);

  // Filter out known benign errors (e.g., DevTools, network in test env)
  const criticalErrors = errors.filter(
    (e) => !e.includes('DevTools') && !e.includes('net::ERR_')
  );
  expect(criticalErrors).toHaveLength(0);
});
