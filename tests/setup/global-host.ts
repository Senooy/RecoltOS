/**
 * `globalSetup` of the `unit` project: purges the leftovers of interrupted runs. The native host
 * (Rust) is built by `tests/unit/bridge/host-process.test.ts` itself.
 */
import { purgeStaleTmpDirs } from '../helpers/tmpdir'

export default function setup(): void {
  // Leftovers from previous interrupted runs (`.tmp/tests/`, > 10 min).
  purgeStaleTmpDirs()
}
