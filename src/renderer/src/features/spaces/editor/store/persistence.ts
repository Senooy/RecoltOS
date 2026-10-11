/**
 * Persistance différée (SPACES §1.7.1) : suivi `dirty` HORS de l'état immer, vidage après 500 ms
 * d'inactivité (attente max 3 s), en sous-lots de 2 000 nœuds, chaque `spaces.applyBatch` étant
 * atomique ; `dirty` n'est purgé qu'après succès (et seulement si le nœud n'a pas changé entre-temps).
 * `validation` : non réessayable → rejeu nœud par nœud, quarantaine des fautifs, toast. `busy` / `io`
 * (et toute autre erreur) : `dirty` conservé, nouvel essai à 2 s puis backoff plafonné à 15 s.
 * Viewport à part (1 s), sans toucher `updated_at`. `flushSync()` = dernier recours de `beforeunload`.
 */
import type { SpaceBackground, SpaceNode, Camera } from '../../../../../../shared/spaces-schema'
import { FLUSH_CHUNK, MAX_SYNC_BATCH } from '../../../../../../shared/spaces-schema'

export const FLUSH_DEBOUNCE_MS = 500
export const FLUSH_MAX_WAIT_MS = 3000
export const VIEWPORT_DEBOUNCE_MS = 1000
export const RETRY_MIN_MS = 2000
export const RETRY_MAX_MS = 15_000

export interface BatchPayload {
  spaceUuid: string
  upsert: SpaceNode[]
  delete: string[]
  viewport?: Camera
  name?: string
  background?: SpaceBackground
}

export interface PersistenceDeps {
  send(p: BatchPayload): Promise<unknown>
  sendSync?(p: BatchPayload): unknown
  /** Nœuds courants (état committé du store). */
  nodes(): Record<string, SpaceNode>
  /** Code d'erreur d'un échec (`validation`, `busy`…). */
  codeOf(err: unknown): string
  onInvalid?(count: number, ids: string[]): void
  onRetry?(err: unknown): void
  onSaved?(): void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
  now?: () => number
}

export class Persistence {
  readonly upserts = new Set<string>()
  readonly deletes = new Set<string>()
  spaceUuid: string | null = null
  private meta: { name?: string; background?: SpaceBackground } = {}
  private viewport: Camera | null = null
  private timer: unknown = null
  private vpTimer: unknown = null
  private firstDirtyAt: number | null = null
  private inflight: Promise<void> | null = null
  private retryMs = 0
  private retryTimer: unknown = null
  readonly quarantine = new Set<string>()

  private readonly d: PersistenceDeps

  constructor(d: PersistenceDeps) {
    this.d = d
  }

  private set = (fn: () => void, ms: number) =>
    this.d.setTimer ? this.d.setTimer(fn, ms) : setTimeout(fn, ms)
  private clear = (t: unknown) => {
    if (t === null) return
    if (this.d.clearTimer) this.d.clearTimer(t)
    else clearTimeout(t as ReturnType<typeof setTimeout>)
  }
  private now = () => (this.d.now ? this.d.now() : Date.now())

  bind(spaceUuid: string | null): void {
    this.spaceUuid = spaceUuid
    this.upserts.clear()
    this.deletes.clear()
    this.quarantine.clear()
    this.meta = {}
    this.viewport = null
    this.firstDirtyAt = null
    this.retryMs = 0
    this.clear(this.timer)
    this.clear(this.vpTimer)
    this.clear(this.retryTimer)
    this.timer = this.vpTimer = this.retryTimer = null
  }

  get isDirty(): boolean {
    return (
      this.upserts.size > 0 ||
      this.deletes.size > 0 ||
      this.meta.name !== undefined ||
      this.meta.background !== undefined ||
      this.viewport !== null
    )
  }

  mark(ids: readonly string[]): void {
    const nodes = this.d.nodes()
    for (const id of ids) {
      if (nodes[id]) {
        this.upserts.add(id)
        this.deletes.delete(id)
      } else {
        this.upserts.delete(id)
        this.deletes.add(id)
      }
    }
    this.schedule()
  }

  setMeta(m: { name?: string; background?: SpaceBackground }): void {
    this.meta = { ...this.meta, ...m }
    this.schedule()
  }

  setViewport(c: Camera): void {
    this.viewport = c
    this.clear(this.vpTimer)
    this.vpTimer = this.set(() => {
      this.vpTimer = null
      void this.flush()
    }, VIEWPORT_DEBOUNCE_MS)
  }

  private schedule(): void {
    if (this.retryTimer !== null) return
    const t = this.now()
    if (this.firstDirtyAt === null) this.firstDirtyAt = t
    this.clear(this.timer)
    const wait = Math.max(0, Math.min(FLUSH_DEBOUNCE_MS, this.firstDirtyAt + FLUSH_MAX_WAIT_MS - t))
    this.timer = this.set(() => {
      this.timer = null
      void this.flush()
    }, wait)
  }

  /** Vide tout ce qui est en attente ; ne lève jamais. Appels concurrents chaînés. */
  flush(): Promise<void> {
    const run = async (): Promise<void> => {
      if (this.inflight) await this.inflight.catch(() => undefined)
      await this.doFlush()
    }
    const p = run()
    this.inflight = p
    void p.finally(() => {
      if (this.inflight === p) this.inflight = null
    })
    return p
  }

