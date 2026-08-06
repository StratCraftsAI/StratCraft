/**
 * LockedPagePlaceholder Component Unit Tests
 *
 * TICKET_892_4 Step 5: Tests for simplified component (no buyout props).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('lucide-react', () => ({
  Lock: ({ className }: { className: string }) => `<Lock class="${className}" />`,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../TierBadge', () => ({
  default: ({ tier }: { tier: string }) => `<TierBadge tier="${tier}" />`,
  TierBadge: ({ tier }: { tier: string }) => `<TierBadge tier="${tier}" />`,
}));

let lastRenderedElement: any = null;

vi.mock('react', () => {
  const createElement = (type: any, props: any, ...children: any[]) => {
    const el = { type, props: { ...props, children: children.length <= 1 ? children[0] : children } };
    lastRenderedElement = el;
    return el;
  };
  return {
    default: { createElement },
    createElement,
  };
});

function setupElectronAPI() {
  (globalThis as any).window = {
    electronAPI: {
      shell: { openExternal: vi.fn() },
    },
  };
}

function findButtons(element: any): any[] {
  const buttons: any[] = [];
  function walk(el: any) {
    if (!el || typeof el !== 'object') return;
    if (el.type === 'button' && el.props) {
      buttons.push(el);
    }
    if (el.props?.children) {
      const children = Array.isArray(el.props.children) ? el.props.children : [el.props.children];
      children.forEach(walk);
    }
  }
  walk(element);
  return buttons;
}

describe('LockedPagePlaceholder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupElectronAPI();
    lastRenderedElement = null;
  });

  it('renders Sign Up Free button when onLogin is provided', async () => {
    const onLogin = vi.fn();
    const { LockedPagePlaceholder } = await import('../LockedPagePlaceholder');
    const result = LockedPagePlaceholder({
      serviceName: 'Kronos Predictor',
      tier: 'pro',
      onLogin,
    });
    const buttons = findButtons(result);
    const signUpButton = buttons.find((b: any) => {
      const children = Array.isArray(b.props.children) ? b.props.children : [b.props.children];
      return children.some((c: any) => typeof c === 'string' && c.includes('auth.signUpFree'));
    });
    expect(signUpButton).toBeDefined();
  });

  it('renders View Plans button', async () => {
    const { LockedPagePlaceholder } = await import('../LockedPagePlaceholder');
    const result = LockedPagePlaceholder({
      serviceName: 'Kronos Predictor',
      tier: 'pro',
    });
    const buttons = findButtons(result);
    const viewPlansButton = buttons.find((b: any) => {
      const children = Array.isArray(b.props.children) ? b.props.children : [b.props.children];
      return children.some((c: any) => typeof c === 'string' && c.includes('auth.viewPlans'));
    });
    expect(viewPlansButton).toBeDefined();
  });

  it('does not render Buy Once button (removed in TICKET_892_4)', async () => {
    const { LockedPagePlaceholder } = await import('../LockedPagePlaceholder');
    const result = LockedPagePlaceholder({
      serviceName: 'Test',
      tier: 'pro',
    });
    const buttons = findButtons(result);
    const buyButton = buttons.find((b: any) => {
      const children = Array.isArray(b.props.children) ? b.props.children : [b.props.children];
      return children.some((c: any) => typeof c === 'string' && c.includes('Buy Once'));
    });
    expect(buyButton).toBeUndefined();
  });

  it('calls onLogin when Sign Up Free button is clicked', async () => {
    const onLogin = vi.fn();
    const { LockedPagePlaceholder } = await import('../LockedPagePlaceholder');
    const result = LockedPagePlaceholder({
      serviceName: 'Test',
      tier: 'pro',
      onLogin,
    });
    const buttons = findButtons(result);
    const signUpButton = buttons.find((b: any) => {
      const children = Array.isArray(b.props.children) ? b.props.children : [b.props.children];
      return children.some((c: any) => typeof c === 'string' && c.includes('auth.signUpFree'));
    });
    expect(signUpButton).toBeDefined();
    signUpButton.props.onClick();
    expect(onLogin).toHaveBeenCalledOnce();
  });
});
