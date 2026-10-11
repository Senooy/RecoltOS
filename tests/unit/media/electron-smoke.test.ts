/**
 * WP-03 — critères 4 et 5 côté Electron réel : `utilityProcess` (via `makeUtilityFork`), RPC,
 * SIGKILL pendant `makePreview` → `worker_crashed` puis redémarrage, aperçu 540p lisible par
 * Chromium (`<video>` readyState ≥ 3, 960×540).
 *
 * Le process Electron est lancé depuis `tests/unit/media/electron/smoke-main.ts` (bundlé par
 * esbuild dans `.tmp/`, à l'intérieur du dépôt pour que `sharp` se résolve). Skip explicite si
 * le binaire Electron ou ffmpeg/ffprobe manquent (la raison est écrite dans le journal de test).
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FFMPEG, FFPROBE, generateMediaFixtures } from '../../fixtures/media/generate'
import { makeTmp } from './helpers'

const ROOT = resolve(import.meta.dirname, '../../..')

/** Chemin du binaire Electron, ou undefined si le paquet n'a pas téléchargé son binaire. */
function electronBinary(): string | undefined {
  try {
    const p = createRequire(import.meta.url)('electron') as unknown
    return typeof p === 'string' && existsSync(p) ? p : undefined
  } catch {
    return undefined
  }
}

const ELECTRON = electronBinary()
const HAS_FFMPEG = Boolean(FFMPEG && FFPROBE)
const SKIP_REASON = !ELECTRON
  ? 'binaire Electron absent (node_modules/electron non téléchargé)'
  : !HAS_FFMPEG
    ? 'ffmpeg/ffprobe système absents'
    : ''
if (SKIP_REASON) console.warn(`[electron-smoke] ignoré : ${SKIP_REASON}`)

const tmp = makeTmp('recolt-electron-smoke-')
const work = join(ROOT, '.tmp', `electron-smoke-${process.pid}`)

interface SmokeOutput {
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

let smokeJs = ''
let workerJs = ''
let src = ''
let srcSha = ''

beforeAll(async () => {
  if (SKIP_REASON) return
  mkdirSync(work, { recursive: true })
  await build({
    entryPoints: {
      'smoke-main': resolve(ROOT, 'tests/unit/media/electron/smoke-main.ts'),
      'media.worker': resolve(ROOT, 'src/main/workers/media.worker.ts'),
    },
    outdir: work,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron', 'sharp'],
    logLevel: 'silent',
  })
  smokeJs = join(work, 'smoke-main.js')
  workerJs = join(work, 'media.worker.js')
  const fx = await generateMediaFixtures(join(tmp.dir, 'fx'))
  src = fx.longMp4!
  srcSha = createHash('sha256').update(readFileSync(src)).digest('hex')
}, 180_000)

afterAll(() => {
  tmp.cleanup()
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(SKIP_REASON !== '')('media-worker dans Electron (utilityProcess réel)', () => {
  it('RPC, SIGKILL pendant makePreview → worker_crashed + redémarrage, aperçu lisible par Chromium', async () => {
    const dir = join(tmp.dir, 'run')
    mkdirSync(join(dir, 'user'), { recursive: true })
    const preview = join(dir, 'preview.mp4')
    const resultPath = join(dir, 'result.json')
    const configPath = join(dir, 'config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        userData: join(dir, 'user'),
        workerPath: workerJs,
        src,
        preview,
        tools: { ffmpeg: FFMPEG, ffprobe: FFPROBE, sips: '/usr/bin/sips' },
        resultPath,
      }),
    )
    const code = await new Promise<number | null>((done, fail) => {
      const env: NodeJS.ProcessEnv = { ...process.env, RECOLT_SMOKE_CONFIG: configPath }
      delete env.ELECTRON_RUN_AS_NODE
      const child = spawn(ELECTRON!, [smokeJs], { env, stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', (c: Buffer) => (stderr += String(c)))
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        fail(new Error(`Electron bloqué (120 s)\n${stderr.slice(-2000)}`))
      }, 120_000)
      child.on('exit', (c) => {
        clearTimeout(timer)
        if (c !== 0) console.warn(stderr.slice(-2000))
        done(c)
      })
    })
    expect(existsSync(resultPath)).toBe(true)
    const out = JSON.parse(readFileSync(resultPath, 'utf8')) as SmokeOutput
    expect(out.error).toBeUndefined()
    expect(code).toBe(0)

    // Critère RPC : hash identique à celui calculé côté test.
    expect(out.hashFileSha256).toBe(srcSha)
    // Critère crash : worker_crashed et job 11 interrompu, puis redémarrage et appel réussi.
    expect(out.crashes.length).toBeGreaterThanOrEqual(1)
    expect(
      out.crashes.some((c) => c.interrupted.some((i) => i.op === 'makePreview' && i.jobId === 11)),
    ).toBe(true)
    expect(out.crashes.every((c) => !c.broken)).toBe(true)
    expect(out.restarts).toBeGreaterThanOrEqual(1)
    expect(out.restartedState).toBe('ready')
    expect(out.afterCrashPreview).toMatchObject({ width: 960, height: 540 })
    expect(out.afterCrashPreview!.bytes).toBeGreaterThan(0)
    expect(existsSync(preview)).toBe(true)
    // Critère Chromium : l'aperçu est décodé par <video>, 960×540.
    expect(out.chromium).toMatchObject({ videoWidth: 960, videoHeight: 540, errorCode: null })
    expect(out.chromium!.readyState).toBeGreaterThanOrEqual(3)
  }, 180_000)
})
