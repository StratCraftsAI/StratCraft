import React from 'react';

/**
 * A simple panel that displays a greeting message.
 * Demonstrates the minimal structure for a StratCraft plugin ViewProvider.
 */
const MinimalPanel: React.FC = () => {
  const [count, setCount] = React.useState(0);

  return (
    <div style={{ padding: '24px', color: 'var(--color-text-primary)' }}>
      <h2>Minimal Plugin</h2>
      <p>This is a working example of a StratCraft plugin.</p>
      <button
        onClick={() => setCount((c) => c + 1)}
        style={{
          marginTop: '12px',
          padding: '8px 16px',
          background: 'var(--color-terminal-accent-primary)',
          color: 'var(--color-text-primary)',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        Clicked {count} times
      </button>
    </div>
  );
};

const pluginModule = {
  activate(context: any) {
    globalThis.nexus.window.registerViewProvider('minimal-plugin.panel', {
      render: () => <MinimalPanel />,
    });

    return { success: true, capabilities: {} };
  },

  deactivate() {
    // Cleanup resources here
  },
};

export default pluginModule;
