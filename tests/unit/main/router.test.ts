import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../src/shared/errors'
import { pathToFileURL } from 'node:url'
import { dispatch, makeSenderCheck, type AllHandlers } from '../../../src/main/ipc/router'

const U = '0decd148-5f3c-4d7a-9b1e-2a3b4c5d6e7f'
const counts = { all: 3, saved: 1, unsorted: 2, trash: 0, hidden: 0 }

describe('dispatch', () => {
  it('unknown channel', async () => {
    const r = await dispatch('nope.nope', {}, {}, { handlers: {}, validateOutput: true })
    expect(r).toMatchObject({ ok: false, error: { code: 'unknown_channel' } })
    const r2 = await dispatch(42, {}, {}, { handlers: {}, validateOutput: true })
    expect(r2).toMatchObject({ ok: false, error: { code: 'unknown_channel' } })
  })

  it('validates the input before the handler and passes the applied defaults', async () => {
    const list = vi.fn(() => ({ items: [], nextCursor: null, total: 0 }))
    const handlers: Partial<AllHandlers> = { 'items.list': list }
    const bad = await dispatch(
      'items.list',
      { scope: 'library', limit: 9999 },
      {},
      { handlers, validateOutput: true },
    )
    expect(bad).toMatchObject({ ok: false, error: { code: 'validation' } })
    expect(list).not.toHaveBeenCalled()
    const good = await dispatch(
      'items.list',
      { scope: 'library' },
      {},
      { handlers, validateOutput: true },
    )
    expect(good).toEqual({ ok: true, data: { items: [], nextCursor: null, total: 0 } })
    expect(list).toHaveBeenCalledWith(
      { scope: 'library', tab: 'all', sort: 'recent', cursor: null, limit: 120 },
      {},
    )
  })

  it('validates the output in dev', async () => {
    const handlers = {
      'items.counts': () => ({ ...counts, all: 'trois' }),
    } as unknown as Partial<AllHandlers>
    const r = await dispatch('items.counts', {}, {}, { handlers, validateOutput: true })
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid_output' } })
    const r2 = await dispatch('items.counts', {}, {}, { handlers, validateOutput: false })
    expect(r2.ok).toBe(true)
    const ok = await dispatch(
      'items.counts',
      undefined,
      {},
      {
        handlers: { 'items.counts': () => counts },
        validateOutput: true,
      },
    )
    expect(ok).toEqual({ ok: true, data: counts })
  })

  it('converts AppError and unknown errors into { code, message }', async () => {
    const onError = vi.fn()
    const r = await dispatch(
      'items.get',
      { uuid: U },
      {},
      {
        handlers: {
          'items.get': () => {
            throw new AppError('not_found', 'élément introuvable')
          },
        },
        validateOutput: true,
        onError,
      },
    )
    expect(r).toEqual({ ok: false, error: { code: 'not_found', message: 'élément introuvable' } })
    const r2 = await dispatch(
      'items.get',
      { uuid: U },
      {},
      {
        handlers: {
          'items.get': () => {
            throw new Error('panne')
          },
        },
        validateOutput: true,
        onError,
      },
    )
    expect(r2).toEqual({ ok: false, error: { code: 'internal', message: 'panne' } })
    expect(onError).toHaveBeenCalledTimes(2)
  })
})

describe('makeSenderCheck', () => {
  it('dev: same origin as the Vite server', () => {
    const check = makeSenderCheck({
      rendererUrl: 'http://localhost:5173',
      rendererIndexPath: '/x/index.html',
    })
    expect(check('http://localhost:5173/')).toBe(true)
    expect(check('http://localhost:5173/offscreen.html')).toBe(true)
    expect(check('http://localhost:5174/')).toBe(false)
    expect(check('https://evil.example/')).toBe(false)
    expect(check(undefined)).toBe(false)
  })
  it('prod: only the renderer index.html', () => {
    const check = makeSenderCheck({
      rendererUrl: null,
      rendererIndexPath: '/app/out/renderer/index.html',
    })
    expect(check('file:///app/out/renderer/index.html')).toBe(true)
    expect(check('file:///app/out/renderer/index.html#/x')).toBe(true)
    expect(check('file:///app/out/renderer/offscreen.html')).toBe(false)
    expect(check('file:///tmp/evil.html')).toBe(false)
    expect(check('https://app/out/renderer/index.html')).toBe(false)
    expect(check('file:///app/out/renderer/index.html/../offscreen.html')).toBe(false)
  })
  it('prod: paths containing ~, [, ], space or accents (Node encodes, Chromium does not)', () => {
    for (const dir of ['/rv/proj~old/out', "/Mes Projets é'[x]/out", '/a/[b]/~c']) {
      const indexPath = `${dir}/renderer/index.html`
      const check = makeSenderCheck({ rendererUrl: null, rendererIndexPath: indexPath })
      // Node form (encoded) and Chromium form (characters left as they are).
      expect(check(pathToFileURL(indexPath).toString())).toBe(true)
      expect(check(`file://${indexPath}`)).toBe(true)
      expect(check(`file://${indexPath}?x=1#/y`)).toBe(true)
      expect(check(`file://${dir}/renderer/offscreen.html`)).toBe(false)
    }
  })
})

describe('error messages in French', () => {
  it('no English "at" in error.message, neither for the input nor for the output', async () => {
    const bad = await dispatch(
      'items.list',
      { scope: 'nope' },
      {},
      { handlers: {}, validateOutput: false },
    )
    const badPatch = await dispatch(
      'prefs.set',
      { patch: { ai: { provider: 'x' } } },
      {},
      { handlers: {}, validateOutput: false },
    )
    const badOutput = await dispatch(
      'items.counts',
      {},
      {},
      { handlers: { 'items.counts': () => ({ count: 'x' }) } as never, validateOutput: true },
    )
    for (const r of [bad, badPatch, badOutput]) {
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error.message).not.toMatch(/\bat\b/)
        expect(r.error.message).not.toMatch(/Invalid|expected/)
      }
    }
  })
})
