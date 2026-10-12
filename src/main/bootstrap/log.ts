/**
 * Journal du process main (electron-log, fichier sous `userData/logs/`).
 * Ne jamais journaliser de secret (cookies, `ct0`, `sessionid`, `Bearer`, jetons d'extension).
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
    // Pas de preload injecté par electron-log : le seul preload est le nôtre (sandbox).
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
