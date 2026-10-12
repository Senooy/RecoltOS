/**
 * `scripts/guard-data.sh` : exécuté dans un dépôt git jetable (sous .tmp/), jamais dans le vrai.
 * Les littéraux interdits sont assemblés à l'exécution pour que ce fichier ne se dénonce pas lui-même.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './paths'
import { makeTmpDir } from './tmpdir'

const SCRIPT = join(REPO_ROOT, 'scripts/guard-data.sh')
const PEM = '-----BEGIN PRIVATE' + ' KEY-----'

function repo(): string {
  const dir = makeTmpDir('guard')
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.test')
  git('config', 'user.name', 'Test')
  writeFileSync(join(dir, 'ok.ts'), 'export const a = 1\n')
  git('add', '.')
  return dir
}

function add(dir: string, rel: string, content: string | Buffer): void {
  mkdirSync(join(dir, rel, '..'), { recursive: true })
  writeFileSync(join(dir, rel), content)
  execFileSync('git', ['add', '-f', rel], { cwd: dir, stdio: 'ignore' })
}

function guard(dir: string) {
  return spawnSync('sh', [SCRIPT], { env: { ...process.env, GUARD_ROOT: dir }, encoding: 'utf8' })
}

describe('guard-data.sh', () => {
  it('passe sur un dépôt propre', () => {
    const r = guard(repo())
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('OK')
  })

  it.each([
    'library/moodmark.db',
    'x/recolt.db-wal',
    'a.db-shm',
    'x.db-journal',
    'prefs.json',
    'data.sqlite',
    'library/recolt.sqlite3',
    'userdata/window-state.json',
    'Window-State.JSON',
    // APFS ne distingue pas la casse : `DATA.DB` est le même fichier que `data.db`.
    'DATA.DB',
    'a.Db-Wal',
    'Prefs.JSON',
  ])('échoue si %s est suivi par git', (rel) => {
    const dir = repo()
    add(dir, rel, 'x')
    const r = guard(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(rel)
  })

  it.each(['.env', 'config/.env.local', 'cert/dev.pem', 'signing.p12', 'AuthKey.p8', 'ext.key'])(
    'échoue si le secret %s est suivi par git',
    (rel) => {
      const dir = repo()
      add(dir, rel, 'x')
      const r = guard(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain(rel)
    },
  )

  it('échoue si une clé privée PEM apparaît dans le contenu suivi', () => {
    const dir = repo()
    add(dir, 'src/leak.ts', `const k = \`${PEM}\nMIIE\n\`\n`)
    const r = guard(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('src/leak.ts')
  })

  it('échoue au-delà de 2 Mo hors liste blanche', () => {
    const dir = repo()
    add(dir, 'assets/gros.bin', Buffer.alloc(2 * 1024 * 1024 + 1))
    const r = guard(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('assets/gros.bin')
  })

  describe('échec fermé (jamais « OK » si git est inutilisable)', () => {
    it('hors dépôt git : échoue, même avec un *.db présent', () => {
      // Sous .tmp/ du dépôt de test : git remonterait au dépôt parent si la racine n'était pas contrôlée.
      const dir = makeTmpDir('guard-nogit')
      writeFileSync(join(dir, 'a.db'), 'x')
      const r = guard(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).not.toContain('OK')
      expect(r.stderr).toContain('dépôt git')
    })

    it('sous-dossier d’un dépôt git (pas sa racine) : échoue', () => {
      const dir = repo()
      mkdirSync(join(dir, 'sub'))
      const r = guard(join(dir, 'sub'))
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('racine')
    })

    it('git inutilisable (GIT_DIR invalide) : échoue', () => {
      const r = spawnSync('sh', [SCRIPT], {
        env: { ...process.env, GUARD_ROOT: repo(), GIT_DIR: '/nonexistent/.git' },
        encoding: 'utf8',
      })
      expect(r.status).toBe(1)
      expect(r.stdout).not.toContain('OK')
    })

    it('index git corrompu (git ls-files échoue) : échoue', () => {
      const dir = repo()
      writeFileSync(join(dir, '.git/index'), 'pas un index git')
      const r = guard(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).not.toContain('OK')
    })

    /** Faux `git` en tête du PATH : délègue au vrai sauf pour la sous-commande donnée. */
    function withBrokenSubcommand(dir: string, sub: string, code: number) {
      const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
      const bin = makeTmpDir('guard-fakegit')
      const fake = join(bin, 'git')
      writeFileSync(
        fake,
        `#!/bin/sh\nif [ "$1" = "${sub}" ]; then exit ${code}; fi\nexec "${real}" "$@"\n`,
      )
      chmodSync(fake, 0o755)
      return spawnSync('sh', [SCRIPT], {
        env: { ...process.env, GUARD_ROOT: dir, PATH: `${bin}:${process.env.PATH ?? ''}` },
        encoding: 'utf8',
      })
    }

    it('git grep en erreur (code 2) : échoue au lieu de conclure « aucun résultat »', () => {
      const r = withBrokenSubcommand(repo(), 'grep', 2)
      expect(r.status).toBe(1)
      expect(r.stdout).not.toContain('OK')
      expect(r.stderr).toContain('git grep')
    })

    it('git grep sans résultat (code 1) reste un succès', () => {
      const r = withBrokenSubcommand(repo(), 'grep', 1)
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain('OK')
    })
  })

  it('passe sur le dépôt réel', () => {
    const r = spawnSync('sh', [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
  })
})
