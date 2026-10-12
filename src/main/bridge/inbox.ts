/**
 * `inbox/` spool: when the app is closed, the native host atomically writes `save.create` requests
 * there (media ≤ 8 MiB). At startup, files are ingested in chronological order
 * (name = `<timestamp>-<id>.json`), then deleted; the folder is then watched.
 * An unreadable or refused file is moved to `inbox/rejets/` (never lost, never replayed).
 */
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { parseMessage } from '../../shared/bridge/messages'
import type { SaveAck, SaveRequest } from '../../shared/bridge/save'
import { mt } from '../i18n'

export interface InboxDeps {
  dir: string
  save(req: SaveRequest): Promise<SaveAck>
  log: { info(...a: unknown[]): void; warn(...a: unknown[]): void }
}

export class Inbox {
  private readonly deps: InboxDeps
  private watcher: FSWatcher | null = null
  private running: Promise<number> | null = null
  private again = false
  private timer: NodeJS.Timeout | null = null

  constructor(deps: InboxDeps) {
    this.deps = deps
  }

  /** Ingests everything pending; returns the number of files processed. */
  drain(): Promise<number> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.drainOnce().finally(() => {
      this.running = null
      if (this.again) {
        this.again = false
        void this.drain()
      }
    })
    return this.running
  }

  private async drainOnce(): Promise<number> {
    const { dir, log } = this.deps
    let names: string[]
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()
    } catch {
      return 0
    }
    let n = 0
    for (const name of names) {
      const file = path.join(dir, name)
      let ack: SaveAck | null = null
      try {
        const r = parseMessage(JSON.parse(await readFile(file, 'utf8')))
        if (r.ok && r.message.type === 'save.create') {
          ack = await this.deps.save(r.message.payload)
        }
      } catch {
        ack = null
      }
      if (ack && ack.status !== 'error') {
        await rm(file, { force: true })
        n += 1
      } else if (ack?.error === mt().errors.noLibrary) {
        // Retried later (library being opened).
        break
      } else {
        await mkdir(path.join(dir, 'rejets'), { recursive: true })
        await rename(file, path.join(dir, 'rejets', name)).catch(() => rm(file, { force: true }))
        log.warn(`[bridge] spool: ${name} rejected`)
      }
    }
    if (n > 0) log.info(`[bridge] spool: ${n} record(s) ingested`)
    return n
  }

  start(): void {
    if (this.watcher) {
      void this.drain()
      return
    }
    void mkdir(this.deps.dir, { recursive: true, mode: 0o700 })
      .then(() => {
        void this.drain()
        if (this.watcher) return
        try {
          this.watcher = watch(this.deps.dir, (_ev, name) => {
            if (!name || !String(name).endsWith('.json')) return
            if (this.timer) clearTimeout(this.timer)
            this.timer = setTimeout(() => void this.drain(), 300)
          })
        } catch (err) {
          this.deps.log.warn('[bridge] unable to watch the spool', err)
        }
      })
      .catch(() => undefined)
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearTimeout(this.timer)
  }
}
