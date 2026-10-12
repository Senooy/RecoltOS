/**
 * `scripts/guard-data.sh`: run in a disposable git repo (under .tmp/), never in the real one.
 * The forbidden literals are assembled at runtime so that this file does not flag itself.
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
  it('passes on a clean repository', () => {
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
    // APFS is case-insensitive: `DATA.DB` is the same file as `data.db`.
    'DATA.DB',
    'a.Db-Wal',
    'Prefs.JSON',
  ])('fails if %s is tracked by git', (rel) => {
    const dir = repo()
    add(dir, rel, 'x')
    const r = guard(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(rel)
  })

  it.each(['.env', 'config/.env.local', 'cert/dev.pem', 'signing.p12', 'AuthKey.p8', 'ext.key'])(
    'fails if the secret %s is tracked by git',
    (rel) => {
      const dir = repo()
      add(dir, rel, 'x')
      const r = guard(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain(rel)
    },
  )

  it('fails if a PEM private key appears in the tracked content', () => {
    const dir = repo()
    add(dir, 'src/leak.ts', `const k = \`${PEM}\nMIIE\n\`\n`)
    const r = guard(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('src/leak.ts')
  })

  it('fails beyond 2 MB outside the allowlist', () => {
    const dir = repo()
    add(dir, 'assets/gros.bin', Buffer.alloc(2 * 1024 * 1024 + 1))
    const r = guard(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('assets/gros.bin')
  })

  describe('fail closed (never "OK" if git is unusable)', () => {
    it('outside a git repo: fails, even with a *.db present', () => {
      // Under .tmp/ of the test repo: git would walk up to the parent repo if the root were not checked.
      const dir = makeTmpDir('guard-nogit')
      writeFileSync(join(dir, 'a.db'), 'x')
      const r = guard(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).not.toContain('OK')
      expect(r.stderr).toContain('git repository')
    })

    it('subfolder of a git repo (not its root): fails', () => {
      const dir = repo()
      mkdirSync(join(dir, 'sub'))
      const r = guard(join(dir, 'sub'))
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('not the root')
    })

    it('git unusable (invalid GIT_DIR): fails', () => {
      const r = spawnSync('sh', [SCRIPT], {
        env: { ...process.env, GUARD_ROOT: repo(), GIT_DIR: '/nonexistent/.git' },
        encoding: 'utf8',
      })
      expect(r.status).toBe(1)
      expect(r.stdout).not.toContain('OK')
    })

    it('corrupt git index (git ls-files fails): fails', () => {
      const dir = repo()
      writeFileSync(join(dir, '.git/index'), 'pas un index git')
      const r = guard(dir)
      expect(r.status).toBe(1)
      expect(r.stdout).not.toContain('OK')
    })

    /** Fake `git` at the head of PATH: delegates to the real one except for the given subcommand. */
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

    it('git grep error (code 2): fails instead of concluding "no result"', () => {
      const r = withBrokenSubcommand(repo(), 'grep', 2)
      expect(r.status).toBe(1)
      expect(r.stdout).not.toContain('OK')
      expect(r.stderr).toContain('git grep')
    })

    it('git grep with no result (code 1) remains a success', () => {
      const r = withBrokenSubcommand(repo(), 'grep', 1)
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain('OK')
    })
  })

  it('passes on the real repo', () => {
    const r = spawnSync('sh', [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
  })
})
