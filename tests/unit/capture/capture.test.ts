import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildArgs,
  dropFileName,
  isPngFile,
  runScreencapture,
} from '../../../src/main/capture/process'
import { createCaptureService, type CaptureDeps } from '../../../src/main/capture/service'
import {
  createShortcutManager,
  menuAccelerator,
  validateAccelerator,
} from '../../../src/main/capture/shortcut'
import { bundleOf, parseCodesign } from '../../../src/main/capture/signature'
import { REPO_ROOT } from '../../helpers/paths'

const FAKE = path.join(REPO_ROOT, 'tests/helpers/fake-bin/screencapture')
const dirs: string[] = []
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-capture-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  delete process.env.FAKE_SCREENCAPTURE_MODE
  delete process.env.FAKE_SCREENCAPTURE_SALT
})

describe('raccourci global', () => {
  it('validation : modificateur requis, ⌘Q/⌘W et ⇧⌘3/4/5 réservés', () => {
    expect(validateAccelerator('CommandOrControl+Shift+S')).toBe('ok')
    expect(validateAccelerator('Alt+Shift+K')).toBe('ok')
    expect(validateAccelerator('Shift+S')).toBe('invalid')
    expect(validateAccelerator('S')).toBe('invalid')
    expect(validateAccelerator('CommandOrControl+Q')).toBe('reserved')
    expect(validateAccelerator('CommandOrControl+W')).toBe('reserved')
    expect(validateAccelerator('CommandOrControl+Shift+4')).toBe('reserved')
  })

  it('register → false : ancien raccourci conservé et `taken`', () => {
    const active = new Set<string>()
    const gs = {
      register: vi.fn((a: string) => {
        if (a === 'CommandOrControl+Shift+K') return false
        active.add(a)
        return true
      }),
      unregister: vi.fn((a: string) => void active.delete(a)),
    }
    const m = createShortcutManager(gs)
    expect(m.set('CommandOrControl+Shift+S', () => undefined)).toEqual({ ok: true })
    expect(m.set('CommandOrControl+Shift+K', () => undefined)).toEqual({
      ok: false,
      error: 'taken',
    })
    expect(m.current).toBe('CommandOrControl+Shift+S')
    expect([...active]).toEqual(['CommandOrControl+Shift+S'])
    expect(m.set('CommandOrControl+Q', () => undefined)).toEqual({ ok: false, error: 'reserved' })
    expect(m.current).toBe('CommandOrControl+Shift+S')
  })

  it('anti-rebond 400 ms', () => {
    let fire: () => void = () => undefined
    let t = 1000
    const m = createShortcutManager(
      { register: (_a, cb) => ((fire = cb), true), unregister: () => undefined },
      () => t,
    )
    const spy = vi.fn()
    m.set('CommandOrControl+Shift+S', spy)
    fire()
    t += 100
    fire()
    t += 500
    fire()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('menu : accélérateur seulement si la touche imprimée correspond (AZERTY)', () => {
    expect(menuAccelerator('CommandOrControl+Shift+S', 'S')).toBe('CommandOrControl+Shift+S')
    // Touche imprimée « A » en AZERTY = position KeyQ → accélérateur …+Q : pas d'accélérateur de menu.
    expect(menuAccelerator('CommandOrControl+Shift+Q', 'A')).toBeUndefined()
  })
})

describe('screencapture', () => {
  it('arguments par mode', () => {
    expect(buildArgs('region', '/t/a.png')).toEqual(['-i', '-s', '-x', '-t', 'png', '/t/a.png'])
    expect(buildArgs('window', '/t/a.png')).toEqual([
      '-i',
      '-w',
      '-o',
      '-x',
      '-t',
      'png',
      '/t/a.png',
    ])
    expect(buildArgs('screen', '/t/a.png', 2)).toEqual(['-D', '2', '-x', '-t', 'png', '/t/a.png'])
  })
  it('nom du fichier de dépôt', () => {
    const d = new Date(2026, 9, 11, 14, 32, 7)
    expect(dropFileName(d)).toBe('Capture RecoltOS 2026-10-11 à 14.32.07.png')
    expect(dropFileName(d, 2)).toBe('Capture RecoltOS 2026-10-11 à 14.32.07 (2).png')
  })
  it('signature codesign', () => {
    expect(parseCodesign('Signature=adhoc\nTeamIdentifier=not set', 0)).toBe('adhoc')
    expect(parseCodesign('Authority=RecoltOS Local', 0)).toBe('identity')
    expect(parseCodesign('code object is not signed at all', 1)).toBe('unsigned')
    expect(bundleOf('/Applications/RecoltOS.app/Contents/MacOS/RecoltOS')).toBe(
      '/Applications/RecoltOS.app',
    )
  })
  it('faux binaire : PNG valide, Échap sans fichier', async () => {
    const d = tmp()
    const out = path.join(d, 'a.png')
    expect((await runScreencapture(FAKE, buildArgs('region', out))).code).toBe(0)
    expect(await isPngFile(out)).toBe(true)
    process.env.FAKE_SCREENCAPTURE_MODE = 'cancel'
    const out2 = path.join(d, 'b.png')
    await runScreencapture(FAKE, buildArgs('region', out2))
    expect(await isPngFile(out2)).toBe(false)
  })
})

function deps(over: Partial<CaptureDeps> = {}) {
  const d = tmp()
  const seen = new Map<string, string>()
  const calls = { run: 0, ingest: 0, notify: 0, permission: 0, done: [] as unknown[] }
  const window = { visible: true, hidden: 0, shown: 0 }
  const base: CaptureDeps = {
    prefs: () => ({
      mode: 'region',
      dropFolder: path.join(d, 'Bureau'),
      hideApp: true,
      copyToClipboard: false,
      notify: true,
      promptShown: true,
    }),
    access: () => ({ access: 'granted', raw: 'granted' }),
    provokePrompt: () => Promise.resolve(),
    markPromptShown: () => undefined,
    getWindow: () => ({
      isDestroyed: () => false,
      isVisible: () => window.visible,
      hide: () => {
        window.visible = false
        window.hidden++
      },
      showInactive: () => {
        window.visible = true
        window.shown++
      },
    }),
    bin: FAKE,
    run: (bin, args) => {
      calls.run++
      return runScreencapture(bin, args)
    },
    tmpDir: path.join(d, 'tmp-capture'),
    displayIndex: () => 1,
    clipboard: {
      hash: () => Promise.resolve(null),
      png: () => Promise.resolve(null),
      writeImage: () => Promise.resolve(),
    },
    ingest: (file) => {
      calls.ingest++
      const key = fs.readFileSync(file).toString('base64')
      const known = seen.get(key)
      if (known) return Promise.resolve({ status: 'duplicate', itemUuid: known })
      const uuid = `00000000-0000-4000-8000-${String(seen.size + 1).padStart(12, '0')}`
      seen.set(key, uuid)
      return Promise.resolve({ status: 'created', itemUuid: uuid })
    },
    notify: () => void calls.notify++,
    emitPermissionRequired: () => void calls.permission++,
    emitDone: (r) => void calls.done.push(r),
    now: () => new Date(2026, 9, 11, 14, 32, 7).getTime(),
    sleep: () => Promise.resolve(),
    ...over,
  }
  return { d, deps: base, calls, window }
}

describe('service de capture', () => {
  it('capture → élément → fichier de dépôt → capture.done ; fenêtre masquée puis restaurée', async () => {
    process.env.FAKE_SCREENCAPTURE_SALT = 'un'
    const { d, deps: dd, calls, window } = deps()
    const svc = createCaptureService(dd)
    const r = await svc.run({ trigger: 'button' })
    expect(r).toMatchObject({ status: 'ok' })
    expect(calls.ingest).toBe(1)
    const drop = path.join(d, 'Bureau', 'Capture RecoltOS 2026-10-11 à 14.32.07.png')
    expect(fs.existsSync(drop)).toBe(true)
    expect(r).toMatchObject({ dropPath: drop })
    expect(calls.done).toHaveLength(1)
    expect(window).toMatchObject({ hidden: 1, shown: 1, visible: true })
    // Temporaire supprimé.
    expect(fs.readdirSync(path.join(d, 'tmp-capture'))).toEqual([])
    // Même image : doublon, fichier de dépôt suffixé « (2) ».
    const r2 = await svc.run({ trigger: 'button' })
    expect(r2).toMatchObject({ status: 'ok', duplicate: true })
    expect(fs.existsSync(drop.replace('.png', ' (2).png'))).toBe(true)
  })

  it('Échap : `cancelled`, aucun élément', async () => {
    process.env.FAKE_SCREENCAPTURE_MODE = 'cancel'
    const { deps: dd, calls } = deps()
    expect(await createCaptureService(dd).run({ trigger: 'shortcut' })).toEqual({
      status: 'cancelled',
    })
    expect(calls.ingest).toBe(0)
  })

  it('⌃ pendant la sélection : image du presse-papiers ingérée (`viaClipboard`)', async () => {
    process.env.FAKE_SCREENCAPTURE_MODE = 'cancel'
    let h = 'avant'
    const png = fs.readFileSync(path.join(REPO_ROOT, 'build/icon.png'))
    const { deps: dd, calls } = deps({
      run: () => {
        h = 'après'
        return Promise.resolve({ code: 0, stderr: '' })
      },
      clipboard: {
        hash: () => Promise.resolve(h),
        png: () => Promise.resolve(png),
        writeImage: () => Promise.resolve(),
      },
    })
    const r = await createCaptureService(dd).run({ trigger: 'button' })
    expect(r).toMatchObject({ status: 'ok', viaClipboard: true })
    expect(calls.ingest).toBe(1)
  })

  it('permission non accordée : `permission-required`, screencapture jamais lancé', async () => {
    const prompted = vi.fn(() => Promise.resolve())
    const { deps: dd, calls } = deps({
      access: () => ({ access: 'denied', raw: 'denied' }),
      provokePrompt: prompted,
      prefs: () => ({
        mode: 'region',
        dropFolder: null,
        hideApp: true,
        copyToClipboard: false,
        notify: true,
        promptShown: false,
      }),
    })
    const r = await createCaptureService(dd).run({ trigger: 'shortcut' })
    expect(r).toEqual({ status: 'permission-required', access: 'denied' })
    expect(calls.run).toBe(0)
    expect(prompted).toHaveBeenCalledTimes(1)
    expect(calls.permission).toBe(1)
  })

  it('verrou : une seconde capture pendant la première → `busy`', async () => {
    let release: () => void = () => undefined
    const { deps: dd } = deps({
      run: () =>
        new Promise((r) => {
          release = () => r({ code: 1, stderr: '' })
        }),
    })
    const svc = createCaptureService(dd)
    const first = svc.run({ trigger: 'shortcut' })
    await new Promise((r) => setTimeout(r, 10))
    expect(await svc.run({ trigger: 'shortcut' })).toEqual({ status: 'busy' })
    release()
    expect(await first).toEqual({ status: 'cancelled' })
  })

  it('dossier de dépôt non inscriptible : capture réussie, erreur remontée', async () => {
    process.env.FAKE_SCREENCAPTURE_SALT = 'deux'
    const { deps: dd } = deps({
      prefs: () => ({
        mode: 'region',
        dropFolder: '/System/interdit-recolt',
        hideApp: false,
        copyToClipboard: false,
        notify: false,
        promptShown: true,
      }),
    })
    const svc = createCaptureService(dd)
    const r = await svc.run({ trigger: 'button' })
    expect(r.status).toBe('ok')
    expect(svc.lastDropError).toBeTruthy()
  })
})
