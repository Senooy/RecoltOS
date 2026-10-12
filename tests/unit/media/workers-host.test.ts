/**
 * criterion 5: deliberate worker crash → restart with backoff, job set back to
 * `queued`. Also: end-to-end RPC with the real `media.worker.ts`, serialized errors,
 * cancellation, `stopAll()`.
 */
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import {
  WorkerHost,
  createMediaWorker,
  stopAll,
  type CrashInfo,
  type ForkFn,
  type WorkerChild,
} from '../../../src/main/workers-host'
import type { WorkerRequest } from '../../../src/shared/worker-protocol'
import { TOOLS, makeTmp } from './helpers'
import { MEDIA_WORKER_TS, nodeFork } from './node-fork'

const tmp = makeTmp()
const file = join(tmp.dir, 'f.bin')
writeFileSync(file, 'récolte'.repeat(5000))
const expectedSha = createHash('sha256').update('récolte'.repeat(5000)).digest('hex')

afterEach(async () => {
  await stopAll()
})
afterAll(() => tmp.cleanup())

/** Minimal in-memory job queue, wired as it would be to `onCrash`. */
function memoryQueue() {
  const jobs = new Map<
    number,
    { state: 'queued' | 'running' | 'done' | 'failed'; attempts: number }
  >()
  return {
    jobs,
    add(id: number) {
      jobs.set(id, { state: 'queued', attempts: 0 })
    },
    start(id: number) {
      const j = jobs.get(id)!
      j.state = 'running'
      j.attempts++
    },
    onCrash(info: CrashInfo) {
      for (const it of info.interrupted) {
        const j = it.jobId === undefined ? undefined : jobs.get(it.jobId)
        if (j && j.state === 'running') {
          j.state = 'queued'
          j.attempts-- // a worker crash does not consume an attempt
        }
      }
    },
  }
}

