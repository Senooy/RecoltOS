/**
 * `pnpm run check:env` (the name `doctor` is reserved by pnpm): checks that the environment
 * can build and test RecoltOS. Exit code 1 only if a `fail` check fails; warnings (optional tools,
 * pnpm 9.15.0 from Homebrew…) never block.
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
    `\n${checks.length - fails.length - warns.length} ok, ${warns.length} warning(s), ${fails.length} failure(s)`,
  )
  if (fails.length > 0) {
    console.error('check:env : FAILED')
    return 1
  }
  console.log('check:env : OK')
  return 0
}

process.exitCode = main()