  private async doFlush(): Promise<void> {
    this.clear(this.timer)
    this.timer = null
    const space = this.spaceUuid
    if (!space || !this.isDirty) return
    this.firstDirtyAt = null
    const nodes = this.d.nodes()
    const upIds = [...this.upserts].filter((id) => nodes[id] && !this.quarantine.has(id))
    const snap = new Map(upIds.map((id) => [id, nodes[id]!]))
    const delIds = [...this.deletes]
    const meta = this.meta
    const viewport = this.viewport
    this.meta = {}
    this.viewport = null
    const chunks = Math.max(
      1,
      Math.ceil(upIds.length / FLUSH_CHUNK),
      Math.ceil(delIds.length / FLUSH_CHUNK),
    )
    try {
      for (let i = 0; i < chunks; i++) {
        const ups = upIds.slice(i * FLUSH_CHUNK, (i + 1) * FLUSH_CHUNK)
        const dels = delIds.slice(i * FLUSH_CHUNK, (i + 1) * FLUSH_CHUNK)
        const payload: BatchPayload = {
          spaceUuid: space,
          upsert: ups.map((id) => snap.get(id)!),
          delete: dels,
          ...(i === chunks - 1 ? meta : {}),
          ...(i === chunks - 1 && viewport ? { viewport } : {}),
        }
        try {
          await this.d.send(payload)
        } catch (err) {
          if (this.d.codeOf(err) !== 'validation') throw err
          await this.replayOneByOne(space, payload, snap)
          continue
        }
        this.settle(ups, dels, snap)
      }
      this.retryMs = 0
      this.d.onSaved?.()
    } catch (err) {
      // Réessayable : on remet ce qui n'a pas été écrit.
      this.meta = { ...meta, ...this.meta }
      if (viewport && !this.viewport) this.viewport = viewport
      this.retryMs = this.retryMs === 0 ? RETRY_MIN_MS : Math.min(RETRY_MAX_MS, this.retryMs * 2)
      this.d.onRetry?.(err)
      this.clear(this.retryTimer)
      this.retryTimer = this.set(() => {
        this.retryTimer = null
        void this.flush()
      }, this.retryMs)
    }
  }

  private settle(ups: string[], dels: string[], snap: Map<string, SpaceNode>): void {
    const now = this.d.nodes()
    for (const id of ups) if (now[id] === snap.get(id)) this.upserts.delete(id)
    for (const id of dels) if (!now[id]) this.deletes.delete(id)
  }

  private async replayOneByOne(
    space: string,
    payload: BatchPayload,
    snap: Map<string, SpaceNode>,
  ): Promise<void> {
    const bad: string[] = []
    for (const n of payload.upsert) {
      try {
        await this.d.send({ spaceUuid: space, upsert: [n], delete: [] })
        this.settle([n.uuid], [], snap)
      } catch (err) {
        if (this.d.codeOf(err) !== 'validation') throw err
        bad.push(n.uuid)
        this.quarantine.add(n.uuid)
        this.upserts.delete(n.uuid)
      }
    }
    const meta: Partial<BatchPayload> = {}
    if (payload.name !== undefined) meta.name = payload.name
    if (payload.background !== undefined) meta.background = payload.background
    if (payload.viewport) meta.viewport = payload.viewport
    if (payload.delete.length > 0 || Object.keys(meta).length > 0) {
      try {
        await this.d.send({ spaceUuid: space, upsert: [], delete: payload.delete, ...meta })
        this.settle([], payload.delete, snap)
      } catch (err) {
        if (this.d.codeOf(err) !== 'validation') throw err
        for (const id of payload.delete) this.deletes.delete(id)
      }
    }
    if (bad.length > 0) this.d.onInvalid?.(bad.length, bad)
  }

  /** `beforeunload` : un seul sous-lot synchrone (≤ 2 000), sans attente possible. */
  flushSync(): void {
    const space = this.spaceUuid
    if (!space || !this.isDirty || !this.d.sendSync) return
    const nodes = this.d.nodes()
    const ups = [...this.upserts].filter((id) => nodes[id]).slice(0, MAX_SYNC_BATCH)
    const dels = [...this.deletes].slice(0, MAX_SYNC_BATCH)
    const payload: BatchPayload = {
      spaceUuid: space,
      upsert: ups.map((id) => nodes[id]!),
      delete: dels,
      ...this.meta,
      ...(this.viewport ? { viewport: this.viewport } : {}),
    }
    try {
      const r = this.d.sendSync(payload) as { ok?: boolean } | null
      if (r && r.ok) {
        for (const id of ups) this.upserts.delete(id)
        for (const id of dels) this.deletes.delete(id)
        this.meta = {}
        this.viewport = null
      }
    } catch {
      // dernier recours : rien d'autre à faire
    }
  }

  dispose(): void {
    this.clear(this.timer)
    this.clear(this.vpTimer)
    this.clear(this.retryTimer)
    this.timer = this.vpTimer = this.retryTimer = null
  }
}
