/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/renderer/**/*.{ts,tsx,html}',
    '../../plugins/*/ui/src/**/*.{ts,tsx}',
    '../../plugins/*/ui/*/src/**/*.{ts,tsx}',
    // TICKET_077_27: strategy-builder-nexus authors the TICKET_077 common
    // component library at plugins/strategy-builder-nexus/src/components/ui
    // (the plugins/*/src/** layout, not plugins/*/ui/**). The globs above
    // never scanned it, so arbitrary-value JIT classes unique to those
    // components (CollapsiblePanel's grid-rows-[0fr]/transition-[grid-template-rows],
    // hover:bg-white/[0.02]) were never generated -- any plugin that imports
    // a 077 component (quant-lab-nexus, which ships no CSS of its own) rendered
    // it with a dead collapse animation / hover. Scanning plugins/*/src/**
    // generates the missing classes into host.css.
    '../../plugins/*/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Quant platform color palette
        profit: {
          DEFAULT: '#22c55e',
          dark: '#16a34a',
        },
        loss: {
          DEFAULT: '#ef4444',
          dark: '#dc2626',
        },
        // Terminal Theme Colors
        'color-terminal': {
          bg: 'var(--color-terminal-bg)',
          panel: 'var(--color-terminal-panel)',
          surface: 'var(--color-terminal-surface)',
          border: 'var(--color-terminal-border)',
          text: 'var(--color-terminal-text)',
          'text-primary': 'var(--color-terminal-text-primary)',
          'text-secondary': 'var(--color-terminal-text-secondary)',
          'text-muted': 'var(--color-terminal-text-muted)',
          'accent-primary': 'var(--color-terminal-accent-primary)',
          'accent-gold': 'var(--color-terminal-accent-gold)', // Alias for accent-primary
          'accent-teal': 'var(--color-terminal-accent-teal)',
          'accent-red': 'var(--color-terminal-accent-red)',
        },
        // Workflow Role Colors (backtest pipeline stages)
        'color-workflow': {
          purple: 'var(--color-workflow-purple)',
          blue: 'var(--color-workflow-blue)',
          gold: 'var(--color-workflow-gold)',
        },
        // Shadcn/ui variables
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['12px', { lineHeight: '18px' }],
        base: ['12px', { lineHeight: '20px' }],
        lg: ['14px', { lineHeight: '22px' }],
        xl: ['18px', { lineHeight: '26px' }],
        '2xl': ['24px', { lineHeight: '32px' }],
        '3xl': ['32px', { lineHeight: '40px' }],
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