describe('real media-worker (child_process + tsx)', () => {
  it('RPC hashFile / probeImage, typed errors without worker crash', async () => {
    const nf = nodeFork()
    const mw = createMediaWorker({ modulePath: MEDIA_WORKER_TS, fork: nf.fork, tools: TOOLS })
    expect(await mw.call('hashFile', { abs: file })).toEqual({
      sha256: expectedSha,
      bytes: Buffer.byteLength('récolte'.repeat(5000)),
    })
    await expect(mw.call('hashFile', { abs: join(tmp.dir, 'absent') })).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(mw.host.call('nope', {})).rejects.toMatchObject({ code: 'unknown_op' })
    // ffmpeg missing on the worker side (configuration without ffmpeg) → tool_missing, the worker survives.
    await mw.setTools({ sips: '/usr/bin/sips' })
    await expect(
      mw.call('makePreview', {
        src: join(tmp.dir, 'x.mp4'),
        dst: join(tmp.dir, 'p.mp4'),
        maxSeconds: 8,
        height: 540,
      }),
    ).rejects.toMatchObject({ code: 'tool_missing' })
    expect(await mw.call('hashFile', { abs: file })).toMatchObject({ sha256: expectedSha })
    expect(nf.children).toHaveLength(1)
    expect(mw.host.restarts).toBe(0)
  }, 30_000)

  it('deliberate crash → restart, job set back to queued then completed', async () => {
    const nf = nodeFork()
    const q = memoryQueue()
    const crashes: CrashInfo[] = []
    const mw = createMediaWorker({
      modulePath: MEDIA_WORKER_TS,
      fork: nf.fork,
      tools: TOOLS,
      backoffMs: [50, 100, 200],
      onCrash: (info) => {
        crashes.push(info)
        q.onCrash(info)
      },
    })
    // Startup and first normal call.
    await mw.call('hashFile', { abs: file })
    const firstPid = mw.host.pid

    q.add(7)
    q.start(7)
    nf.killAfterSend('hashFile')
    await expect(mw.call('hashFile', { abs: file }, { jobId: 7 })).rejects.toMatchObject({
      code: 'worker_crashed',
    })
    expect(crashes).toHaveLength(1)
    expect(crashes[0]).toMatchObject({
      name: 'recolt-media',
      signal: 'SIGKILL',
      restartInMs: 50,
      interrupted: [{ op: 'hashFile', jobId: 7 }],
    })
    expect(q.jobs.get(7)).toEqual({ state: 'queued', attempts: 0 })

    // The queue relaunches the job: the worker restarted (new pid) and responds.
    q.start(7)
    const r = await mw.call('hashFile', { abs: file }, { jobId: 7 })
    expect(r.sha256).toBe(expectedSha)
    q.jobs.get(7)!.state = 'done'
    expect(mw.host.restarts).toBe(1)
    expect(nf.children).toHaveLength(2)
    expect(mw.host.pid).not.toBe(firstPid)
    expect(mw.host.state).toBe('ready')
  }, 30_000)

  it('requests sent during the restart go out afterwards, with the configuration', async () => {
    const nf = nodeFork()
    const mw = createMediaWorker({
      modulePath: MEDIA_WORKER_TS,
      fork: nf.fork,
      tools: { sips: '/usr/bin/sips' },
      backoffMs: [100],
    })
    await mw.call('hashFile', { abs: file })
    nf.killAfterSend('hashFile')
    const lost = mw.call('hashFile', { abs: file })
    await expect(lost).rejects.toMatchObject({ code: 'worker_crashed' })
    expect(mw.host.state).toBe('restarting')
    // Sent during the backoff: waits for the new worker. The config (without ffmpeg) is replayed.
    const p = mw.call('makePoster', { src: file, dst: join(tmp.dir, 'p.jpg'), atMs: 0 })
    await expect(p).rejects.toMatchObject({ code: 'tool_missing' })
  }, 30_000)

  it('zipLibrary with an unreadable source: typed error, worker alive, no .part', async () => {
    const nf = nodeFork()
    const crashes: CrashInfo[] = []
    const mw = createMediaWorker({
      modulePath: MEDIA_WORKER_TS,
      fork: nf.fork,
      tools: TOOLS,
      onCrash: (i) => crashes.push(i),
    })
    const root = join(tmp.dir, 'ziproot')
    const outDir = join(tmp.dir, 'zipout')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'a.bin'), Buffer.alloc(64 * 1024, 1))
    writeFileSync(join(root, 'b.bin'), Buffer.alloc(64 * 1024, 2))
    chmodSync(join(root, 'b.bin'), 0o000)
    try {
      await expect(
        mw.call(
          'zipLibrary',
          {
            root,
            out: join(outDir, 'lib.zip'),
            entries: [
              { abs: 'a.bin', name: 'a.bin' },
              { abs: 'b.bin', name: 'b.bin' },
            ],
          },
          { jobId: 1 },
        ),
      ).rejects.toMatchObject({ code: 'io' })
    } finally {
      chmodSync(join(root, 'b.bin'), 0o644)
    }
    expect(await mw.call('hashFile', { abs: file })).toMatchObject({ sha256: expectedSha })
    expect(crashes).toEqual([])
    expect(mw.host.restarts).toBe(0)
    expect(nf.children).toHaveLength(1)
    expect(readdirSync(outDir)).toEqual([])
  }, 30_000)

  it('module that throws on load (real child) → broken, call rejected, no loop', async () => {
    const bad = join(tmp.dir, 'boom.cjs')
    writeFileSync(bad, "throw new Error('boom au chargement')\n")
    const nf = nodeFork()
    const crashes: CrashInfo[] = []
    const h = new WorkerHost({
      name: 'boom',
      modulePath: bad,
      fork: nf.fork,
      backoffMs: [20, 20, 20],
      onCrash: (i) => crashes.push(i),
    })
    await expect(h.call('hashFile', { abs: file }, { jobId: 3 })).rejects.toMatchObject({
      code: 'worker_unavailable',
      details: { jobId: 3 },
    })
    expect(h.state).toBe('broken')
    expect(nf.children).toHaveLength(3)
    expect(crashes.at(-1)).toMatchObject({ broken: true, interrupted: [{ jobId: 3 }] })
    await new Promise((r) => setTimeout(r, 300))
    expect(nf.children).toHaveLength(3)
    await h.stop()
  }, 30_000)

  it('stopAll: clean stop, later calls refused', async () => {
    const nf = nodeFork()
    const mw = createMediaWorker({ modulePath: MEDIA_WORKER_TS, fork: nf.fork, tools: TOOLS })
    await mw.call('hashFile', { abs: file })
    const child = nf.children[0]!
    await stopAll()
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    expect(mw.host.state).toBe('stopped')
    await expect(mw.call('hashFile', { abs: file })).rejects.toMatchObject({ code: 'cancelled' })
  }, 30_000)
})

