/**
 * À importer EN PREMIER par chaque entrée du renderer (`main.tsx`, `offscreen.tsx`).
 * zod 4 compile un analyseur rapide des objets avec `new Function` ; sa détection (`allowsEval`)
 * tente l'évaluation une fois, ce que la CSP du renderer (sans `unsafe-eval`) bloque en produisant
 * une violation `script-src eval` (vue par `tests/e2e/security.spec.ts`). `jitless` doit être posé
 * avant la construction du premier `z.object` : la décision est prise à la construction du schéma.
 * Le main (Node, sans CSP) garde le JIT.
 */
import { z } from 'zod'

z.config({ jitless: true })
