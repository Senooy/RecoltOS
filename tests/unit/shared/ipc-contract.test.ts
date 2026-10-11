import { describe, expect, expectTypeOf, it } from 'vitest'
import { EVENT_PREFIX, PRELOAD_ARG, RAW_CHANNELS } from '../../../src/shared/ipc/channels'
import { EVENT_NAME_LIST } from '../../../src/shared/ipc/event-names'
import {
  CHANNELS,
  DOMAINS,
  EVENT_NAMES,
  contract,
  contractsByDomain,
  domainOf,
  isChannel,
  type In,
  type Out,
  type Parsed,
} from '../../../src/shared/ipc'
import { MENU_COMMANDS, SHORTCUTS } from '../../../src/shared/shortcuts'

const U = '0decd148-5f3c-4d7a-9b1e-2a3b4c5d6e7f'

describe('contrat IPC', () => {
  it('items.list : défauts appliqués à une entrée valide', () => {
    const parsed = contract['items.list'].input.parse({ scope: 'library' })
    expect(parsed).toEqual({
      scope: 'library',
      tab: 'all',
      sort: 'recent',
      cursor: null,
      limit: 120,
    })
    const coll = contract['items.list'].input.parse({
      scope: 'collection',
      collectionUuid: U,
      sort: 'name',
    })
    expect(coll).toMatchObject({ scope: 'collection', collectionUuid: U, sort: 'name' })
  })

  it('items.list : rejette une entrée invalide', () => {
    const bad = [
      { scope: 'nope' },
      { scope: 'collection' },
      { scope: 'collection', collectionUuid: 'pas-un-uuid' },
      { scope: 'library', limit: 0 },
      { scope: 'library', limit: 501 },
      { scope: 'library', sort: 'size' },
      { scope: 'library', filters: { period: { from: 10, to: 1 } } },
      { scope: 'library', cursor: 'a'.repeat(513) },
      { scope: 'library', cursor: 'pas base64 !' },
      { scope: 'library', filters: { color: 'red' } },
      undefined,
    ]
    for (const b of bad)
      expect(contract['items.list'].input.safeParse(b).success, JSON.stringify(b)).toBe(false)
  })

  it('typage de bout en bout sur items.list', () => {
    expectTypeOf<In<'items.list'>>().toExtend<{ scope: 'library' | 'collection' }>()
    expectTypeOf<Parsed<'items.list'>['sort']>().toEqualTypeOf<
      'recent' | 'oldest' | 'name' | 'color' | 'viewed' | 'mostViewed' | 'random'
    >()
    expectTypeOf<Out<'items.list'>['items'][number]['thumbUrl']>().toEqualTypeOf<string | null>()
    expectTypeOf<Out<'items.list'>['nextCursor']>().toEqualTypeOf<string | null>()
    // @ts-expect-error canal inconnu
    expectTypeOf<In<'items.nope'>>().toBeAny()
  })

  it('chaque canal appartient à un domaine figé et à un seul contrat de domaine', () => {
    for (const ch of CHANNELS) expect(DOMAINS).toContain(domainOf(ch))
    const total = Object.values(contractsByDomain).reduce((n, c) => n + Object.keys(c).length, 0)
    expect(total).toBe(CHANNELS.length)
    for (const [d, c] of Object.entries(contractsByDomain)) {
      for (const ch of Object.keys(c)) expect(domainOf(ch)).toBe(d)
    }
    expect(isChannel('items.list')).toBe(true)
    expect(isChannel('toString')).toBe(false)
  })

  it('contient les domaines et canaux de PLAN §4.4, sans recherche visuelle', () => {
    for (const ch of [
      'libraries.list',
      'libraries.remove',
      'ingest.files',
      'ingest.url',
      'rediscover.deck',
      'rediscover.undo',
      'ai.batch.create',
      'ai.queue.control',
      'sync.getRuns',
      'bridge.getGatherOSPresence',
      'spaces.applyBatch',
      'spaces.exportPng',
      'capture.setShortcut',
      'system.edit',
      'system.openLogs',
      'system.copyText',
    ]) {
      expect(CHANNELS, ch).toContain(ch)
    }
    expect(CHANNELS.some((c) => c.startsWith('embed.'))).toBe(false)
    expect(CHANNELS).not.toContain('search.similar')
    expect(CHANNELS).not.toContain('collections.suggest')
    expect(CHANNELS).not.toContain('items.rediscoverDeck')
  })

  it('libraries.remove impose deleteFiles: false ; system.openExternal refuse file://', () => {
    expect(
      contract['libraries.remove'].input.safeParse({ id: 'default', deleteFiles: true }).success,
    ).toBe(false)
    expect(
      contract['libraries.remove'].input.safeParse({ id: 'default', deleteFiles: false }).success,
    ).toBe(true)
    expect(
      contract['system.openExternal'].input.safeParse({ url: 'file:///etc/passwd' }).success,
    ).toBe(false)
    expect(
      contract['system.openExternal'].input.safeParse({ url: 'https://x.com/a' }).success,
    ).toBe(true)
  })

  it('les DTO média refusent les URL http(s)', () => {
    const out = contract['items.recentlyViewed'].output
    const card = {
      uuid: U,
      kind: 'image',
      source: 'local',
      title: null,
      width: 10,
      height: 10,
      mediaCount: 1,
      mime: 'image/webp',
      isAnimated: false,
      durationMs: null,
      dominant: '#aabbcc',
      hasNotes: false,
      createdAt: 1,
      displayDate: 1,
      viewCount: 0,
      thumbUrl: 'recolt://default/thumbs/0d/x.webp?v=1',
      largeUrl: null,
      posterUrl: null,
      previewUrl: null,
      originalUrl: null,
      post: null,
    }
    expect(out.safeParse([card]).success).toBe(true)
    expect(out.safeParse([{ ...card, thumbUrl: 'https://pbs.twimg.com/a.jpg' }]).success).toBe(
      false,
    )
  })

  it('les entrées vides acceptent undefined (rpc sans argument)', () => {
    expect(contract['items.counts'].input.parse(undefined)).toEqual({})
    expect(contract['jobs.pause'].input.parse(undefined)).toEqual({})
  })

  it('noms d’événements compatibles avec le preload', () => {
    const re = /^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/
    for (const e of EVENT_NAMES) expect(e).toMatch(re)
    // La liste blanche du preload (sans dépendance) reste égale aux événements réels.
    expect([...EVENT_NAME_LIST].sort()).toEqual([...EVENT_NAMES].sort())
    expect(EVENT_NAMES).toEqual(
      expect.arrayContaining([
        'items.changed',
        'collections.changed',
        'jobs.progress',
        'import.progress',
        'export.progress',
        'prefs.changed',
        'library.switched',
        'menu.command',
        'ai.queue',
        'ai.result',
        'sync.status',
        'capture.done',
        'capture.permissionRequired',
        'spaces.changed',
        'ingest.progress',
        'nav.openItem',
      ]),
    )
    expect(EVENT_PREFIX).toBe('evt:')
    expect(RAW_CHANNELS).toEqual({
      rpc: 'rpc',
      drag: 'drag',
      perfMark: 'perf:mark',
      flushRequest: 'app:flush-request',
      flushDone: 'app:flush-done',
      applyBatchSync: 'spaces:applyBatchSync',
    })
    expect(PRELOAD_ARG.e2e.startsWith('--')).toBe(true)
  })

  it('chaque raccourci de menu est une commande de menu relayée', () => {
    for (const s of SHORTCUTS.filter((d) => d.scope === 'menu'))
      expect(MENU_COMMANDS).toContain(s.id)
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length)
  })
})
