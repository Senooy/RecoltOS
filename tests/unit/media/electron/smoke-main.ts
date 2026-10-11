/**
 * WP-03 — smoke Electron du media-worker, lancé par `electron-smoke.test.ts` (pas un test vitest :
 * le nom ne contient pas `.test.`). Process main réel : `utilityProcess.fork` via
 * `makeUtilityFork` (le vrai adaptateur de production), `media.worker` bundlé par esbuild.
 *
 * Scénario : RPC `hashFile` ; SIGKILL pendant `makePreview` → `worker_crashed`, redémarrage,
 * nouvel appel OK ; lecture de l'aperçu par Chromium (`<video>`, readyState et dimensions).
 * Entrée : `RECOLT_SMOKE_CONFIG` (chemin d'un JSON). Sortie : JSON écrit dans `resultPath`.
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createMediaWorker, type CrashInfo } from '../../../../src/main/workers-host'
import { makeUtilityFork } from '../../../../src/main/workers/utility-fork'

interface SmokeConfig {
  userData: string
  workerPath: string
  src: string
  preview: string
  tools: { ffmpeg?: string; ffprobe?: string; sips?: string }
  resultPath: string
}

interface SmokeResult {
  ok: boolean
  error?: string
  hashFileSha256?: string
  crashes: { broken: boolean; interrupted: { op: string; jobId?: number }[] }[]
  restarts?: number
  restartedState?: string
  afterCrashPreview?: { width: number; height: number; bytes: number }
  chromium?: {
    readyState: number
    videoWidth: number
    videoHeight: number
    errorCode: number | null
  }
  logs: string[]
}

const cfg = JSON.parse(readFileSync(process.env.RECOLT_SMOKE_CONFIG ?? '', 'utf8')) as SmokeConfig
const result: SmokeResult = { ok: false, crashes: [], logs: [] }

function finish(code: number): void {
  writeFileSync(cfg.resultPath, JSON.stringify(result, null, 2))
  app.exit(code)
}

async function waitFor(cond: () => boolean, label: string, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > until) throw new Error(`délai dépassé : ${label}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

async function readInChromium(previewPath: string): Promise<SmokeResult['chromium']> {
  const dir = dirname(previewPath)
  const html = `<!doctype html><meta charset="utf-8"><video id="v" src="${basename(previewPath)}" preload="auto" muted></video>`
  const htmlPath = join(dir, 'index.html')
  writeFileSync(htmlPath, html)
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  try {
    await win.loadFile(htmlPath)
    const read: unknown = await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const v = document.getElementById('v')
        const done = () => resolve({
          readyState: v.readyState,
          videoWidth: v.videoWidth,
          videoHeight: v.videoHeight,
          errorCode: v.error ? v.error.code : null,
        })
        if (v.readyState >= 3) return done()
        v.addEventListener('canplay', done, { once: true })
        v.addEventListener('error', done, { once: true })
        setTimeout(done, 15000)
      })
    `)
    return read as SmokeResult['chromium']
  } finally {
    win.destroy()
  }
}

async function run(): Promise<void> {
  app.setPath('userData', cfg.userData)
  app.dock?.hide()
  const crashes: CrashInfo[] = []
  const log = {
    info: (...a: unknown[]) => result.logs.push(`info ${a.map(String).join(' ')}`),
    warn: (...a: unknown[]) => result.logs.push(`warn ${a.map(String).join(' ')}`),
    error: (...a: unknown[]) => result.logs.push(`error ${a.map(String).join(' ')}`),
  }
  const mw = createMediaWorker({
    modulePath: cfg.workerPath,
    fork: makeUtilityFork(log),
    tools: cfg.tools,
    backoffMs: [50, 100],
    onCrash: (info) => crashes.push(info),
    log,
  })
  try {
    // RPC de bout en bout avec le worker réel.
    const h = (await mw.call('hashFile', { abs: cfg.src })) as { sha256: string }
    result.hashFileSha256 = h.sha256

    // SIGKILL du process utilityProcess pendant makePreview (le worker est déjà prêt).
    const pid = mw.host.pid
    if (pid === undefined) throw new Error('worker sans pid')
    const pending = mw.call(
      'makePreview',
      { src: cfg.src, dst: cfg.preview, maxSeconds: 8, height: 540 },
      { jobId: 11 },
    )
    process.kill(pid, 'SIGKILL')
    let crashed: unknown
    try {
      await pending
    } catch (err) {
      crashed = err
    }
    if ((crashed as { code?: string } | undefined)?.code !== 'worker_crashed') {
      throw new Error(`makePreview tué : attendu worker_crashed, reçu ${JSON.stringify(crashed)}`)
    }
    for (const c of crashes) {
      result.crashes.push({
        broken: c.broken,
        interrupted: c.interrupted.map((i) => ({ op: i.op, jobId: i.jobId })),
      })
    }

    // Redémarrage automatique, puis un appel réussi (le job relancé par la file).
    await waitFor(() => mw.host.state === 'ready', 'redémarrage du worker', 15_000)
    result.restarts = mw.host.restarts
    result.restartedState = mw.host.state
    const again = (await mw.call(
      'makePreview',
      { src: cfg.src, dst: cfg.preview, maxSeconds: 8, height: 540 },
      { jobId: 12 },
    )) as { width: number; height: number; bytes: number }
    result.afterCrashPreview = { width: again.width, height: again.height, bytes: again.bytes }

    // Lecture par Chromium (la page vit à côté de l'aperçu, file:// autorisé par loadFile).
    result.chromium = await readInChromium(cfg.preview)
    result.ok = true
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  } finally {
    await mw.stop()
  }
  finish(result.ok ? 0 : 1)
}

app.whenReady().then(run, (err: unknown) => {
  result.error = String(err)
  finish(1)
})
