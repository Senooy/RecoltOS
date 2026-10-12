/**
 * Writes the v1 JSON Schema of the extension ↔ app protocol (`src/shared/bridge/schema/v1.json`).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { bridgeJsonSchema } from '../src/shared/bridge/json-schema'

const out = resolve(import.meta.dirname, '../src/shared/bridge/schema/v1.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(bridgeJsonSchema(), null, 2)}\n`)
console.log(`gen:bridge-schema : ${out}`)
