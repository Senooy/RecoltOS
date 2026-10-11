import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../src/shared/errors'
import { pathToFileURL } from 'node:url'
import { dispatch, makeSenderCheck, type AllHandlers } from '../../../src/main/ipc/router'

const U = '0decd148-5f3c-4d7a-9b1e-2a3b4c5d6e7f'
const counts = { all: 3, saved: 1, unsorted: 2, trash: 0, hidden: 0 }

describe('dispatch', () => {
  it('canal inconnu', async () => {
    const r = await dispatch('nope.nope', {}, {}, { handlers: {}, validateOutput: true })
    expect(r).toMatchObject({ ok: false, error: { code: 'unknown_channel' } })
    const r2 = await dispatch(42, {}, {}, { handlers: {}, validateOutput: true })
    expect(r2).toMatchObject({ ok: false, error: { code: 'unknown_channel' } })
  })

  it('valide l’entrée avant le handler et passe les défauts appliqués', async () => {
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

  it('valide la sortie en dev', async () => {
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

  it('convertit AppError et erreurs inconnues en { code, message }', async () => {
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
  it('dev : même origine que le serveur Vite', () => {
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
  it('prod : uniquement index.html du renderer', () => {
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
  it('prod : chemins contenant ~, [, ], espace ou accents (Node encode, Chromium non)', () => {
    for (const dir of ['/rv/proj~old/out', "/Mes Projets é'[x]/out", '/a/[b]/~c']) {
      const indexPath = `${dir}/renderer/index.html`
      const check = makeSenderCheck({ rendererUrl: null, rendererIndexPath: indexPath })
      // Forme Node (encodée) et forme Chromium (caractères laissés tels quels).
      expect(check(pathToFileURL(indexPath).toString())).toBe(true)
      expect(check(`file://${indexPath}`)).toBe(true)
      expect(check(`file://${indexPath}?x=1#/y`)).toBe(true)
      expect(check(`file://${dir}/renderer/offscreen.html`)).toBe(false)
    }
  })
})

describe('messages d’erreur en français (règle §2.6)', () => {
  it('aucun « at » anglais dans error.message, ni pour l’entrée ni pour la sortie', async () => {
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
