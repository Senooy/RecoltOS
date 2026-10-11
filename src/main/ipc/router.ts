/**
 * Routeur IPC (ARCHI §2.3, PLAN §1.8) : un seul canal `rpc`, validation zod des entrées
 * (toujours) et des sorties (en dev), contrôle de l'expéditeur, erreurs `{ code, message }`.
 * Le cœur (`dispatch`) n'importe pas `electron` : testable sous Node.
 */
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  AppError,
  formatIssues,
  isAppErrorShape,
  type AppErrorShape,
  type RpcResult,
} from '../../shared/errors'
import {
  CHANNELS,
  EVENT_PREFIX,
  RAW_CHANNELS,
  contract,
  domainOf,
  events,
  isChannel,
  type Channel,
  type ChannelOf,
  type Domain,
  type EventName,
  type EventPayload,
  type Out,
  type Parsed,
} from '../../shared/ipc'

export interface HandlerContext {
  /** WebContents émetteur (absent dans les tests). */
  sender?: WebContents
}

export type Handler<C extends Channel> = (
  input: Parsed<C>,
  ctx: HandlerContext,
) => Out<C> | Promise<Out<C>>

export type DomainHandlers<D extends Domain> = { [C in ChannelOf<D>]: Handler<C> }
export type AllHandlers = { [C in Channel]: Handler<C> }

/** Handlers `not_implemented` pour tous les canaux d'un domaine (stubs de WP-00). */
export function notImplemented<D extends Domain>(domain: D): DomainHandlers<D> {
  const out: Record<string, Handler<Channel>> = {}
  for (const ch of CHANNELS) {
    if (domainOf(ch) !== domain) continue
    out[ch] = () => {
      throw new AppError('not_implemented', `${ch} n'est pas encore implémenté`)
    }
  }
  return out as unknown as DomainHandlers<D>
}

export interface DispatchOptions {
  handlers: Partial<AllHandlers>
  /** Valide aussi la sortie (dev). */
  validateOutput: boolean
  onError?: (channel: string, err: unknown) => void
}

function toErrorShape(err: unknown): AppErrorShape {
  if (err instanceof AppError) return err.toJSON()
  if (err instanceof z.ZodError) {
    return { code: 'validation', message: formatIssues(err.issues), details: err.issues }
  }
  if (isAppErrorShape(err)) return { code: err.code, message: err.message }
  return { code: 'internal', message: err instanceof Error ? err.message : String(err) }
}

/** Valide, appelle le handler, renvoie une enveloppe : ne lève jamais. */
export async function dispatch(
  channel: unknown,
  input: unknown,
  ctx: HandlerContext,
  opts: DispatchOptions,
): Promise<RpcResult<unknown>> {
  if (!isChannel(channel)) {
    return {
      ok: false,
      error: { code: 'unknown_channel', message: `canal inconnu : ${String(channel)}` },
    }
  }
  const def = contract[channel]
  const parsed = def.input.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'validation',
        message: formatIssues(parsed.error.issues),
        details: parsed.error.issues,
      },
    }
  }
  // Le canal est validé dynamiquement : on appelle le handler sous une signature large.
  const handler = opts.handlers[channel] as
    ((input: unknown, ctx: HandlerContext) => unknown) | undefined
  if (!handler) {
    return {
      ok: false,
      error: { code: 'not_implemented', message: `${channel} n'a pas de handler` },
    }
  }
  try {
    const data: unknown = await handler(parsed.data, ctx)
    if (opts.validateOutput) {
      const out = def.output.safeParse(data)
      if (!out.success) {
        opts.onError?.(channel, out.error)
        return {
          ok: false,
          error: {
            code: 'invalid_output',
            message: formatIssues(out.error.issues),
            details: out.error.issues,
          },
        }
      }
      return { ok: true, data: out.data }
    }
    return { ok: true, data }
  } catch (err) {
    const shape = toErrorShape(err)
    if (shape.code !== 'not_implemented') opts.onError?.(channel, err)
    return { ok: false, error: shape }
  }
}

/**
 * Origine autorisée : dev = serveur Vite (`ELECTRON_RENDERER_URL`) ; prod = `index.html`
 * du renderer en `file://`. Les fenêtres hors écran n'ont pas de preload et ne peuvent pas appeler.
 *
 * En prod on compare des CHEMINS décodés (`fileURLToPath`), pas des URL : Node encode `[`, `]` et `~`
 * (`%5B`, `%5D`, `%7E`) dans `pathToFileURL`, Chromium non ; une comparaison de chaînes refuserait
 * tous les appels si le chemin d'installation contient l'un d'eux. `?` et `#` sont ignorés.
 */
export function makeSenderCheck(opts: { rendererUrl: string | null; rendererIndexPath: string }) {
  const devOrigin = opts.rendererUrl ? new URL(opts.rendererUrl).origin : null
  const expected = path.normalize(opts.rendererIndexPath)
  return (frameUrl: string | undefined | null): boolean => {
    if (!frameUrl) return false
    try {
      const u = new URL(frameUrl)
      if (devOrigin) return u.origin === devOrigin
      return u.protocol === 'file:' && path.normalize(fileURLToPath(u)) === expected
    } catch {
      return false
    }
  }
}

export interface RegisterRpcOptions extends DispatchOptions {
  ipcMain: IpcMain
  isAllowedSender: (frameUrl: string | undefined | null) => boolean
}

export function registerRpc(opts: RegisterRpcOptions): () => void {
  const listener = async (e: IpcMainInvokeEvent, channel: unknown, input: unknown) => {
    if (!opts.isAllowedSender(e.senderFrame?.url)) {
      return { ok: false, error: { code: 'forbidden_sender', message: 'expéditeur non autorisé' } }
    }
    return dispatch(channel, input, { sender: e.sender }, opts)
  }
  opts.ipcMain.handle(RAW_CHANNELS.rpc, listener)
  return () => opts.ipcMain.removeHandler(RAW_CHANNELS.rpc)
}

/** Valide (dev) puis envoie `evt:<name>` à chaque WebContents cible. */
export function makeEmitter(opts: {
  targets: () => WebContents[]
  validate: boolean
  onError?: (event: string, err: unknown) => void
}) {
  return function emit<E extends EventName>(event: E, payload: EventPayload<E>): void {
    if (opts.validate) {
      const r = events[event].safeParse(payload)
      if (!r.success) {
        opts.onError?.(event, r.error)
        return
      }
    }
    for (const wc of opts.targets()) {
      if (!wc.isDestroyed()) wc.send(`${EVENT_PREFIX}${event}`, payload)
    }
  }
}
