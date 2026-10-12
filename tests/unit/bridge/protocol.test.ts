/**
 * Extension ↔ app protocol: zod schemas, JSON Schema v1, constants, fixed identifier.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { extensionIdFromPublicKey } from '../../../scripts/gen-extension-key.mjs'
import {
  EXTENSION_ID,
  EXTENSION_KEY,
  EXTENSION_ORIGIN,
  MAX_INLINE_BASE64_CHARS,
  MAX_INLINE_MEDIA_BYTES,
} from '../../../src/shared/bridge/constants'
import { envelope, MESSAGE_TYPES } from '../../../src/shared/bridge/envelope'
import { bridgeJsonSchema } from '../../../src/shared/bridge/json-schema'
import { MESSAGE_SCHEMAS, parseMessage } from '../../../src/shared/bridge/messages'
import { SaveRequest } from '../../../src/shared/bridge/save'

const SCHEMA_FILE = join(import.meta.dirname, '../../../src/shared/bridge/schema/v1.json')
type Def = { required?: string[]; properties?: Record<string, { enum?: string[] }> }

describe('JSON Schema v1', () => {
  const generated = bridgeJsonSchema()
  const defs = generated.$defs as Record<string, Def>

  it('the shipped file is up to date', () => {
    expect(JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'))).toEqual(generated)
  })

  it('SaveRequest: protocol fields and exclusivity', () => {
    const s = defs.SaveRequest as Def & { not?: unknown; additionalProperties?: unknown }
    expect(s.required).toEqual(['kind', 'pageUrl'])
    expect(Object.keys(s.properties ?? {}).sort()).toEqual(
      [
        'kind',
        'pageUrl',
        'pageTitle',
        'srcUrl',
        'linkUrl',
        'inlineMedia',
        'upload',
        'screenshot',
        'pageMeta',
        'post',
        'collectionId',
        'note',
      ].sort(),
    )
    expect(s.properties?.kind?.enum).toEqual(['image', 'video', 'link', 'page', 'post'])
    expect(s.not).toEqual({ required: ['inlineMedia', 'upload'] })
    expect(s.additionalProperties).toBe(false)
  })

  it('SyncRun, SyncPage, SyncAck: required fields and protocol enums', () => {
    expect(defs.SyncRun?.required).toEqual(['runId', 'platform', 'mode', 'trigger', 'maxPages'])
    expect(defs.SyncRun?.properties?.mode?.enum).toEqual(['incremental', 'backfill', 'deep'])
    expect(defs.SyncRun?.properties?.trigger?.enum).toEqual([
      'schedule',
      'hint',
      'manual',
      'toggle',
      'import',
    ])
    expect(defs.SyncPage?.required).toEqual([
      'runId',
      'platform',
      'pageIndex',
      'origin',
      'status',
      'json',
    ])
    expect(defs.SyncPage?.properties?.origin?.enum).toEqual(['intercept', 'replay', 'assist'])
    expect(defs.SyncAck?.required).toEqual(['runId', 'decision'])
    expect(defs.SyncAck?.properties?.decision?.enum).toEqual(['continue', 'stop'])
  })

  it('one payload schema for each message type', () => {
    expect(Object.keys(MESSAGE_SCHEMAS).sort()).toEqual([...MESSAGE_TYPES].sort())
  })
})

describe('extension identifier', () => {
  it('deterministic: 32 letters a–p derived from the public key', () => {
    const der = Buffer.from(EXTENSION_KEY, 'base64')
    expect(extensionIdFromPublicKey(der)).toBe(EXTENSION_ID)
    expect(EXTENSION_ID).toMatch(/^[a-p]{32}$/)
    expect(EXTENSION_ORIGIN).toBe(`chrome-extension://${EXTENSION_ID}/`)
  })
})

describe('SaveRequest', () => {
  const base = { kind: 'image', pageUrl: 'https://example.com/a' }
  it('inlineMedia and upload mutually exclusive', () => {
    expect(
      SaveRequest.safeParse({ ...base, inlineMedia: { mime: 'image/png', dataBase64: 'AA==' } })
        .success,
    ).toBe(true)
    expect(
      SaveRequest.safeParse({
        ...base,
        upload: { id: '0decd148-5f3c-4d7a-9b1e-2a3b4c5d6e7f', mime: 'image/png', size: 1 },
      }).success,
    ).toBe(true)
    expect(
      SaveRequest.safeParse({
        ...base,
        inlineMedia: { mime: 'image/png', dataBase64: 'AA==' },
        upload: { id: '0decd148-5f3c-4d7a-9b1e-2a3b4c5d6e7f', mime: 'image/png', size: 1 },
      }).success,
    ).toBe(false)
  })
  it('inline ≤ 8 MiB of binary', () => {
    expect(MAX_INLINE_BASE64_CHARS).toBe(Math.ceil(MAX_INLINE_MEDIA_BYTES / 3) * 4)
  })
})

describe('parseMessage', () => {
  it('validates envelope and payload', () => {
    const m = envelope('sync.page', {
      runId: 'r1',
      platform: 'x',
      pageIndex: 0,
      origin: 'replay',
      status: 200,
      json: { data: {} },
    })
    const r = parseMessage(m)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.message.type).toBe('sync.page')
  })
  it('rejects an unknown type or an invalid payload without throwing', () => {
    expect(parseMessage(envelope('ping')).ok).toBe(true)
    const bad = { ...envelope('sync.run', { runId: 'r', platform: 'facebook' }) }
    const r = parseMessage(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.id).toBe(bad.id)
    expect(parseMessage({ ...envelope('ping'), type: 'inconnu' }).ok).toBe(false)
  })
  it('never throws on arbitrary input (fast-check)', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        const r = parseMessage(v)
        expect(typeof r.ok).toBe('boolean')
      }),
    )
  })
})
