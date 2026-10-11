/**
 * WP-03 — critère 5 : crash volontaire du worker → redémarrage avec backoff, job repassé en
 * `queued`. Plus : RPC de bout en bout avec le vrai `media.worker.ts`, erreurs sérialisées,
 * annulation, `stopAll()`.
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

  it('zipLibrary avec une source illisible : erreur typée, worker vivant, aucun .part', async () => {
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

  it('module qui lève au chargement (enfant réel) → broken, appel rejeté, pas de boucle', async () => {
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

  it('sorties répétées sans hello → broken : requêtes rejetées (worker_unavailable), plus de boucle', async () => {
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
        ff.kids.at(-1)!.exit(1) // sort sans avoir dit hello
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
      // Un seul signal « broken », avec les requêtes (jobId) à échouer côté file de jobs.
      const last = crashes.at(-1)!
      expect(last.broken).toBe(true)
      expect(last.restartInMs).toBe(0)
      expect(last.interrupted.map((i) => i.jobId)).toEqual([7, undefined])
      expect(crashes.slice(0, -1).every((c) => !c.broken && c.interrupted.length === 0)).toBe(true)
      // Plus aucun redémarrage automatique, et les appels suivants échouent tout de suite.
      await vi.advanceTimersByTimeAsync(120_000)
      expect(ff.kids).toHaveLength(3)
      await expect(h.call('hashFile', { abs: '/c' }, { jobId: 9 })).rejects.toMatchObject({
        code: 'worker_unavailable',
        details: { jobId: 9 },
      })
      // restart() explicite : le worker repart et sert de nouveau.
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

  it('un hello suffit à remettre le compteur de démarrages ratés à zéro', async () => {
    vi.useFakeTimers()
    try {
      const ff = fakeFork()
      const h = new WorkerHost({ name: 't', modulePath: '/x.js', fork: ff.fork })
      h.start()
      for (let i = 0; i < 6; i++) {
        const k = ff.kids.at(-1)!
        if (i % 2 === 1) k.reply({ ready: true, pid: k.child.pid }) // un démarrage sur deux réussit
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

  it('stop pendant le démarrage : hello ignoré, SIGTERM renvoyé, aucun redémarrage', async () => {
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
      // `hello` arrive après le stop (kill sans effet avant le spawn, cas Electron).
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

      // Même scénario, l'enfant ne signale jamais sa sortie : le filet finalise l'arrêt.
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
      // Sortie tardive après le filet : ignorée, pas de redémarrage.
      k2.exit(null, 'SIGKILL')
      await vi.advanceTimersByTimeAsync(100)
      expect(h2.state).toBe('stopped')
      expect(ff.kids).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop avant hello puis sortie : pas de crash signalé ni de redémarrage (enfant réel)', async () => {
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

describe('délai de démarrage', () => {
  it('worker vivant sans hello → tué au délai, compté comme démarrage raté ; broken, requêtes rejetées', async () => {
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
