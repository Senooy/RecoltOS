import { describe, expect, it, vi } from 'vitest'
import { makeTmpDir } from '../../helpers/tmpdir'
import { AppError } from '../../../src/shared/errors'
import { CHANNELS, DOMAINS, domainOf } from '../../../src/shared/ipc'
import { JOB_TYPES, type JobRecord } from '../../../src/shared/jobs'
import { SERVICES, SERVICE_DOMAINS, initServices } from '../../../src/main/bootstrap/services'
import type { ServiceContext } from '../../../src/main/bootstrap/context'
import { handlers, handlersByDomain } from '../../../src/main/ipc/handlers'
import { jobHandlers } from '../../../src/main/jobs/handlers'
import { dispatch } from '../../../src/main/ipc/router'

/** Domaines IPC déjà implémentés (les autres sont encore des stubs `not_implemented`). */
const IMPLEMENTED_DOMAINS: readonly string[] = ['prefs', 'libraries']

function fakeCtx(userData: string = makeTmpDir('recolt-registries-')): ServiceContext {
  return {
    userData,
    flags: { e2e: true, windowSize: null, home: null, rendererUrl: null, installDevHost: false },
    isPackaged: false,
    getMainWindow: () => null,
    emit: () => undefined,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
}

describe('registre des handlers IPC', () => {
  it('un fichier de handlers par domaine figé', () => {
    expect(Object.keys(handlersByDomain).sort()).toEqual([...DOMAINS].sort())
  })

  it('chaque canal du contrat a un handler ; les domaines encore en stub lèvent not_implemented', async () => {
    expect(Object.keys(handlers).sort()).toEqual([...CHANNELS].sort())
    for (const ch of CHANNELS) {
      const domainHandlers = handlersByDomain[
        domainOf(ch) as keyof typeof handlersByDomain
      ] as Record<string, (i: unknown, c: object) => unknown>
      const h = domainHandlers[ch]
      expect(h, ch).toBeTypeOf('function')
      if (IMPLEMENTED_DOMAINS.includes(domainOf(ch))) continue
      let err: unknown
      try {
        await h?.({}, {})
      } catch (e) {
        err = e
      }
      expect(err, ch).toBeInstanceOf(AppError)
      expect((err as AppError).code, ch).toBe('not_implemented')
    }
  })

  it('via dispatch, un canal stub renvoie { ok:false, code:not_implemented }', async () => {
    const r = await dispatch('items.counts', {}, {}, { handlers, validateOutput: true })
    expect(r).toEqual({
      ok: false,
      error: { code: 'not_implemented', message: "items.counts n'est pas encore implémenté" },
    })
  })
})

describe('registre des jobs', () => {
  it('table type → handler complète, stubs not_implemented', async () => {
    expect(Object.keys(jobHandlers).sort()).toEqual([...JOB_TYPES].sort())
    for (const t of JOB_TYPES) {
      const job = { id: 1, type: t } as JobRecord
      await expect(
        jobHandlers[t](job, { signal: new AbortController().signal, now: () => 0 }),
      ).rejects.toMatchObject({ code: 'not_implemented' })
    }
  })
})

describe('registre des services', () => {
  it('services.ts référence chaque init<Domaine>() dans l’ordre figé, sans embed', () => {
    expect(SERVICES.map((s) => s.domain)).toEqual([...SERVICE_DOMAINS])
    expect(SERVICE_DOMAINS).not.toContain('embed')
    for (const s of SERVICES) expect(s.init).toBeTypeOf('function')
  })

  it('initServices appelle chaque init dans l’ordre, isole les échecs et libère en sens inverse', async () => {
    const calls: string[] = []
    const registry = SERVICE_DOMAINS.map((domain) => ({
      domain,
      init: () => {
        calls.push(`init:${domain}`)
        if (domain === 'jobs') throw new Error('boum')
        return () => {
          calls.push(`dispose:${domain}`)
        }
      },
    }))
    const ctx = fakeCtx()
    const h = await initServices(ctx, registry)
    expect(calls).toEqual(SERVICE_DOMAINS.map((d) => `init:${d}`))
    expect(h.failed.map((f) => f.domain)).toEqual(['jobs'])
    expect(h.started).toHaveLength(SERVICE_DOMAINS.length - 1)
    calls.length = 0
    await h.dispose()
    expect(calls).toEqual(
      SERVICE_DOMAINS.filter((d) => d !== 'jobs')
        .reverse()
        .map((d) => `dispose:${d}`),
    )
  })

  it('le registre réel démarre sans erreur (stubs)', async () => {
    const h = await initServices(fakeCtx())
    try {
      expect(h.failed).toEqual([])
      expect(h.started).toEqual([...SERVICE_DOMAINS])
    } finally {
      await h.dispose()
    }
  })
})
