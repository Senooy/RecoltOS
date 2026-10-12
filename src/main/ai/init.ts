/**
 * Domaine `ai` : service IA (fournisseurs CLI, porte par fournisseur, budget, journal),
 * branché sur la file unique `jobs` (handlers `ai.enrich` / `ai.prompt`) et sur le cycle de vie des
 * bibliothèques. Aucune détection au démarrage tant que le fournisseur est `off`.
 */
import type { Disposer, ServiceContext } from '../bootstrap/context'
import { getJobQueue, requireJobServices } from '../jobs/runtime'
import { getActiveLibrary, registerLibraryLifecycle } from '../library/library-context'
import { requirePrefsStore } from '../prefs/store'
import { AiService, setAiService } from './service'

export function initAi(ctx: ServiceContext): Disposer {
  const prefs = requirePrefsStore()
  const service = new AiService({
    userData: ctx.userData,
    prefs: () => prefs.get(),
    setPrefs: (patch) => prefs.set(patch),
    emit: (event, payload) => ctx.emit(event, payload),
    services: () => {
      try {
        return requireJobServices()
      } catch {
        return null
      }
    },
    queue: () => getJobQueue(),
    log: ctx.log,
  })
  setAiService(service)

  const dispose = registerLibraryLifecycle('ai', {
    afterOpen: (lib) => service.onLibraryOpen(lib),
  })
  const lib = getActiveLibrary()
  if (lib)
    void service.onLibraryOpen(lib).catch((err: unknown) => ctx.log.warn('[ai] ouverture', err))

  // Fournisseur actif : détection en arrière-plan (version, connexion, rejeu du niveau 1).
  if (prefs.get().ai.provider !== 'off') {
    void service.detect().catch((err: unknown) => ctx.log.warn('[ai] détection', err))
  }
  const off = prefs.onChange((next, prev) => {
    const a = next.ai
    const b = prev.ai
    if (
      a.provider !== b.provider ||
      a.fallback !== b.fallback ||
      a.claude.path !== b.claude.path ||
      a.codex.path !== b.codex.path
    ) {
      service.providers.refresh()
      getJobQueue()?.kick()
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) service.scheduleSnapshot()
  })

  return () => {
    off()
    dispose()
    service.dispose()
    setAiService(null)
  }
}
