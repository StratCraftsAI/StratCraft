import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestJson from '../../electron-capability-manifest.json';
import { extractElectronCapabilitySources } from './support/electron-capability-source';

const desktopRoot = path.resolve(__dirname, '../../../../../..');
const source = extractElectronCapabilitySources(desktopRoot);
const manifest = manifestJson as {
  capabilities: Array<{
    id: string;
    classification: string;
    mcpTools: string[];
    targetMcpTools?: string[];
  }>;
};

describe('TICKET_1302 U7 parity closure', () => {
  it('ratifies exactly the seven registered typed contracts on the four U7 rows', () => {
    const expected = new Map([
      ['st7', ['get_credit_status', 'get_rate_limit_status', 'get_distribution_info']],
      ['st10', ['get_consent_status', 'set_consent']],
      ['st11', ['get_server_status']],
      ['st12', ['get_app_info']],
    ]);
    const registered = new Set(source.mcpTools);

    for (const [id, tools] of expected) {
      const capability = manifest.capabilities.find((row) => row.id === id);
      expect(capability?.classification).toBe('covered-user-capability');
      expect(capability?.mcpTools).toEqual(tools);
      expect(capability?.targetMcpTools).toBeUndefined();
      expect(tools.every((tool) => registered.has(tool))).toBe(true);
    }
  });
});
