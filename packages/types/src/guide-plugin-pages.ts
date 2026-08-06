/**
 * Guide WebUI pages owned by installed plugins.
 *
 * This is the authoritative cross-surface contract consumed by the MCP guided
 * state builder and every Guide WebUI plugin-navigation surface.
 */
export const GUIDE_PLUGIN_WEBUI_PAGE_BY_ID = {
  'com.stratcraft.back-test-nexus': 'backtest',
  'com.stratcraft.quant-lab-nexus': 'quantlab',
  'com.stratcraft.signal-generator-nexus': 'signal-generator',
} as const;

export type GuidePluginWebuiPage =
  (typeof GUIDE_PLUGIN_WEBUI_PAGE_BY_ID)[keyof typeof GUIDE_PLUGIN_WEBUI_PAGE_BY_ID];

export function getGuidePluginWebuiPage(pluginId: string): GuidePluginWebuiPage | undefined {
  return GUIDE_PLUGIN_WEBUI_PAGE_BY_ID[
    pluginId as keyof typeof GUIDE_PLUGIN_WEBUI_PAGE_BY_ID
  ];
}
