/**
 * Criteria 4 and 5 on real Electron: `utilityProcess` (via `makeUtilityFork`), RPC,
 * SIGKILL during `makePreview` → `worker_crashed` then restart, 540p preview readable by
 * Chromium (`<video>` readyState ≥ 3, 960×540).
 *
 * The Electron process is launched from `tests/unit/media/electron/smoke-main.ts` (bundled by
 * esbuild into `.tmp/`, inside the repo so that `sharp` resolves). Explicit skip if the
 * Electron binary or ffmpeg/ffprobe is missing (the reason is written to the test log).
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

/** Path to the Electron binary, or undefined if the package did not download its binary. */
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
  ? 'Electron binary missing (node_modules/electron not downloaded)'
  : !HAS_FFMPEG
    ? 'system ffmpeg/ffprobe missing'
    : ''
if (SKIP_REASON) console.warn(`[electron-smoke] skipped: ${SKIP_REASON}`)

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

describe.skipIf(SKIP_REASON !== '')('media-worker in Electron (real utilityProcess)', () => {
  it('RPC, SIGKILL during makePreview → worker_crashed + restart, preview readable by Chromium', async () => {
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
        fail(new Error(`Electron stuck (120 s)\n${stderr.slice(-2000)}`))
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

    // RPC criterion: hash identical to the one computed on the test side.
    expect(out.hashFileSha256).toBe(srcSha)
    // Crash criterion: worker_crashed and job 11 interrupted, then restart and successful call.
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
    // Chromium criterion: the preview is decoded by <video>, 960×540.
    expect(out.chromium).toMatchObject({ videoWidth: 960, videoHeight: 540, errorCode: null })
    expect(out.chromium!.readyState).toBeGreaterThanOrEqual(3)
  }, 180_000)
})
