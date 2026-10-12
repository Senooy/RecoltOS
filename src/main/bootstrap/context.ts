/**
 * Context passed to each `init<Domain>()` (`services.ts` registry).
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
  /** Emits `evt:<name>` to the app's windows (payload validated in dev). */
  emit<E extends EventName>(event: E, payload: EventPayload<E>): void
  log: Logger
}

export type Disposer = () => void | Promise<void>
export type InitFn = (ctx: ServiceContext) => void | Disposer | Promise<void | Disposer>
