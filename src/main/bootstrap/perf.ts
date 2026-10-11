/**
 * Canal brut `perf:mark` (QA §2.5) : marques du renderer journalisées dans
 * `userData/logs/perf.jsonl` avec `process.uptime()`.
 */
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { RAW_CHANNELS } from '../../shared/ipc/channels'

export function installPerfMarks(userData: string): void {
  const file = path.join(userData, 'logs', 'perf.jsonl')
  ipcMain.on(RAW_CHANNELS.perfMark, (_e, payload: unknown) => {
    const p = payload as { name?: unknown; t?: unknown } | null
    if (!p || typeof p.name !== 'string' || p.name.length > 100) return
    const line = JSON.stringify({
      name: p.name,
      t: typeof p.t === 'number' ? p.t : null,
      uptime: process.uptime(),
      at: Date.now(),
    })
    fs.promises
      .mkdir(path.dirname(file), { recursive: true })
      .then(() => fs.promises.appendFile(file, `${line}\n`))
      .catch(() => undefined)
  })
}
