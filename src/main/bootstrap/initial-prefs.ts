/**
 * Lecture tolérante de `prefs.json` au démarrage (thème de la première image, avant que
 * le magasin de WP-02 ne soit initialisé). Lecture seule.
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
