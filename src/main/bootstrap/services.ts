/**
 * Registre des services (PLAN §1.26) : chaque domaine expose `init<Domaine>(ctx)` dans
 * `src/main/<domaine>/init.ts` ; seul ce fichier les appelle, dans cet ordre. Aucun lot
 * n'édite `main/index.ts`. Pas de domaine `embed` (ERRATA §G).
 */
import { initAi } from '../ai/init'
import { initBridge } from '../bridge/init'
import { initCapture } from '../capture/init'
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
  'spaces',
  'ai',
  'sync',
  'bridge',
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
  { domain: 'spaces', init: initSpaces },
  { domain: 'ai', init: initAi },
  { domain: 'sync', init: initSync },
  { domain: 'bridge', init: initBridge },
  { domain: 'capture', init: initCapture },
  { domain: 'import-ux', init: initImportUx },
]

export interface ServicesHandle {
  started: ServiceDomain[]
  failed: { domain: ServiceDomain; error: unknown }[]
  dispose(): Promise<void>
}

/**
 * Appelle chaque `init` dans l'ordre. Un domaine en échec est journalisé et n'empêche pas
 * les suivants (l'app reste lançable). `dispose()` libère dans l'ordre inverse.
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
      ctx.log.error(`[services] échec de init ${domain}`, error)
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
          ctx.log.error(`[services] échec de dispose ${domain}`, error)
        }
      }
    },
  }
}
