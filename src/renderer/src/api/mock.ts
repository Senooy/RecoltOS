/**
 * Mock API (dev only): 60 fictitious `ItemCard`s (`mock-items.json`) served without main,
 * dummy images via the Vite middleware `/__mock/media`. Covers the reads useful to the shell;
 * the other channels respond `not_implemented` like main's stubs.
 */
import type { RecoltApi } from '../../../preload/api'
import type { CollectionNode } from '../../../shared/dto/collections'
import type { ItemCard, ItemDetail, ItemsPage, TabCounts } from '../../../shared/dto/items'
import type { RpcResult } from '../../../shared/errors'
import { langFromLocale } from '../../../shared/i18n/lang'
import type { In, Out } from '../../../shared/ipc'
import { DEFAULT_PREFS, mergePrefs, type Prefs, type PrefsPatch } from '../../../shared/prefs'
import fixture from './mock-items.json'

export const MOCK_ITEMS = fixture as ItemCard[]

/** Fictitious collections: members taken from the fixture (deterministic). */
const MOCK_COLLECTIONS: { uuid: string; name: string; members: string[] }[] = [
  {
    uuid: '0f6b5a52-1c1e-4a8e-9a51-3f2a1b7c9d01',
    name: 'Inspiration',
    members: MOCK_ITEMS.slice(0, 12).map((i) => i.uuid),
  },
  {
    uuid: '1a7c6b63-2d2f-4b9f-8b62-4a3b2c8d0e02',
    name: 'Typographie',
    members: MOCK_ITEMS.slice(12, 20).map((i) => i.uuid),
  },
  {
    uuid: '2b8d7c74-3e3a-4cab-9c73-5b4c3d9e1f03',
    name: 'Architecture',
    members: MOCK_ITEMS.slice(20, 26).map((i) => i.uuid),
  },
  {
    uuid: '3c9e8d85-4f4b-4dbc-8d84-6c5d4eaf2a04',
    name: 'Couleurs',
    members: MOCK_ITEMS.slice(26, 30).map((i) => i.uuid),
  },
]
const inCollection = new Set(MOCK_COLLECTIONS.flatMap((c) => c.members))
const hidden = new Set([MOCK_ITEMS[59]?.uuid])
const trashed = new Set([MOCK_ITEMS[58]?.uuid, MOCK_ITEMS[57]?.uuid])

let prefs: Prefs = DEFAULT_PREFS

const ok = <T>(data: T): RpcResult<T> => ({ ok: true, data })
const notImplemented = (channel: string): RpcResult<never> => ({
  ok: false,
  error: { code: 'not_implemented', message: `${channel} (mock) is not available` },
})

function live(i: ItemCard): boolean {
  return !hidden.has(i.uuid) && !trashed.has(i.uuid)
}

function sortItems(items: ItemCard[], sort: string): ItemCard[] {
  const out = [...items]
  switch (sort) {
    case 'oldest':
      return out.sort((a, b) => a.createdAt - b.createdAt)
    case 'name':
      return out.sort((a, b) => (a.title ?? '￿').localeCompare(b.title ?? '￿', 'fr'))
    case 'mostViewed':
      return out.sort((a, b) => b.viewCount - a.viewCount)
    default:
      return out.sort((a, b) => b.createdAt - a.createdAt)
  }
}

function list(input: In<'items.list'>): ItemsPage {
  let items: ItemCard[]
  if (input.scope === 'collection') {
    const c = MOCK_COLLECTIONS.find((x) => x.uuid === input.collectionUuid)
    items = MOCK_ITEMS.filter((i) => c?.members.includes(i.uuid) && !trashed.has(i.uuid))
  } else {
    const tab = input.tab ?? 'all'
    items = MOCK_ITEMS.filter((i) => {
      if (tab === 'trash') return trashed.has(i.uuid)
      if (tab === 'hidden') return hidden.has(i.uuid) && !trashed.has(i.uuid)
      if (!live(i)) return false
      if (tab === 'saved') return inCollection.has(i.uuid)
      if (tab === 'unsorted') return !inCollection.has(i.uuid)
      return true
    })
  }
  const sorted = sortItems(items, input.sort ?? 'recent')
  const start = input.cursor ? Number(input.cursor) : 0
  const limit = input.limit ?? 120
  const page = sorted.slice(start, start + limit)
  const next = start + limit < sorted.length ? String(start + limit) : null
  return { items: page, nextCursor: next, total: sorted.length }
}

