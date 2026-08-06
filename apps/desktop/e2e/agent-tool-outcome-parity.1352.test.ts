import { expect, test } from '@playwright/test';
import { localizeAgentOutcome } from '../../web-dashboard/src/components/MessageBubble';
import {
  projectAgentRuntimeToolOutcome,
  projectAgentToolOutcome,
} from '../src/mcp/standalone/src/agent/tool-outcome-projection';

const translations: Record<string, string> = {
  'agentOutcome.permissionExpired': 'Approval expired. The operation was not executed.',
  'agentOutcome.retryRequest': 'Submit the request again to retry.',
};

const translate = (key: string): string => translations[key] ?? key;

test('guide_and_electron_render_equivalent_outcomes_from_one_contract', () => {
  const rawResult = '{"code":"permission_expired","error":"private transport prose"}';
  const guideOutcome = projectAgentToolOutcome({
    content: [{ type: 'text', text: rawResult }],
    isError: true,
  }, { executionState: 'not_executed' });
  const electronOutcome = projectAgentRuntimeToolOutcome({
    succeeded: false,
    rawResult,
    executionState: 'not_executed',
  });

  expect(electronOutcome).toEqual(guideOutcome);
  const guideText = localizeAgentOutcome(translate, guideOutcome);
  const electronText = localizeAgentOutcome(translate, electronOutcome);
  expect(electronText).toBe(guideText);
  expect(guideText).toBe(
    'Approval expired. The operation was not executed. Submit the request again to retry.',
  );
  expect(guideText).not.toContain('{');
  expect(guideText).not.toContain('private transport prose');
});
