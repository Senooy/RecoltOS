/**
 * Service registry: each domain exposes `init<Domain>(ctx)` in
 * `src/main/<domain>/init.ts`; only this file calls them, in this order. No domain
 * edits `main/index.ts`. No `embed` domain.
 */
import { initAi } from '../ai/init'
import { initBridge } from '../bridge/init'
import { initCapture } from '../capture/init'
import { initData } from '../data/init'
import { initImportUx } from '../import-ux/init'
import { initJobs } from '../jobs/init'
import { initLibrary } from '../library/init'
import { initMenu } from '../menu'
import { initPrefs } from '../prefs/init'
import { initProtocol } from '../protocol/init'
import { initSpaces } from '../spaces/init'
import { initSync } from '../sync/init'
import type { Disposer, InitFn, ServiceContext } from './context'

export const SERVICE_DOMAINS = [
  'prefs',
  'library',
  'protocol',
  'menu',
  'jobs',
  'data',
  'spaces',
  'ai',
  'bridge',
  'sync',
  'capture',
  'import-ux',
] as const
export type ServiceDomain = (typeof SERVICE_DOMAINS)[number]

export const SERVICES: readonly { domain: ServiceDomain; init: InitFn }[] = [
  { domain: 'prefs', init: initPrefs },
  { domain: 'library', init: initLibrary },
  { domain: 'protocol', init: initProtocol },
  { domain: 'menu', init: initMenu },
  { domain: 'jobs', init: initJobs },
  { domain: 'data', init: initData },
  { domain: 'spaces', init: initSpaces },
  { domain: 'ai', init: initAi },
  // The bridge comes before sync: the coordinator subscribes to the `BridgeServer` messages.
  { domain: 'bridge', init: initBridge },
  { domain: 'sync', init: initSync },
  { domain: 'capture', init: initCapture },
  { domain: 'import-ux', init: initImportUx },
]

export interface ServicesHandle {
  started: ServiceDomain[]
  failed: { domain: ServiceDomain; error: unknown }[]
  dispose(): Promise<void>
}

/**
 * Calls each `init` in order. A failing domain is logged and does not prevent
 * the following ones (the app stays launchable). `dispose()` releases in reverse order.
 */
export async function initServices(
  ctx: ServiceContext,
  registry: readonly { domain: ServiceDomain; init: InitFn }[] = SERVICES,
): Promise<ServicesHandle> {
  const started: ServiceDomain[] = []
  const failed: { domain: ServiceDomain; error: unknown }[] = []
  const disposers: { domain: ServiceDomain; dispose: Disposer }[] = []
  for (const { domain, init } of registry) {
    try {
      const d = await init(ctx)
      if (typeof d === 'function') disposers.push({ domain, dispose: d })
      started.push(domain)
    } catch (error) {
      failed.push({ domain, error })
      ctx.log.error(`[services] init failed for ${domain}`, error)
    }
  }
  return {
    started,
    failed,
    async dispose() {
      for (const { domain, dispose } of disposers.reverse()) {
        try {
          await dispose()
        } catch (error) {
          ctx.log.error(`[services] dispose failed for ${domain}`, error)
        }
      }
    },
  }
}
