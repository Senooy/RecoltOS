/**
 * Entry point of the media-worker (utilityProcess `recolt-media`).
 * sharp / ffmpeg / sips / hash / palette / zip. NEVER opens the database: main sends the paths.
 * Binary paths arrive via `__configure` (never via the `PATH`).
 */
import sharp from 'sharp'
import { isLang, setLang } from '../../shared/i18n/lang'
import type { MediaTools } from './media/exec'
import { runMediaOp } from './media/ops'
import { serve } from './runtime'

sharp.concurrency(2)
// No libvips cache: the same path may be rewritten (derived files are regenerated).
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
    const a = args as { tools?: unknown; lang?: unknown } | null
    tools = pickTools(a?.tools)
    if (isLang(a?.lang)) setLang(a.lang)
  },
  handle: (op, args, ctx) =>
    runMediaOp(op, args, { tools, signal: ctx.signal, progress: ctx.progress }),
})

// An uncaught exception leaves an uncertain state: exit with an error, the host restarts.
process.on('uncaughtException', (err) => {
  console.error('[media-worker] uncaught exception', err)
  process.exit(70)
})
process.on('unhandledRejection', (err) => {
  console.error('[media-worker] unhandled promise rejection', err)
  process.exit(70)
})
