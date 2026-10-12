/**
 * Garde des dossiers de sortie destructifs (`make-fixtures.mts`, `seed-bench.mts`, `cloneDir`) : ces
 * scripts SUPPRIMENT récursivement `--out` avant d'écrire. Une faute de frappe (`--out ~`, `--out .`,
 * le `userData` réel de RecoltOS, le dossier de l'ancienne app GatherOS, source de l'import) ne doit
 * jamais effacer de données.
 *
 * Règles de `assertSafeOutDir(out)` :
 *  1. toujours refusés, même avec `force` : `/`, `$HOME` et ses parents, la racine du dépôt et ses
 *     parents (dont le checkout principal quand on est dans un worktree), tout chemin sous
 *     `…/Library` ou `…/Application Support`, tout chemin contenant un segment « GatherOS » ;
 *  2. un dossier existant NON vide n'est accepté que s'il porte le marqueur `.recolt-fixture` écrit
 *     par ces scripts (donc un dossier qu'ils ont eux-mêmes fabriqué) ; `force` n'y change rien ;
 *  3. hors `<dépôt>/.tmp` et `os.tmpdir()`, il faut `force` (`--force`) ;
 *  4. les liens symboliques sont résolus avant tout contrôle.
 */
import { existsSync, lstatSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { REPO_ROOT } from './paths'

/** Fichier posé dans tout dossier fabriqué par `make-fixtures` / `seed-bench`. */
export const FIXTURE_MARKER = '.recolt-fixture'

export interface SafeOutOptions {
  /** Autorise un dossier hors `<dépôt>/.tmp` et `os.tmpdir()` (jamais les chemins protégés). */
  force?: boolean
  /** Racine du dépôt (défaut : celle des tests). */
  repoRoot?: string
  /** Dossier personnel (défaut : `os.homedir()`). */
  home?: string
  /** Dossier temporaire système (défaut : `os.tmpdir()`). */
  tmp?: string
}

/** Chemin absolu avec liens symboliques résolus, même si la fin du chemin n'existe pas encore. */
export function realish(p: string): string {
  let current = resolve(p)
  const tail: string[] = []
  for (;;) {
    try {
      const real = realpathSync(current)
      return tail.length === 0 ? real : join(real, ...tail.reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolve(p)
      tail.push(basename(current))
      current = parent
    }
  }
}

/** `inner` est `outer` ou se trouve dessous. */
function within(outer: string, inner: string): boolean {
  const rel = relative(outer, inner)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

const strictlyWithin = (outer: string, inner: string): boolean =>
  inner !== outer && within(outer, inner)

export function protectedReason(target: string, options: SafeOutOptions = {}): string | null {
  const home = realish(options.home ?? homedir())
  const repo = realish(options.repoRoot ?? REPO_ROOT)
  if (dirname(target) === target) return 'la racine du disque'
  if (within(target, home)) return 'le dossier personnel (ou un de ses parents)'
  if (within(target, repo)) return 'la racine du dépôt (ou un de ses parents)'
  const segments = target.split(sep)
  if (segments.some((s) => s.toLowerCase() === 'gatheros'))
    return 'un dossier GatherOS (lecture seule)'
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === 'Library' && i > 0) return 'un dossier Library (données applicatives)'
    if (segments[i] === 'Application Support') return 'un dossier Application Support'
  }
  return null
}

/**
 * Valide `out` avant toute suppression et renvoie son chemin résolu. Lève une `Error` (message en
 * français) si le dossier est refusé.
 */
export function assertSafeOutDir(out: string, options: SafeOutOptions = {}): string {
  if (!out || out.trim() === '')
    throw new Error('--out vide : refus de supprimer un dossier non désigné')
  const target = realish(out)

  const why = protectedReason(target, options)
  if (why) throw new Error(`--out ${out} refusé : c'est ${why}. Rien n'a été supprimé.`)

  if (existsSync(target)) {
    const st = lstatSync(target)
    if (!st.isDirectory())
      throw new Error(
        `--out ${out} refusé : existe et n'est pas un dossier. Rien n'a été supprimé.`,
      )
    const entries = readdirSync(target).filter((e) => e !== '.DS_Store')
    if (entries.length > 0 && !entries.includes(FIXTURE_MARKER))
      throw new Error(
        `--out ${out} refusé : dossier non vide qui n'a pas été fabriqué par ce script ` +
          `(marqueur ${FIXTURE_MARKER} absent). Choisir un dossier vide ou inexistant. Rien n'a été supprimé.`,
      )
  }

  if (!options.force) {
    const repo = realish(options.repoRoot ?? REPO_ROOT)
    const zones = [join(repo, '.tmp'), realish(options.tmp ?? tmpdir())]
    if (!zones.some((z) => strictlyWithin(z, target)))
      throw new Error(
        `--out ${out} refusé : hors de <dépôt>/.tmp et du dossier temporaire système ` +
          `(${zones.join(', ')}). Ajouter --force pour l'autoriser. Rien n'a été supprimé.`,
      )
  }
  return target
}

/** Pose le marqueur : le dossier pourra être régénéré sans `--force` ni confirmation. */
export function markFixtureDir(dir: string, generator: string): void {
  writeFileSync(join(dir, FIXTURE_MARKER), `${generator}\n`)
}
