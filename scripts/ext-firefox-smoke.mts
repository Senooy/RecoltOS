/**
 * Fumée Firefox (hors `verify` : lance Firefox 157 réel sur un profil JETABLE) :
 * build Firefox de test `--selftest` pointé sur un faux serveur local, `web-ext run` (Firefox lancé
 * par LaunchServices : un lancement direct échoue), chargement temporaire, puis l'auto-test
 * de l'arrière-plan pose des cookies factices pour le faux serveur, fait une requête X SANS onglet et
 * rapporte. Bloquant : extension chargée dans Firefox release. Informatif : cookies, `x-csrf-token`
 * et `Origin` réécrit (la boucle locale est refusée par Firefox lancé ainsi, voir plus bas).
 * Ne touche ni au profil de l'utilisateur ni à ses cookies réels.
 *
 *   pnpm exec tsx --tsconfig tsconfig.node.json scripts/ext-firefox-smoke.mts
 */
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { startFakePlatforms } from '../tests/ext/fake-platforms'
import { buildExt } from './build-ext.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const work = join(ROOT, '.tmp/ff-smoke')
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
// Firefox refuse `cookies.set` sur une adresse IP : nom d'hôte `localhost`.
const host = process.env.FF_SMOKE_HOST ?? 'localhost'
const srv = await startFakePlatforms(0, host)
await buildExt({
  outDir: join(work, 'ext'),
  testBase: srv.base,
  targets: ['firefox'],
  selfTest: true,
  logLevel: 'silent',
})
const ff = join(work, 'ff.sh')
const out = join(work, 'firefox-out.txt')
writeFileSync(
  ff,
  `#!/bin/sh\nexec /usr/bin/open -n -W --stdout '${out}' --stderr '${out}' -a /Applications/Firefox.app --args "$@"\n`,
)
chmodSync(ff, 0o755)
const log: string[] = []
const run = spawn(
  join(ROOT, 'node_modules/.bin/web-ext'),
  [
    'run',
    '--source-dir',
    join(work, 'ext/firefox'),
    '--firefox',
    ff,
    '--no-reload',
    '--no-input',
    '--arg=-headless',
    '--verbose',
    '--pref',
    'devtools.console.stdout.chrome=true',
    '--pref',
    'devtools.console.stdout.content=true',
    // Nom d'hôte factice résolu vers la boucle locale (jamais de résolution DNS réelle).
    ...(host.endsWith('.test') ? ['--pref', 'network.dns.forceResolve=127.0.0.1'] : []),
  ],
  { cwd: work },
)
run.stdout.on('data', (d: Buffer) => log.push(d.toString()))
run.stderr.on('data', (d: Buffer) => log.push(d.toString()))
let ok = false
let profile: string | null = null
try {
  for (let i = 0; i < 90 && srv.selfTests.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    profile ??= /firefox-profile[A-Za-z0-9]+/.exec(log.join(''))?.[0] ?? null
  }
  const installed = /Installed .* as a temporary add-on/.test(log.join(''))
  const report = srv.selfTests[0] as Record<string, unknown> | undefined
  const bm = srv.log.find((l) => l.path.includes('/Bookmarks?'))
  console.log(JSON.stringify({ installed, report, request: bm ?? null }, null, 2))
  if (process.env.FF_SMOKE_DEBUG) {
    const { readFileSync, existsSync } = await import('node:fs')
    if (existsSync(out)) log.push(readFileSync(out, 'utf8'))
    console.log(
      log
        .join('')
        .split('\n')
        .filter((l) => /console|selftest|Error|error|recoltos/i.test(l) && !/Retrying/.test(l))
        .slice(-40)
        .join('\n'),
    )
  }
  // Critère bloquant : chargement dans Firefox release. La requête d'arrière-plan vers le faux serveur
  // local est informative : dans ce lanceur (LaunchServices), Firefox refuse les requêtes vers la
  // boucle locale (« NetworkError ») ; la vérification réelle est dans docs/checklist-manuelle.md
  const network =
    !!bm &&
    bm.csrf === 'csrf-selftest' &&
    bm.cookie.includes('auth_token=session-selftest') &&
    bm.origin === srv.base
  console.log(`requête d'arrière-plan vers le faux serveur : ${network ? 'OK' : 'non vérifiée'}`)
  ok = installed
} finally {
  run.kill()
  if (profile) spawnSync('/usr/bin/pkill', ['-f', profile])
  await srv.close()
}
console.log(ok ? 'ext-firefox-smoke : OK' : 'ext-firefox-smoke : ÉCHEC')
process.exit(ok ? 0 : 1)
