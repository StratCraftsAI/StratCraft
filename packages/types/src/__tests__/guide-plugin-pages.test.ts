import { describe, expect, it } from 'vitest';
import {
  GUIDE_PLUGIN_WEBUI_PAGE_BY_ID,
  getGuidePluginWebuiPage,
} from '../guide-plugin-pages';

describe('Guide plugin WebUI page contract', () => {
  it('maps every implemented plugin-backed Guide page', () => {
    expect(GUIDE_PLUGIN_WEBUI_PAGE_BY_ID).toEqual({
      'com.stratcraft.back-test-nexus': 'backtest',
      'com.stratcraft.quant-lab-nexus': 'quantlab',
      'com.stratcraft.signal-generator-nexus': 'signal-generator',
    });
  });

  it('returns undefined for plugins without an implemented Guide page', () => {
    expect(getGuidePluginWebuiPage('com.stratcraft.strategy-builder-nexus')).toBeUndefined();
    expect(getGuidePluginWebuiPage('third.party.plugin')).toBeUndefined();
  });
});
