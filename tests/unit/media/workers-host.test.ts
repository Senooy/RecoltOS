/**
 * WP-03 — critère 5 : crash volontaire du worker → redémarrage avec backoff, job repassé en
 * `queued`. Plus : RPC de bout en bout avec le vrai `media.worker.ts`, erreurs sérialisées,
 * annulation, `stopAll()`.
 */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
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

/** File de jobs minimale en mémoire, branchée comme le fera WP-10 sur `onCrash`. */
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
          j.attempts-- // un crash du worker ne consomme pas de tentative
        }
      }
    },
  }
}

describe('media-worker réel (child_process + tsx)', () => {
  it('RPC hashFile / probeImage, erreurs typées sans crash du worker', async () => {
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
    // ffmpeg absent côté worker (configuration sans ffmpeg) → tool_missing, le worker survit.
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

  it('crash volontaire → redémarrage, job repassé en queued puis terminé', async () => {
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
    // Démarrage et premier appel normal.
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

    // La file relance le job : le worker a redémarré (nouveau pid) et répond.
    q.start(7)
    const r = await mw.call('hashFile', { abs: file }, { jobId: 7 })
    expect(r.sha256).toBe(expectedSha)
    q.jobs.get(7)!.state = 'done'
    expect(mw.host.restarts).toBe(1)
    expect(nf.children).toHaveLength(2)
    expect(mw.host.pid).not.toBe(firstPid)
    expect(mw.host.state).toBe('ready')
  }, 30_000)

  it('les requêtes émises pendant le redémarrage partent après, avec la configuration', async () => {
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
    // Émise pendant le backoff : attend le nouveau worker. La config (sans ffmpeg) est rejouée.
    const p = mw.call('makePoster', { src: file, dst: join(tmp.dir, 'p.jpg'), atMs: 0 })
    await expect(p).rejects.toMatchObject({ code: 'tool_missing' })
  }, 30_000)

  it('stopAll : arrêt propre, appels ultérieurs refusés', async () => {
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

/** Enfant factice piloté par le test (backoff, SIGKILL après délai, annulation). */
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

describe('WorkerHost (enfant factice)', () => {
  it('backoff 1 s, 5 s, 30 s puis 30 s ; remis à zéro après stabilité', async () => {
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

  it('stop : SIGTERM puis SIGKILL après 3 s si le worker ne sort pas', async () => {
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
      expect(ff.kids).toHaveLength(1) // pas de redémarrage après un arrêt demandé

      // Enfant qui ne signale jamais sa sortie : l'arrêt se termine quand même.
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

  it('annulation : rejet immédiat et __cancel envoyé ; progression relayée ; délai dépassé', async () => {
    const ff = fakeFork()
    const h = new WorkerHost({ name: 't', modulePath: '/x.js', fork: ff.fork, config: { a: 1 } })
    const ac = new AbortController()
    const progress: unknown[] = []
    const p = h.call('zipLibrary', {}, { signal: ac.signal, onProgress: (x) => progress.push(x) })
    const k = ff.kids[0]!
    expect(k.sent).toEqual([]) // pas encore prêt
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
    // Réponses tardives ou inconnues ignorées sans erreur.
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