/** Fake child driven by the test (backoff, SIGKILL after a delay, cancellation). */
function fakeFork() {
  const kids: {
    child: WorkerChild
    sent: WorkerRequest[]
    signals: string[]
    reply(m: unknown): void
    exit(code: number | null, signal?: string | null): void
  }[] = []
  const fork: ForkFn = () => {
    let onMsg: (m: unknown) => void = () => {}
    let onExit: (c: number | null, s: string | null) => void = () => {}
    const k = {
      sent: [] as WorkerRequest[],
      signals: [] as string[],
      reply: (m: unknown) => onMsg(m),
      exit: (c: number | null, s: string | null = null) => onExit(c, s),
      child: {
        pid: 1000 + kids.length,
        postMessage: (m: WorkerRequest) => k.sent.push(m),
        onMessage: (cb: (m: unknown) => void) => {
          onMsg = cb
        },
        onExit: (cb: (c: number | null, s: string | null) => void) => {
          onExit = cb
        },
        kill: (s?: NodeJS.Signals) => {
          k.signals.push(s ?? 'SIGTERM')
        },
      } satisfies WorkerChild,
    }
    kids.push(k)
    return k.child
  }
  return { fork, kids }
}

describe('WorkerHost (fake child)', () => {
  it('backoff 1 s, 5 s, 30 s then 30 s; reset to zero after stability', async () => {
    vi.useFakeTimers()
    try {
      const ff = fakeFork()
      const delays: number[] = []
      const h = new WorkerHost({
        name: 't',
        modulePath: '/x.js',
        fork: ff.fork,
        stableAfterMs: 60_000,
        onCrash: (i) => delays.push(i.restartInMs),
      })
      h.start()
      for (let i = 0; i < 4; i++) {
        const k = ff.kids.at(-1)!
        k.reply({ ready: true, pid: k.child.pid })
        k.exit(1)
        await vi.advanceTimersByTimeAsync(delays.at(-1)!)
      }
      expect(delays).toEqual([1_000, 5_000, 30_000, 30_000])
      expect(ff.kids).toHaveLength(5)
      const k = ff.kids.at(-1)!
      k.reply({ ready: true, pid: k.child.pid })
      await vi.advanceTimersByTimeAsync(60_000)
      k.exit(1)
      expect(delays.at(-1)).toBe(1_000)
      await h.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('repeated exits without hello → broken: requests rejected (worker_unavailable), no more loop', async () => {
    vi.useFakeTimers()
    try {
      const ff = fakeFork()
      const crashes: CrashInfo[] = []
      const h = new WorkerHost({
        name: 't',
        modulePath: '/x.js',
        fork: ff.fork,
        onCrash: (i) => crashes.push(i),
      })
      const p1 = h.call('hashFile', { abs: '/a' }, { jobId: 7 })
      const p2 = h.call('hashFile', { abs: '/b' })
      const settled = Promise.allSettled([p1, p2])
      for (let i = 0; i < 3; i++) {
        ff.kids.at(-1)!.exit(1) // exits without having said hello
        if (i < 2) {
          expect(h.state).toBe('restarting')
          await vi.advanceTimersByTimeAsync(i === 0 ? 1_000 : 5_000)
        }
      }
      expect(h.state).toBe('broken')
      expect(ff.kids).toHaveLength(3)
      const [r1, r2] = await settled
      expect(r1).toMatchObject({
        status: 'rejected',
        reason: { code: 'worker_unavailable', details: { jobId: 7 } },
      })
      expect(r2).toMatchObject({ status: 'rejected', reason: { code: 'worker_unavailable' } })
      // A single « broken » signal, with the requests (jobId) to fail on the job queue side.
      const last = crashes.at(-1)!
      expect(last.broken).toBe(true)
      expect(last.restartInMs).toBe(0)
      expect(last.interrupted.map((i) => i.jobId)).toEqual([7, undefined])
      expect(crashes.slice(0, -1).every((c) => !c.broken && c.interrupted.length === 0)).toBe(true)
      // No more automatic restarts, and the following calls fail immediately.
      await vi.advanceTimersByTimeAsync(120_000)
      expect(ff.kids).toHaveLength(3)
      await expect(h.call('hashFile', { abs: '/c' }, { jobId: 9 })).rejects.toMatchObject({
        code: 'worker_unavailable',
        details: { jobId: 9 },
      })
      // Explicit restart(): the worker starts again and serves again.
      h.restart()
      expect(ff.kids).toHaveLength(4)
      const k = ff.kids.at(-1)!
      k.reply({ ready: true, pid: k.child.pid })
      const ok = h.call('hashFile', { abs: '/d' })
      expect(k.sent.at(-1)).toMatchObject({ op: 'hashFile' })
      k.reply({ id: k.sent.at(-1)!.id, ok: true, result: { sha256: 'x', bytes: 1 } })
      await expect(ok).resolves.toEqual({ sha256: 'x', bytes: 1 })
      expect(h.state).toBe('ready')
      const stopped = h.stop()
      k.exit(null, 'SIGTERM')
      await stopped
    } finally {
      vi.useRealTimers()
    }
  })

  it('a hello is enough to reset the failed-start counter to zero', async () => {
    vi.useFakeTimers()
    try {
      const ff = fakeFork()
      const h = new WorkerHost({ name: 't', modulePath: '/x.js', fork: ff.fork })
      h.start()
      for (let i = 0; i < 6; i++) {
        const k = ff.kids.at(-1)!
        if (i % 2 === 1) k.reply({ ready: true, pid: k.child.pid }) // one start in two succeeds
        k.exit(1)
        await vi.advanceTimersByTimeAsync(30_000)
      }
      expect(h.state).not.toBe('broken')
      const stopped = h.stop()
      ff.kids.at(-1)?.exit(null, 'SIGTERM')
      await stopped
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop: SIGTERM then SIGKILL after 3 s if the worker does not exit', async () => {
    vi.useFakeTimers()
    try {
      const ff = fakeFork()
      const h = new WorkerHost({ name: 't', modulePath: '/x.js', fork: ff.fork })
      h.start()
      const k = ff.kids[0]!
      k.reply({ ready: true, pid: 1 })
      const stopped = h.stop()
      expect(k.signals).toEqual(['SIGTERM'])
      await vi.advanceTimersByTimeAsync(3_000)
      expect(k.signals).toEqual(['SIGTERM', 'SIGKILL'])
      k.exit(null, 'SIGKILL')
      await stopped
      expect(h.state).toBe('stopped')
      expect(ff.kids).toHaveLength(1) // no restart after a requested stop

      // Child that never reports its exit: the stop completes anyway.
      const h2 = new WorkerHost({ name: 't2', modulePath: '/x.js', fork: ff.fork })
      h2.start()
      ff.kids.at(-1)!.reply({ ready: true, pid: 2 })
      const s2 = h2.stop()
      await vi.advanceTimersByTimeAsync(6_000)
      await s2
      expect(h2.state).toBe('stopped')
      expect(ff.kids.at(-1)!.signals).toEqual(['SIGTERM', 'SIGKILL'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop during startup: hello ignored, SIGTERM sent again, no restart', async () => {
    vi.useFakeTimers()
    try {
      const ff = fakeFork()
      const crashes: CrashInfo[] = []
      const ready: number[] = []
      const h = new WorkerHost({
        name: 't',
        modulePath: '/x.js',
        fork: ff.fork,
        backoffMs: [10],
        onCrash: (i) => crashes.push(i),
        onReady: (pid) => ready.push(pid),
      })
      h.start()
      const k = ff.kids[0]!
      let resolved = false
      const stopped = h.stop().then(() => {
        resolved = true
      })
      expect(k.signals).toEqual(['SIGTERM'])
      // `hello` arrives after the stop (kill has no effect before the spawn, Electron case).
      k.reply({ ready: true, pid: 1 })
      expect(h.state).toBe('stopping')
      expect(k.signals).toEqual(['SIGTERM', 'SIGTERM'])
      expect(ready).toEqual([])
      await expect(h.call('hashFile', {})).rejects.toMatchObject({ code: 'cancelled' })
      k.exit(null, 'SIGTERM')
      await vi.advanceTimersByTimeAsync(100)
      await stopped
      expect(resolved).toBe(true)
      expect(h.state).toBe('stopped')
      expect(crashes).toEqual([])
      expect(ff.kids).toHaveLength(1)

      // Same scenario, the child never reports its exit: the safety net finalizes the stop.
      const h2 = new WorkerHost({
        name: 't2',
        modulePath: '/x.js',
        fork: ff.fork,
        backoffMs: [10],
        onCrash: (i) => crashes.push(i),
      })
      h2.start()
      const k2 = ff.kids.at(-1)!
      const s2 = h2.stop()
      k2.reply({ ready: true, pid: 2 })
      await vi.advanceTimersByTimeAsync(6_000)
      await s2
      expect(h2.state).toBe('stopped')
      expect(k2.signals).toEqual(['SIGTERM', 'SIGTERM', 'SIGKILL'])
      expect(crashes).toEqual([])
      expect(ff.kids).toHaveLength(2)
      // Late exit after the safety net: ignored, no restart.
      k2.exit(null, 'SIGKILL')
      await vi.advanceTimersByTimeAsync(100)
      expect(h2.state).toBe('stopped')
      expect(ff.kids).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop before hello then exit: no crash reported nor restart (real child)', async () => {
    const nf = nodeFork()
    const crashes: CrashInfo[] = []
    const mw = createMediaWorker({
      modulePath: MEDIA_WORKER_TS,
      fork: nf.fork,
      tools: TOOLS,
      backoffMs: [10],
      onCrash: (i) => crashes.push(i),
    })
    mw.host.start()
    await mw.stop()
    expect(mw.host.state).toBe('stopped')
    await new Promise((r) => setTimeout(r, 200))
    expect(crashes).toEqual([])
    expect(nf.children).toHaveLength(1)
    expect(mw.host.restarts).toBe(0)
  }, 30_000)

  it('cancellation: immediate rejection and __cancel sent; progress relayed; timeout exceeded', async () => {
    const ff = fakeFork()
    const h = new WorkerHost({ name: 't', modulePath: '/x.js', fork: ff.fork, config: { a: 1 } })
    const ac = new AbortController()
    const progress: unknown[] = []
    const p = h.call('zipLibrary', {}, { signal: ac.signal, onProgress: (x) => progress.push(x) })
    const k = ff.kids[0]!
    expect(k.sent).toEqual([]) // not ready yet
    k.reply({ ready: true, pid: 1 })
    expect(k.sent.map((m) => m.op)).toEqual(['__configure', 'zipLibrary'])
    const id = k.sent[1]!.id
    k.reply({ id, progress: { done: 1, total: 2 } })
    expect(progress).toEqual([{ done: 1, total: 2 }])
    ac.abort()
    await expect(p).rejects.toMatchObject({ code: 'cancelled' })
    expect(k.sent.at(-1)).toEqual({ id: 0, op: '__cancel', args: { id } })

    const t = h.call('hashFile', {}, { timeoutMs: 20 })
    const tId = k.sent.at(-1)!.id
    await expect(t).rejects.toMatchObject({ code: 'timeout' })
    expect(k.sent.at(-1)).toEqual({ id: 0, op: '__cancel', args: { id: tId } })
    // Late or unknown responses ignored without error.
    k.reply({ id: tId, ok: true, result: 1 })
    k.reply({ id: 999, ok: false, error: { code: 'x', message: 'y', retryAt: 5 } })
    k.reply('bruit')
    const e = h.call('hashFile', {})
    const eId = k.sent.at(-1)!.id
    k.reply({
      id: eId,
      ok: false,
      error: { code: 'provider_rate_limited', message: 'm', retryAt: 42 },
    })
    await expect(e).rejects.toMatchObject({
      code: 'provider_rate_limited',
      details: { retryAt: 42 },
    })
    const ok = h.call('hashFile', {})
    k.reply({ id: k.sent.at(-1)!.id, ok: true, result: { sha256: 'x', bytes: 1 } })
    await expect(ok).resolves.toEqual({ sha256: 'x', bytes: 1 })
    k.exit(0)
  })
})

describe('startup timeout', () => {
  it('live worker without hello → killed at the timeout, counted as a failed start; broken, requests rejected', async () => {
    let kills = 0
    const fork: ForkFn = () => {
      let exitCb: ((code: number | null, signal: string | null) => void) | undefined
      const child: WorkerChild = {
        pid: 1,
        postMessage: () => {},
        onMessage: () => {},
        onExit: (cb) => {
          exitCb = cb
        },
        kill: (sig) => {
          kills++
          queueMicrotask(() => exitCb?.(null, sig ?? 'SIGTERM'))
        },
      }
      return child
    }
    const crashes: CrashInfo[] = []
    const host = new WorkerHost({
      name: 'fake-bloque',
      modulePath: 'inutile.js',
      fork,
      backoffMs: [5],
      startTimeoutMs: 30,
      onCrash: (c) => crashes.push(c),
    })
    const err = await host.call('hashFile', { abs: '/x' }, { jobId: 3 }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'worker_unavailable', details: { jobId: 3 } })
    expect(host.state).toBe('broken')
    expect(kills).toBe(3)
    expect(crashes.at(-1)).toMatchObject({ broken: true, interrupted: [{ op: 'hashFile' }] })
    await expect(host.call('hashFile', { abs: '/x' })).rejects.toMatchObject({
      code: 'worker_unavailable',
    })
  })
})
