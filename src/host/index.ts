/**
 * Entry point of the native host (→ `out/host/host.js`, then Node SEA executable
 * `out/native-host/recolt-host`). See `host.ts`.
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
    // Let stdout flush before exiting.
    process.stdout.write('', () => process.exit(code))
  },
  pid: process.pid,
})
