/**
 * Point d'entrée du media-worker (utilityProcess `recolt-media`, ARCHI §2.2).
 * sharp / ffmpeg / sips / hash / palette / zip. N'ouvre JAMAIS la base : main envoie les chemins.
 * Les chemins des binaires arrivent par `__configure` (jamais via le `PATH`, ARCHI §2.6).
 */
import sharp from 'sharp'
import type { MediaTools } from './media/exec'
import { runMediaOp } from './media/ops'
import { serve } from './runtime'

sharp.concurrency(2)
// Pas de cache libvips : un même chemin peut être réécrit (dérivés régénérés).
sharp.cache(false)

let tools: MediaTools = {}

function pickTools(a: unknown): MediaTools {
  const o = (typeof a === 'object' && a !== null ? a : {}) as Record<string, unknown>
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.startsWith('/') ? v : undefined
  return { ffmpeg: str(o.ffmpeg), ffprobe: str(o.ffprobe), sips: str(o.sips) }
}

serve({
  concurrency: 4,
  configure(args) {
    tools = pickTools((args as { tools?: unknown } | null)?.tools)
  },
  handle: (op, args, ctx) =>
    runMediaOp(op, args, { tools, signal: ctx.signal, progress: ctx.progress }),
})

// Une exception non rattrapée laisse un état incertain : on sort en erreur, l'hôte redémarre.
process.on('uncaughtException', (err) => {
  console.error('[media-worker] exception non rattrapée', err)
  process.exit(70)
})
process.on('unhandledRejection', (err) => {
  console.error('[media-worker] promesse rejetée non gérée', err)
  process.exit(70)
})
