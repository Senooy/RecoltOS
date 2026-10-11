/**
 * Contexte passé à chaque `init<Domaine>()` (registre `services.ts`).
 */
import type { BrowserWindow } from 'electron'
import type { EventName, EventPayload } from '../../shared/ipc'
import type { RuntimeFlags } from './env'
import type { Logger } from './log'

export interface ServiceContext {
  userData: string
  flags: RuntimeFlags
  isPackaged: boolean
  getMainWindow(): BrowserWindow | null
  /** Émet `evt:<name>` vers les fenêtres de l'app (payload validé en dev). */
  emit<E extends EventName>(event: E, payload: EventPayload<E>): void
  log: Logger
}

export type Disposer = () => void | Promise<void>
export type InitFn = (ctx: ServiceContext) => void | Disposer | Promise<void | Disposer>
