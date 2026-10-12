/**
 * To be imported FIRST by each renderer entry point (`main.tsx`, `offscreen.tsx`).
 * zod 4 compiles a fast object parser with `new Function`; its detection (`allowsEval`)
 * tries evaluation once, which the renderer CSP (without `unsafe-eval`) blocks, producing
 * a `script-src eval` violation (seen by `tests/e2e/security.spec.ts`). `jitless` must be set
 * before the first `z.object` is built: the decision is made when the schema is built.
 * The main process (Node, no CSP) keeps the JIT.
 */
import { z } from 'zod'

z.config({ jitless: true })
