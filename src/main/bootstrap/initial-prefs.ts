/**
 * Lenient read of `prefs.json` at startup (theme of the first image, before the store
 * is initialized). Read-only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PREFS, parsePrefsLenient, type Prefs } from '../../shared/prefs'

export function readInitialPrefs(userData: string): Prefs {
  try {
    return parsePrefsLenient(JSON.parse(fs.readFileSync(path.join(userData, 'prefs.json'), 'utf8')))
  } catch {
    return DEFAULT_PREFS
  }
}
