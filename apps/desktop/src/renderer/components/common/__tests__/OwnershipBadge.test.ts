/**
 * OwnershipBadge Component Unit Tests
 *
 * TICKET_892_4 Step 5: Tests for simplified ownership badge.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('lucide-react', () => ({
  CheckCircle: ({ className }: { className: string }) => `<CheckCircle class="${className}" />`,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key === 'entitlement.ownership.badge.owned' ? 'OWNED' : key,
  }),
}));

vi.mock('react', () => {
  const createElement = (type: any, props: any, ...children: any[]) => {
    return { type, props: { ...props, children: children.length <= 1 ? children[0] : children } };
  };
  return {
    default: { createElement },
    createElement,
  };
});

describe('OwnershipBadge', () => {
  it('renders OWNED badge when owned=true', async () => {
    const { OwnershipBadge } = await import('../OwnershipBadge');
    const result = OwnershipBadge({ owned: true });
    expect(result).not.toBeNull();

    function findText(el: any): string[] {
      const texts: string[] = [];
      if (typeof el === 'string') { texts.push(el); return texts; }
      if (!el || typeof el !== 'object') return texts;
      if (el.props?.children) {
        const children = Array.isArray(el.props.children) ? el.props.children : [el.props.children];
        children.forEach((c: any) => texts.push(...findText(c)));
      }
      return texts;
    }
    const textContent = findText(result).join(' ');
    expect(textContent).toContain('OWNED');
  });

  it('renders null when owned=false', async () => {
    const { OwnershipBadge } = await import('../OwnershipBadge');
    const result = OwnershipBadge({ owned: false });
    expect(result).toBeNull();
  });

  it('applies green palette class', async () => {
    const { OwnershipBadge } = await import('../OwnershipBadge');
    const result = OwnershipBadge({ owned: true }) as any;
    expect(result).not.toBeNull();
    expect(result.props.className).toContain('bg-green-600/20');
    expect(result.props.className).toContain('text-green-400');
  });

  it('applies custom className', async () => {
    const { OwnershipBadge } = await import('../OwnershipBadge');
    const result = OwnershipBadge({ owned: true, className: 'ml-2' }) as any;
    expect(result).not.toBeNull();
    expect(result.props.className).toContain('ml-2');
  });
});
