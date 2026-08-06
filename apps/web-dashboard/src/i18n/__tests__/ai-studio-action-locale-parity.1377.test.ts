import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * TICKET_1377 AC4: every locale bundle must expose the identical
 * `agentChat.aiStudioAction` key set.
 *
 * TICKET_1375 shipped the card with twelve `t()` call sites and zero locale
 * entries in all 12 bundles, so the UI rendered bare keys such as
 * `agentChat.aiStudioAction.eyebrow`. Nothing in the suite could observe that,
 * because the component test mocked `t()` to echo its key. This test reads the
 * bundles off disk so a missing key is a failure, not a rendered key name.
 */
const LOCALES = [
  'de_DE', 'en_US', 'es_ES', 'fr_FR', 'it_IT', 'ja_JP',
  'ko_KR', 'pt_PT', 'ru_RU', 'tr_TR', 'zh_CN', 'zh_TW',
] as const

/** Every key the card resolves (AIStudioActionCard.tsx). */
const REQUIRED_KEYS = [
  'eyebrow',
  'titleGenerate',
  'titleSave',
  'review',
  'dispatched',
  'strategyRules',
  'entryConditions',
  'exitConditions',
  'indicators',
  'noRules',
  'generate',
  'save',
] as const

function loadAiStudioAction(locale: string): Record<string, unknown> {
  const path = join(__dirname, '..', 'locales', locale, 'dashboard.json')
  const bundle = JSON.parse(readFileSync(path, 'utf-8')) as {
    agentChat?: { aiStudioAction?: Record<string, unknown> }
  }
  const subtree = bundle.agentChat?.aiStudioAction
  expect(subtree, `${locale}: agentChat.aiStudioAction is absent`).toBeDefined()
  return subtree as Record<string, unknown>
}

describe('TICKET_1377 AC4: agentChat.aiStudioAction locale parity', () => {
  it.each(LOCALES)('%s defines every required key as a non-empty string', (locale) => {
    const subtree = loadAiStudioAction(locale)
    for (const key of REQUIRED_KEYS) {
      const value = subtree[key]
      expect(typeof value, `${locale}: ${key} must be a string`).toBe('string')
      expect((value as string).trim(), `${locale}: ${key} must not be empty`).not.toBe('')
    }
  })

  it('all 12 locales expose exactly the same key set', () => {
    const reference = Object.keys(loadAiStudioAction('en_US')).sort()
    expect(reference).toEqual([...REQUIRED_KEYS].sort())

    for (const locale of LOCALES) {
      expect(Object.keys(loadAiStudioAction(locale)).sort(), `${locale} key set drift`)
        .toEqual(reference)
    }
  })

  it('carries no leftover key-shaped placeholder values', () => {
    for (const locale of LOCALES) {
      const subtree = loadAiStudioAction(locale)
      for (const [key, value] of Object.entries(subtree)) {
        expect(value as string, `${locale}: ${key} echoes its own key`)
          .not.toContain('agentChat.aiStudioAction')
      }
    }
  })
})
