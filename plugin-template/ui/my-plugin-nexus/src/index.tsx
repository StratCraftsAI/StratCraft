import React from 'react';

/**
 * Example panel component.
 * Replace this with your plugin's UI.
 */
const MyPanel: React.FC = () => (
  <div style={{ padding: '16px', color: 'var(--color-text-primary)' }}>
    <h2>Hello from My Plugin</h2>
    <p>This panel is rendered by a third-party StratCraft plugin.</p>
  </div>
);

/**
 * Plugin module - the default export consumed by the StratCraft host.
 *
 * activate() is called when the plugin is enabled.
 * deactivate() is called when the plugin is disabled.
 *
 * The `context` parameter provides:
 *   context.pluginId    - unique plugin identifier
 *   context.pluginPath  - filesystem path to the installed plugin
 *   context.log         - logging (debug/info/warn/error)
 *   context.storage     - key-value persistence
 *   context.commands    - register/execute commands
 *   context.messaging   - inter-plugin messaging
 *   context.state       - shared state management
 *   context.ui          - notification/dialog helpers
 *   context.data        - data access API
 *
 * Additionally, `globalThis.nexus.window` provides:
 *   registerViewProvider()  - register a UI panel
 *   registerTreeDataProvider() - register a tree view
 *   openView() / closeView()  - navigate views
 *   showAlert() / showConfirm() / showNotification() - dialogs
 */
const pluginModule = {
  async activate(context: PluginContext) {
    context.log.info('My Plugin activating...');

    // Register a view panel
    globalThis.nexus!.window.registerViewProvider('my-plugin.panel', {
      render: () => <MyPanel />,
    });

    // Return the PluginApi object
    return {
      activate: async () => {},
      deactivate: async () => {},
    };
  },

  async deactivate() {
    // Cleanup resources (event listeners, timers, etc.)
  },
};

export default pluginModule;
