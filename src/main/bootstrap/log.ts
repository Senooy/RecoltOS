/**
 * Main process log (electron-log, file under `userData/logs/`).
 * Never log a secret (cookies, `ct0`, `sessionid`, `Bearer`, extension tokens).
 */
import log from 'electron-log/main'

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

let initialized = false

export function initLog(): Logger {
  if (!initialized) {
    // No preload injected by electron-log: the only preload is ours (sandbox).
    log.initialize({ preload: false })
    log.transports.file.level = 'info'
    log.transports.console.level = process.env.NODE_ENV === 'production' ? 'warn' : 'info'
    initialized = true
  }
  return log
}

export function scopedLog(scope: string): Logger {
  return log.scope(scope)
}
