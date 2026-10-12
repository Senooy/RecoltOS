/**
 * deferred persistence (debounce / max wait, sub-batches of 2,000, `validation` →
 * quarantine without loop, `busy` → retry, purge only unchanged nodes, viewport kept
 * separate, `flushSync`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Persistence,
  type BatchPayload,
} from '../../../src/renderer/src/features/spaces/editor/store/persistence'
import type { SpaceNode } from '../../../src/shared/spaces-schema'

const note = (uuid: string, x = 0): SpaceNode => ({
  uuid,
  type: 'note',
  x,
  y: 0,
  width: 200,
  height: 200,
  rotation: 0,
  z: 0,
  locked: false,
  createdAt: 0,
  updatedAt: 0,
  content: '',
  style: { color: 'yellow', fontSize: 14, align: 'left' },
})

class Err extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

function setup(send: (p: BatchPayload) => Promise<unknown>) {
  let nodes: Record<string, SpaceNode> = {}
  const calls: BatchPayload[] = []
  const invalid: number[] = []
  const p = new Persistence({
    send: (b) => {
      calls.push(b)
      return send(b)
    },
    sendSync: (b) => {
      calls.push(b)
      return { ok: true }
    },
    nodes: () => nodes,
    codeOf: (e) => (e as Err).code,
    onInvalid: (n) => invalid.push(n),
  })
  p.bind('s1')
  return {
    p,
    calls,
    invalid,
    set(n: Record<string, SpaceNode>) {
      nodes = n
    },
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('persistance', () => {
  it('debounce 500 ms, sub-batches of 2,000, purge after success', async () => {
    const h = setup(() => Promise.resolve({ updatedAt: 1 }))
    const all: Record<string, SpaceNode> = {}
    for (let i = 0; i < 4500; i++) all[`n${i}`] = note(`n${i}`, i)
    h.set(all)
    h.p.mark(Object.keys(all))
    await vi.advanceTimersByTimeAsync(400)
    expect(h.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(h.calls.map((c) => c.upsert.length)).toEqual([2000, 2000, 500])
    expect(h.p.isDirty).toBe(false)
  })

  it('max wait 3 s despite continuous activity', async () => {
    const h = setup(() => Promise.resolve({}))
    h.set({ a: note('a') })
    for (let t = 0; t < 3200; t += 300) {
      h.p.mark(['a'])
      await vi.advanceTimersByTimeAsync(300)
    }
    expect(h.calls.length).toBeGreaterThan(0)
  })

  it('validation: node-by-node replay, quarantine, no loop', async () => {
    const h = setup((b) =>
      b.upsert.some((n) => n.uuid === 'bad')
        ? Promise.reject(new Err('validation'))
        : Promise.resolve({}),
    )
    h.set({ a: note('a'), bad: note('bad'), c: note('c') })
    h.p.mark(['a', 'bad', 'c'])
    await h.p.flush()
    expect(h.invalid).toEqual([1])
    expect(h.p.isDirty).toBe(false)
    expect(h.p.quarantine.has('bad')).toBe(true)
    const before = h.calls.length
    await vi.advanceTimersByTimeAsync(20_000)
    expect(h.calls.length).toBe(before)
  })

  it('busy: dirty kept, retry at 2 s then success', async () => {
    let fail = true
    const h = setup(() => (fail ? Promise.reject(new Err('busy')) : Promise.resolve({})))
    h.set({ a: note('a') })
    h.p.mark(['a'])
    await h.p.flush()
    expect(h.p.isDirty).toBe(true)
    fail = false
    await vi.advanceTimersByTimeAsync(2100)
    expect(h.p.isDirty).toBe(false)
  })

  it('a node modified during the send remains to be written', async () => {
    let release!: () => void
    const h = setup(() => new Promise<void>((r) => (release = r)))
    h.set({ a: note('a', 1) })
    h.p.mark(['a'])
    const f = h.p.flush()
    h.set({ a: note('a', 2) })
    release()
    await f
    expect(h.p.upserts.has('a')).toBe(true)
  })

  it('deletions, viewport without node, flushSync', async () => {
    const h = setup(() => Promise.resolve({}))
    h.set({})
    h.p.mark(['gone'])
    h.p.setViewport({ x: 1, y: 2, zoom: 1.5 })
    await h.p.flush()
    expect(h.calls[0]).toMatchObject({ delete: ['gone'], viewport: { x: 1, y: 2, zoom: 1.5 } })
    h.set({ z: note('z') })
    h.p.mark(['z'])
    h.p.flushSync()
    expect(h.calls.at(-1)!.upsert.map((n) => n.uuid)).toEqual(['z'])
    expect(h.p.isDirty).toBe(false)
  })
})
