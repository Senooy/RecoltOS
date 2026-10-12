/**
 * Main file for posts WITHOUT media: renders the `TweetCard light` card (same
 * component as the grid) in an off-screen window (`withOffscreenWindow` +
 * `offscreen.html?render=tweet-card`), capture then 960 px wide WebP (role
 * `render`, then `media.derive`). In-memory serial queue, resumed at startup (`tweet` posts
 * synced without media).
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { newUuid } from '../../shared/ids'
import { JOB_PRIORITY } from '../../shared/jobs'
import { cardRowsByIds } from '../db/queries/list'
import { toItemCard } from '../dto/item-card'
import type { MediaCaller } from '../jobs/handlers/types'
import { rel } from '../library/paths'
import type { LibraryContext } from '../library/library-context'

/** CSS width of the card; rendered at ×2 (`zoom`) → 960 px. */
export const CARD_CSS_WIDTH = 480
export const CARD_PX_WIDTH = 960

export interface CardCapture {
  png: Buffer
  width: number
  height: number
}

/** PNG capture of the card (Electron): injected to keep this module testable under Node. */
export type CaptureCard = (data: string) => Promise<CardCapture>

/** Route payload: the card as base64url JSON (no http(s) URL, avatar `recolt://`). */
export function cardPayload(card: unknown): string {
  return Buffer.from(JSON.stringify(card), 'utf8').toString('base64url')
}

export async function renderTweetCard(
  lib: LibraryContext,
  itemId: number,
  deps: { media: MediaCaller; capture: CaptureCard; now?: () => number },
): Promise<string | null> {
  const row = cardRowsByIds(lib.db, [itemId])[0]
  if (!row) return null
  if (lib.repos.media.listByItem(itemId).length > 0) return null
  const card = toItemCard(lib, row)
  const shot = await deps.capture(cardPayload(card))
  const mediaUuid = newUuid()
  const tmp = lib.paths.abs(rel.tmp(`${mediaUuid}.card.png`))
  await mkdir(dirname(tmp), { recursive: true })
  await writeFile(tmp, shot.png)
  try {
    const fileRel = rel.original(mediaUuid, 'webp')
    const abs = lib.paths.abs(fileRel)
    await mkdir(dirname(abs), { recursive: true })
    const out = await deps.media(
      'makeDisplay',
      { src: tmp, dst: abs, maxEdge: 2048 },
      { timeoutMs: 60_000 },
    )
    const { sha256, bytes } = await deps.media('hashFile', { abs }, { timeoutMs: 60_000 })
    const at = (deps.now ?? Date.now)()
    lib.db.transaction(() => {
      const m = lib.repos.media.insert(itemId, {
        uuid: mediaUuid,
        mediaType: 'image',
        role: 'render',
        status: 'processing',
        fileRel,
        mime: 'image/webp',
        width: out.width,
        height: out.height,
        fileSize: bytes,
        contentHash: sha256,
        position: 0,
        createdAt: at,
      })
      lib.db
        .prepare(
          'UPDATE items SET cover_media_id = ?, media_count = 1 WHERE id = ? AND cover_media_id IS NULL',
        )
        .run(m.id, itemId)
      lib.repos.jobs.enqueue(
        {
          type: 'media.derive',
          itemId,
          dedupeKey: `media:${m.id}`,
          payload: { mediaId: m.id },
          priority: JOB_PRIORITY.SYNC,
        },
        at,
      )
    })()
    return row.uuid
  } finally {
    await rm(tmp, { force: true })
  }
}

/** Posts synced without media or render (resumed at startup). */
export function pendingCardItems(lib: LibraryContext, limit = 200): number[] {
  return (
    lib.db
      .prepare(
        `SELECT i.id FROM items i WHERE i.kind = 'tweet' AND i.origin = 'sync' AND i.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM item_media m WHERE m.item_id = i.id)
         ORDER BY i.created_at DESC LIMIT ?`,
      )
      .all(limit) as { id: number }[]
  ).map((r) => r.id)
}

/** Serial queue (one off-screen window at a time). */
export class CardRenderQueue {
  private queue: number[] = []
  private running = false
  private readonly run: (itemId: number) => Promise<void>
  constructor(run: (itemId: number) => Promise<void>) {
    this.run = run
  }
  push(ids: readonly number[]): void {
    for (const id of ids) if (!this.queue.includes(id)) this.queue.push(id)
    void this.pump()
  }
  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (let id = this.queue.shift(); id !== undefined; id = this.queue.shift()) {
        await this.run(id).catch(() => undefined)
      }
    } finally {
      this.running = false
    }
  }
  get size(): number {
    return this.queue.length
  }
}
