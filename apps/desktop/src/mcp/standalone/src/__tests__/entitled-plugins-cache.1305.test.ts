/**
 * TICKET_1305 -- readEntitledPluginsCache unit tests.
 *
 * Reads the SAME shared config.json Electron's EntitlementSyncService writes
 * (keys entitlement_entitled_plugins_cache + _ts) and returns a
 * pluginId -> tier map, respecting the 7-day offline-grace TTL (AC8). No secure
 * store, no bridge -- only STRATCRAFT_MCP_USERDATA_DIR + a plain config.json.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { readEntitledPluginsCache } from '../mcp-secure-credentials'

const tmpDirs: string[] = []

function writeConfig(userData: string, config: Record<string, unknown>): void {
  writeFileSync(path.join(userData, 'config.json'), JSON.stringify(config))
}

describe('TICKET_1305: readEntitledPluginsCache', () => {
  let userData: string

  beforeEach(() => {
    userData = mkdtempSync(path.join(os.tmpdir(), 'mcp-entitled-cache-'))
    tmpDirs.push(userData)
    process.env.STRATCRAFT_MCP_USERDATA_DIR = userData
  })

  afterAll(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
    delete process.env.STRATCRAFT_MCP_USERDATA_DIR
  })

  it('returns {} when config.json is missing', () => {
    expect(readEntitledPluginsCache()).toEqual({})
  })

  it('returns {} when the cache key is absent', () => {
    writeConfig(userData, { 'user': { locale: 'en_US' } })
    expect(readEntitledPluginsCache()).toEqual({})
  })

  it('maps plugin_id -> tier from a fresh cache', () => {
    writeConfig(userData, {
      entitlement_entitled_plugins_cache: [
        { plugin_id: 'plugin.a', tier: 'pro' },
        { plugin_id: 'plugin.b', tier: 'gold' },
      ],
      entitlement_entitled_plugins_cache_ts: Date.now(),
    })
    expect(readEntitledPluginsCache()).toEqual({ 'plugin.a': 'pro', 'plugin.b': 'gold' })
  })

  it('AC8: returns {} when the cache timestamp is older than 7 days', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
    writeConfig(userData, {
      entitlement_entitled_plugins_cache: [{ plugin_id: 'plugin.a', tier: 'pro' }],
      entitlement_entitled_plugins_cache_ts: eightDaysAgo,
    })
    expect(readEntitledPluginsCache()).toEqual({})
  })

  it('keeps a cache exactly at the 7-day boundary (not yet expired)', () => {
    const almostSevenDays = Date.now() - (7 * 24 * 60 * 60 * 1000 - 1000)
    writeConfig(userData, {
      entitlement_entitled_plugins_cache: [{ plugin_id: 'plugin.a', tier: 'pro' }],
      entitlement_entitled_plugins_cache_ts: almostSevenDays,
    })
    expect(readEntitledPluginsCache()).toEqual({ 'plugin.a': 'pro' })
  })

  it('skips malformed entries (missing plugin_id or tier)', () => {
    writeConfig(userData, {
      entitlement_entitled_plugins_cache: [
        { plugin_id: 'plugin.a', tier: 'pro' },
        { plugin_id: 'plugin.b' },
        { tier: 'gold' },
        null,
        'nonsense',
      ],
      entitlement_entitled_plugins_cache_ts: Date.now(),
    })
    expect(readEntitledPluginsCache()).toEqual({ 'plugin.a': 'pro' })
  })

  it('returns {} when the cache value is not an array', () => {
    writeConfig(userData, {
      entitlement_entitled_plugins_cache: { plugin_id: 'plugin.a', tier: 'pro' },
      entitlement_entitled_plugins_cache_ts: Date.now(),
    })
    expect(readEntitledPluginsCache()).toEqual({})
  })
})
