import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildExt } from '../../scripts/build-ext.mjs'
import { buildHost, externalRequires } from '../../scripts/build-host.mjs'
import { REPO_ROOT } from './paths'
import { makeTmpDir } from './tmpdir'

const node = (args: string[], input?: string) =>
  spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8', input })

function write(root: string, rel: string, content: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), content)
}

describe('build-host', () => {
  it('sans src/host/index.ts : rien à construire', async () => {
    expect(await buildHost({ root: makeTmpDir('host-none') })).toBeNull()
  })

  it('bundle CJS autonome : alias @shared inliné, aucun require hors builtins', async () => {
    const root = makeTmpDir('host')
    write(root, 'src/shared/proto.ts', 'export const PROTOCOL_VERSION = 7\n')
    write(
      root,
      'src/host/index.ts',
      "import { createServer } from 'node:net'\nimport { PROTOCOL_VERSION } from '@shared/proto'\nexport const v = [createServer.name, PROTOCOL_VERSION]\nconsole.log(JSON.stringify(v))\n",
    )
    const out = await buildHost({ root, logLevel: 'silent' })
    expect(out).toBe(join(root, 'out/host/host.js'))
    const code = readFileSync(out as string, 'utf8')
    expect(externalRequires(code)).toEqual([])
    const r = node([out as string])
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout.trim()).toBe('["createServer",7]')
  })

  it('détecte un require de module externe', () => {
    expect(
      externalRequires('require("node:fs");require("zod");require("./x");require(\'fs\')'),
    ).toEqual(['zod'])
  })
})

describe('build-ext', () => {
  it('sans manifest : rien à construire', async () => {
    expect(await buildExt({ root: makeTmpDir('ext-none') })).toBeNull()
  })

  it('par cible : scripts IIFE sans import, alias @shared, manifest généré, icônes copiées', async () => {
    const root = makeTmpDir('ext')
    write(
      root,
      'extension/manifest.ts',
      'export function buildManifest(t: string) { return { manifest_version: 3, cible: t } }\n',
    )
    write(root, 'extension/icons/16.png', 'png')
    write(
      root,
      'extension/src/background/index.ts',
      "import { A } from '@shared/a'\nexport const x = A\n",
    )
    write(root, 'extension/src/content/x.ts', "import { A } from '@shared/a'\nconsole.log(A)\n")
    write(root, 'src/shared/a.ts', 'export const A = 1\n')
    const out = await buildExt({ root, logLevel: 'silent' })
    expect(out).toBe(join(root, 'dist-extension'))
    for (const t of ['chromium', 'firefox']) {
      const content = readFileSync(join(root, `dist-extension/${t}/content/x.js`), 'utf8')
      expect(content).not.toMatch(/^\s*import\s/m)
      expect(content).not.toMatch(/^\s*export\s/m)
      expect(readFileSync(join(root, `dist-extension/${t}/background.js`), 'utf8')).not.toMatch(
        /^\s*export\s/m,
      )
      const m = JSON.parse(
        readFileSync(join(root, `dist-extension/${t}/manifest.json`), 'utf8'),
      ) as {
        cible: string
      }
      expect(m.cible).toBe(t)
      expect(existsSync(join(root, `dist-extension/${t}/icons/16.png`))).toBe(true)
    }
  })
})

describe('gen-extension-key.mjs', () => {
  it('clé publique SPKI et identifiant a–p cohérents ; aucune clé privée en sortie', () => {
    const r = node(['scripts/gen-extension-key.mjs'])
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).not.toMatch(/PRIVATE/)
    const { key, id } = JSON.parse(r.stdout) as { key: string; id: string }
    expect(id).toMatch(/^[a-p]{32}$/)
    const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)
    const expected = [...hex].map((c) => String.fromCharCode(97 + Number.parseInt(c, 16))).join('')
    expect(id).toBe(expected)
  })
})

describe('sanitize-fixture.mjs', () => {
  it('masque jetons, cookies, e-mails, hôtes et pseudonymise noms et textes (déterministe)', () => {
    const dir = makeTmpDir('sanitize')
    const input = {
      headers: { Authorization: 'Bearer abc.def', cookie: 'ct0=zzz; auth_token=yyy' },
      user: { name: 'Prénom Nom', screen_name: '@vrai_pseudo', email: 'moi@vrai-domaine.fr' },
      posts: [
        {
          full_text: 'Un vrai texte',
          url: 'https://pbs.twimg.com/media/a1b2?oe=65f&sig=abc#x',
          likes: 12,
          ok: true,
        },
        { full_text: 'Un vrai texte', user: { name: 'Prénom Nom' } },
      ],
    }
    const from = join(dir, 'in.json')
    const to = join(dir, 'out.json')
    writeFileSync(from, JSON.stringify(input))
    const r = node(['scripts/sanitize-fixture.mjs', '--in', from, '--out', to])
    expect(r.status, r.stderr).toBe(0)
    const raw = readFileSync(to, 'utf8')
    for (const secret of [
      'abc.def',
      'ct0=zzz',
      'vrai_pseudo',
      'vrai-domaine',
      'Prénom',
      'vrai texte',
      'twimg',
      'sig=',
    ]) {
      expect(raw, secret).not.toContain(secret)
    }
    const out = JSON.parse(raw) as typeof input & { posts: { full_text: string; url?: string }[] }
    expect(out.headers.Authorization).toBe('[redacted]')
    expect(out.headers.cookie).toBe('[redacted]')
    expect(out.user.screen_name).toMatch(/^@auteur_\d+$/)
    expect(out.user.email).toBe('utilisateur@example.test')
    expect(out.posts[0]?.url).toMatch(/^https:\/\/example\.test\//)
    expect(out.posts[0]).toMatchObject({ likes: 12, ok: true })
    // Même valeur → même pseudonyme.
    expect(out.posts[0]?.full_text).toBe(out.posts[1]?.full_text)
    expect(out.posts[1]?.user?.name).toBe(out.user.name)
  })
})