function counts(): TabCounts {
  const liveItems = MOCK_ITEMS.filter(live)
  return {
    all: liveItems.length,
    saved: liveItems.filter((i) => inCollection.has(i.uuid)).length,
    unsorted: liveItems.filter((i) => !inCollection.has(i.uuid)).length,
    trash: trashed.size,
    hidden: MOCK_ITEMS.filter((i) => hidden.has(i.uuid) && !trashed.has(i.uuid)).length,
  }
}

function detail(uuid: string): ItemDetail | null {
  const card = MOCK_ITEMS.find((i) => i.uuid === uuid)
  if (!card) return null
  return {
    ...card,
    post: card.post ? { ...card.post, postedAt: card.createdAt, thread: [] } : null,
    notes: null,
    sourceUrl: null,
    externalId: null,
    slides: [],
    collections: MOCK_COLLECTIONS.filter((c) => c.members.includes(uuid)).map((c) => ({
      uuid: c.uuid,
      name: c.name,
    })),
    tags: [],
    palette: card.dominant ? [card.dominant] : null,
    ocrText: null,
    aiDescription: null,
    aiPrompt: null,
    aiState: 'none',
    aiProvider: null,
    aiLang: null,
    fileSize: null,
    addedAt: card.createdAt,
    hiddenAt: hidden.has(uuid) ? card.createdAt : null,
    deletedAt: trashed.has(uuid) ? card.createdAt : null,
    aiExcluded: false,
    aiJob: null,
    aiError: null,
  }
}

function tree(): CollectionNode[] {
  return MOCK_COLLECTIONS.map((c, i) => ({
    uuid: c.uuid,
    name: c.name,
    color: '#007aff',
    parentUuid: null,
    orderIndex: i,
    count: c.members.length,
    covers: c.members.slice(0, 3).flatMap((u) => MOCK_ITEMS.filter((it) => it.uuid === u)),
    coverItemUuid: null,
    aiExcluded: false,
    aiJob: null,
    aiError: null,
    createdAt: MOCK_ITEMS[0]?.createdAt ?? 0,
    updatedAt: MOCK_ITEMS[0]?.createdAt ?? 0,
    viewedAt: null,
    children: [],
  }))
}

function search(q: string): Out<'search.query'> {
  const needle = q.trim().toLocaleLowerCase('fr')
  const items = MOCK_ITEMS.filter(
    (i) =>
      live(i) &&
      (needle === '' ||
        (i.title ?? '').toLocaleLowerCase('fr').includes(needle) ||
        (i.post?.text ?? '').toLocaleLowerCase('fr').includes(needle) ||
        i.source === needle),
  )
  return { items, total: items.length, noPalette: 0 }
}

function handle(channel: string, input: unknown): RpcResult<unknown> {
  switch (channel) {
    case 'items.list':
      return ok(list(input as In<'items.list'>))
    case 'items.counts':
      return ok(counts())
    case 'items.get': {
      const d = detail((input as { uuid: string }).uuid)
      return d ? ok(d) : { ok: false, error: { code: 'not_found', message: 'item not found' } }
    }
    case 'items.recentlyViewed':
      return ok(MOCK_ITEMS.slice(0, (input as { limit?: number } | undefined)?.limit ?? 12))
    case 'collections.tree':
      return ok(tree())
    case 'tags.list':
      return ok({ tags: [], sourceChips: [] })
    case 'search.query':
      return ok(search((input as { q: string }).q))
    case 'search.history.list':
      return ok([])
    case 'prefs.get':
      return ok(prefs)
    case 'prefs.set':
      prefs = mergePrefs(prefs, (input as { patch: PrefsPatch }).patch)
      return ok(prefs)
    case 'libraries.list':
      return ok({
        active: 'default',
        libraries: [{ id: 'default', name: 'Bibliothèque', path: null, itemCount: counts().all }],
      })
    case 'spaces.list':
      return ok([])
    default:
      return notImplemented(channel)
  }
}

export function createMockApi(): RecoltApi {
  const dark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  return {
    invoke: (channel, input) => Promise.resolve(handle(channel, input)),
    on: () => () => undefined,
    startDrag: () => undefined,
    pathForFile: () => '',
    perfMark: () => undefined,
    onFlushRequest: () => () => undefined,
    flushDone: () => undefined,
    applyBatchSync: () => null,
    flags: {
      theme: dark ? 'dark' : 'light',
      e2e: false,
      // Mock in a browser: the language follows the browser's.
      lang: langFromLocale(navigator.language),
      systemLang: langFromLocale(navigator.language),
    },
  }
}
