/**
 * Point d'entrée de l'hôte natif (→ `out/host/host.js`, puis exécutable Node SEA
 * `out/native-host/recolt-host`). Voir `host.ts`.
 */
import { startHost } from './host'

startHost({
  argv: process.argv,
  execPath: process.execPath,
  ppid: process.ppid,
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  exit: (code) => {
    // Laisse stdout se vider avant de sortir.
    process.stdout.write('', () => process.exit(code))
  },
  pid: process.pid,
})
