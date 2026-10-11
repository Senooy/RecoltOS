/**
 * `pnpm run check:env` (nom `doctor` réservé par pnpm, PLAN §1.15) : vérifie que l'environnement
 * permet de construire et de tester RecoltOS. Code de sortie 1 seulement si un contrôle `fail`
 * échoue ; les avertissements (outils optionnels, pnpm 9.15.0 de Homebrew…) ne bloquent jamais.
 */
import { resolve } from 'node:path'
import { runChecks, type Level } from './check-env.mjs'

const ICON: Record<Level, string> = { ok: '✔', warn: '⚠', fail: '✘' }

function main(): number {
  const root = resolve(import.meta.dirname, '..')
  console.log(`check:env — ${root}\n`)
  const checks = runChecks(root)
  for (const c of checks) {
    console.log(`${ICON[c.level]} ${c.label.padEnd(30)} ${c.detail}`)
  }
  const fails = checks.filter((c) => c.level === 'fail')
  const warns = checks.filter((c) => c.level === 'warn')
  console.log(
    `\n${checks.length - fails.length - warns.length} ok, ${warns.length} avertissement(s), ${fails.length} échec(s)`,
  )
  if (fails.length > 0) {
    console.error('check:env : ÉCHEC')
    return 1
  }
  console.log('check:env : OK')
  return 0
}

process.exitCode = main()
