/**
 * WP-03 — `platform/` : résolution des binaires (PLAN §1.16), shell de login (ARCHI §2.6),
 * détection de processus (`pgrep -x`), Corbeille macOS.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  SIPS_PATH,
  mediaToolsOf,
  resolveBinaries,
  toolsPrefsPatch,
  videoToolsMissing,
} from '../../../src/main/platform/binaries'
import {
  loginShellScript,
  parseLoginShellOutput,
  readLoginShellEnv,
} from '../../../src/main/platform/login-shell-env'
import {
  isGatherOSRunning,
  isProcessRunning,
  isSafeProcessName,
} from '../../../src/main/platform/process-check'
import { moveToTrash } from '../../../src/main/platform/trash'
import { DEFAULT_PREFS } from '../../../src/shared/prefs'
import { makeTmp } from './helpers'

const tmp = makeTmp()
afterAll(() => tmp.cleanup())

describe('resolveBinaries', () => {
  const execSet = (paths: string[]) => (p: string) => Promise.resolve(paths.includes(p))

  it('ordre : prefs.tools → /opt/homebrew/bin → /usr/local/bin → shell de login', async () => {
    let shellCalls = 0
    const bins = await resolveBinaries(
      { tools: { ffmpeg: '/custom/ffmpeg', ffprobe: '/custom/absent' } },
      {
        isExecutable: execSet([
          '/custom/ffmpeg',
          '/opt/homebrew/bin/ffmpeg',
          '/usr/local/bin/ffprobe',
          '/Users/u/.hermes/node/bin/claude',
        ]),
        loginShell: () => {
          shellCalls++
          return Promise.resolve({
            path: '/x',
            tools: { claude: '/Users/u/.hermes/node/bin/claude', codex: '/nope/codex' },
          })
        },
      },
    )
    expect(bins).toEqual({
      sips: SIPS_PATH,
      ffmpeg: '/custom/ffmpeg',
      ffprobe: '/usr/local/bin/ffprobe',
      claude: '/Users/u/.hermes/node/bin/claude',
    })
    expect(shellCalls).toBe(1)
    expect(toolsPrefsPatch(bins)).toEqual({
      ffmpeg: '/custom/ffmpeg',
      ffprobe: '/usr/local/bin/ffprobe',
      claude: '/Users/u/.hermes/node/bin/claude',
    })
    expect(mediaToolsOf(bins)).toEqual({
      sips: SIPS_PATH,
      ffmpeg: '/custom/ffmpeg',
      ffprobe: '/usr/local/bin/ffprobe',
    })
  })

  it('tout trouvé sans shell de login ; ffmpeg absent = mode dégradé', async () => {
    let shellCalls = 0
    const all = await resolveBinaries(DEFAULT_PREFS, {
      isExecutable: execSet(
        ['ffmpeg', 'ffprobe', 'claude', 'codex'].map((b) => `/opt/homebrew/bin/${b}`),
      ),
      loginShell: () => {
        shellCalls++
        return Promise.resolve({ path: null, tools: {} })
      },
    })
    expect(shellCalls).toBe(0)
    expect(videoToolsMissing(all)).toBe(false)

    const none = await resolveBinaries(DEFAULT_PREFS, {
      isExecutable: execSet([]),
      loginShell: () => Promise.reject(new Error('zsh absent')),
    })
    expect(none).toEqual({ sips: SIPS_PATH })
    expect(videoToolsMissing(none)).toBe(true)
  })

  it('vrai système : sips toujours /usr/bin/sips ; chemin de prefs non exécutable ignoré', async () => {
    const notExec = join(tmp.dir, 'ffmpeg')
    writeFileSync(notExec, '#!/bin/sh\n', { mode: 0o644 })
    const bins = await resolveBinaries(
      { tools: { ffmpeg: notExec, sips: '/etc/hosts' } },
      { loginShell: () => Promise.resolve({ path: null, tools: {} }) },
    )
    expect(bins.sips).toBe('/usr/bin/sips')
    expect(bins.ffmpeg).not.toBe(notExec)
    if (existsSync('/opt/homebrew/bin/ffmpeg')) expect(bins.ffmpeg).toBe('/opt/homebrew/bin/ffmpeg')
  })
})

describe('login-shell-env', () => {
  it('lignes balisées, bruit de .zshrc ignoré, outils absents ou alias écartés', () => {
    const out = [
      'Bienvenue ! oh-my-zsh',
      '\u001b]0;titre\u0007__RECOLT__PATH=/opt/homebrew/bin:/usr/bin:/bin',
      '__RECOLT__claude=/Users/u/.hermes/node/bin/claude',
      '__RECOLT__codex=',
      '__RECOLT__ffmpeg=ffmpeg: aliased to ffmpeg -hide_banner',
      '__RECOLT__ffprobe=/opt/homebrew/bin/ffprobe',
      '__RECOLT__evil=/bin/sh',
    ].join('\n')
    expect(parseLoginShellOutput(out)).toEqual({
      path: '/opt/homebrew/bin:/usr/bin:/bin',
      tools: { claude: '/Users/u/.hermes/node/bin/claude', ffprobe: '/opt/homebrew/bin/ffprobe' },
    })
  })

  it('script : PATH puis une ligne par outil', () => {
    const s = loginShellScript()
    expect(s).toContain('"$PATH"')
    for (const t of ['claude', 'codex', 'ffmpeg', 'ffprobe']) expect(s).toContain(`command -v ${t}`)
  })

  it('délai dépassé ou échec → résultat vide, jamais d’exception', async () => {
    const args: unknown[] = []
    const r = await readLoginShellEnv({
      timeoutMs: 5_000,
      spawnShell: (shell, a, t) => {
        args.push(shell, a, t)
        return Promise.resolve({ stdout: '', timedOut: true })
      },
    })
    expect(r).toEqual({ path: null, tools: {} })
    expect(args[0]).toBe('/bin/zsh')
    expect((args[1] as string[])[0]).toBe('-lic')
    expect(args[2]).toBe(5_000)
    expect(
      await readLoginShellEnv({ spawnShell: () => Promise.reject(new Error('boom')) }),
    ).toEqual({ path: null, tools: {} })
  })

  it('le délai est une vraie borne : un petit-enfant qui garde stdout ouvert ne bloque pas', async () => {
    const dir = join(tmp.dir, 'shells')
    mkdirSync(dir, { recursive: true })
    const pidFile = join(dir, 'pid')
    const fake = join(dir, 'slow-shell.sh')
    writeFileSync(fake, `#!/bin/sh\nsleep 30 &\necho $! > '${pidFile}'\nsleep 30\n`)
    chmodSync(fake, 0o755)
    const t0 = Date.now()
    const r = await readLoginShellEnv({ shell: fake, timeoutMs: 500 })
    expect(Date.now() - t0).toBeLessThan(1_500)
    expect(r).toEqual({ path: null, tools: {} })
    // Pas d'orphelin : le groupe entier a été tué.
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    let alive = true
    for (let i = 0; i < 30 && alive; i++) {
      try {
        process.kill(pid, 0)
        await new Promise((res) => setTimeout(res, 100))
      } catch {
        alive = false
      }
    }
    expect(alive).toBe(false)
  }, 10_000)

  it('shell terminé mais stdout retenu par un démon : résultat rendu juste après la sortie', async () => {
    const dir = join(tmp.dir, 'shells')
    mkdirSync(dir, { recursive: true })
    const fake = join(dir, 'daemon-shell.sh')
    writeFileSync(
      fake,
      "#!/bin/sh\n(sleep 3) &\nprintf '__RECOLT__PATH=/opt/x/bin:/usr/bin\\n__RECOLT__ffmpeg=/opt/x/bin/ffmpeg\\n'\n",
    )
    chmodSync(fake, 0o755)
    const t0 = Date.now()
    const r = await readLoginShellEnv({ shell: fake, timeoutMs: 5_000 })
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(r.path).toBe('/opt/x/bin:/usr/bin')
    expect(r.tools.ffmpeg).toBe('/opt/x/bin/ffmpeg')
  }, 10_000)

  it('vrai /bin/zsh -lic (5 s max) : PATH lu', async () => {
    const t0 = Date.now()
    const r = await readLoginShellEnv({ shell: '/bin/zsh' })
    expect(Date.now() - t0).toBeLessThan(6_500)
    if (r.path !== null) expect(r.path).toContain('/usr/bin')
    for (const v of Object.values(r.tools)) expect(v.startsWith('/')).toBe(true)
  }, 10_000)
})

describe('process-check', () => {
  it('pgrep -x : 0 → vrai, 1 → faux, autre → erreur', async () => {
    const calls: unknown[] = []
    const exec = (code: number) => (cmd: string, args: readonly string[]) => {
      calls.push([cmd, args])
      return Promise.resolve({ code, stdout: '' })
    }
    expect(await isProcessRunning('GatherOS', exec(0))).toBe(true)
    expect(await isProcessRunning('GatherOS', exec(1))).toBe(false)
    await expect(isProcessRunning('GatherOS', exec(3))).rejects.toThrow()
    expect(calls[0]).toEqual(['/usr/bin/pgrep', ['-x', 'GatherOS']])
    expect(await isGatherOSRunning(exec(1))).toBe(false)
  })

  it('noms refusés (option, motif, vide)', async () => {
    for (const bad of ['', '-f', 'a|b', '.*', 'x'.repeat(80), 'a\nb']) {
      expect(isSafeProcessName(bad)).toBe(false)
    }
    await expect(isProcessRunning('-f')).rejects.toThrow()
  })

  it('vrai pgrep : node (ce processus) tourne, un nom improbable non', async () => {
    expect(await isProcessRunning('node')).toBe(true)
    expect(await isProcessRunning('recolt-inexistant-42')).toBe(false)
  })
})

describe('trash', () => {
  it('présents → corbeille ; absents → missing ; échec → failed ; relatifs refusés', async () => {
    const dir = join(tmp.dir, 'trash')
    mkdirSync(dir)
    const a = join(dir, 'a.jpg')
    const b = join(dir, 'b.jpg')
    writeFileSync(a, 'a')
    writeFileSync(b, 'b')
    const trashed: string[] = []
    const r = await moveToTrash([a, join(dir, 'absent.jpg'), b, 'relatif.jpg'], (p) => {
      if (p === b) return Promise.reject(new Error('refusé'))
      trashed.push(p)
      return Promise.resolve()
    })
    expect(trashed).toEqual([a])
    expect(r.trashed).toEqual([a])
    expect(r.missing).toEqual([join(dir, 'absent.jpg')])
    expect(r.failed).toEqual([
      { path: b, message: 'refusé' },
      { path: 'relatif.jpg', message: 'chemin absolu attendu' },
    ])
  })
})

describe('trash : erreurs de lstat', () => {
  it('EACCES (dossier parent sans droit de parcours) → failed, pas missing', async () => {
    if (process.getuid?.() === 0) return // root traverse les dossiers : pas de EACCES à produire
    const dir = join(tmp.dir, 'locked')
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'secret.jpg')
    writeFileSync(target, 'x')
    chmodSync(dir, 0o000)
    try {
      const trashed: string[] = []
      const r = await moveToTrash([target], (p) => {
        trashed.push(p)
        return Promise.resolve()
      })
      expect(r.missing).toEqual([])
      expect(r.trashed).toEqual([])
      expect(trashed).toEqual([])
      expect(r.failed).toHaveLength(1)
      expect(r.failed[0]!.path).toBe(target)
      expect(r.failed[0]!.message).toMatch(/EACCES/)
    } finally {
      chmodSync(dir, 0o755)
    }
  })
})
