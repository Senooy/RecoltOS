/**
 * Typographie française (DESIGN §0, PLAN §2.6) : pourcentages, dates, durées relatives, tailles,
 * nombres, pluriels, guillemets. Source unique : aucun composant ne formate à la main.
 *
 * Espaces (vérifiées sous Node 22 / ICU) :
 * - `pct` : U+202F (écrit à la main : `Intl` style `percent` produit U+00A0) ;
 * - `dateShort` : les U+0020 d'`Intl` deviennent U+00A0 ;
 * - `relative` : `Intl.RelativeTimeFormat` (U+00A0 avant « min », « h », « s ») ;
 * - `bytes` et `count` : U+202F d'`Intl` (unité, séparateur de milliers).
 */
import { count as countWord, plural } from '../i18n/plural'

export const NNBSP = ' ' // espace fine insécable
export const NBSP = ' ' // espace insécable

export { plural }

const fmtNumber = new Intl.NumberFormat('fr-FR')

/**
 * Entier (ou décimal) localisé : `1234` → « 1 234 » (U+202F). Non fini → « 0 ».
 * `-0` (ex. `Math.round(-0.4)`) est ramené à « 0 » : `Intl` écrirait « -0 ».
 */
export function count(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  return fmtNumber.format(v === 0 ? 0 : v)
}

/** Pourcentage d'une fraction : `pct(1)` → « 100 % » (U+202F avant le signe). */
export function pct(fraction: number): string {
  const v = Number.isFinite(fraction) ? Math.round(fraction * 100) : 0
  return `${count(v)}${NNBSP}%`
}

export type DateInput = number | string | Date

const dateFormatters = new Map<string, Intl.DateTimeFormat>()
function dateFormatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? ''
  let f = dateFormatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(timeZone ? { timeZone } : {}),
    })
    dateFormatters.set(key, f)
  }
  return f
}

/** « 24 sept. 2026 » avec espaces insécables (U+00A0). Date invalide → « ». */
export function dateShort(input: DateInput, opts: { timeZone?: string } = {}): string {
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  return dateFormatter(opts.timeZone).format(d).replace(/ /g, NBSP)
}

const rtfShort = new Intl.RelativeTimeFormat('fr', { style: 'short', numeric: 'auto' })
// Le style court abrège « mois » en « m. » et « ans » en « a » : illisible, on passe en long.
const rtfLong = new Intl.RelativeTimeFormat('fr', { style: 'long', numeric: 'auto' })

const MIN = 60
const HOUR = 3600
const DAY = 86_400
const DAY_MS = DAY * 1000
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/** Nombre de jours calendaires entre deux instants, jours locaux (`now` − `t`, arrondi). */
function calendarDays(t: number, n: number): number {
  const a = new Date(n)
  const b = new Date(t)
  const dayA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const dayB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((dayA - dayB) / DAY_MS)
}

/**
 * « il y a 4 min », « hier », « avant-hier », « dans 3 min »… (style court pour le temps court).
 * `now` est injectable pour les tests. Moins de 5 s d'écart : « maintenant ».
 *
 * Écarts volontaires avec DESIGN §0 :
 * - mois et années passent en style long (`style: 'long'`) : le style court d'`Intl` écrit « m. »
 *   et « a », illisible ; d'où « le mois dernier » ou « il y a 2 mois » ;
 * - « hier » et « avant-hier » suivent le jour calendaire local (et non un écart en heures) :
 *   22 h 30 la veille, vu à 21 h le lendemain, donne « hier ». Sous 1 h, on reste en minutes.
 */
export function relative(input: DateInput, now: number | Date = Date.now()): string {
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime()
  const n = now instanceof Date ? now.getTime() : now
  if (Number.isNaN(t) || Number.isNaN(n)) return ''
  const diff = (t - n) / 1000
  const abs = Math.abs(diff)
  const sign = diff < 0 ? -1 : 1
  if (abs < 5) return rtfShort.format(0, 'second')
  if (abs < MIN) return rtfShort.format(sign * Math.floor(abs), 'second')
  if (abs < HOUR) return rtfShort.format(sign * Math.floor(abs / MIN), 'minute')
  if (diff < 0) {
    const days = calendarDays(t, n)
    if (days === 1 || days === 2) return rtfShort.format(-days, 'day')
  }
  if (abs < DAY) return rtfShort.format(sign * Math.floor(abs / HOUR), 'hour')
  if (abs < WEEK) return rtfShort.format(sign * Math.floor(abs / DAY), 'day')
  if (abs < MONTH) return rtfShort.format(sign * Math.floor(abs / WEEK), 'week')
  if (abs < YEAR) return rtfLong.format(sign * Math.floor(abs / MONTH), 'month')
  return rtfLong.format(sign * Math.floor(abs / YEAR), 'year')
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const
const byteFormatters = BYTE_UNITS.map(
  (unit) =>
    new Intl.NumberFormat('fr-FR', {
      style: 'unit',
      unit,
      unitDisplay: 'short',
      maximumFractionDigits: unit === 'byte' ? 0 : 1,
    }),
)

/** Tailles décimales comme le Finder : `4_200_000` → « 4,2 Mo » (U+202F), `512` → « 512 o ». */
export function bytes(n: number): string {
  let v = Number.isFinite(n) && n > 0 ? n : 0
  let i = 0
  while (i < BYTE_UNITS.length - 1 && v >= 1000) {
    v /= 1000
    i++
  }
  // 999,96 ko s'arrondit à « 1 000 ko » : on passe à l'unité du dessus.
  if (i > 0 && i < BYTE_UNITS.length - 1 && Math.round(v * 10) / 10 >= 1000) {
    v /= 1000
    i++
  }
  return (byteFormatters[i] as Intl.NumberFormat).format(v)
}

/** « 0 élément », « 1 élément », « 36 éléments », « 1 234 éléments ». */
export function items(n: number): string {
  return countWord(n, 'élément', 'éléments', count)
}

/** Pluriel générique avec nombre formaté : `plural(3, 'tag', 'tags')` → « tag » (voir aussi `counted`). */
export function counted(n: number, one: string, many: string): string {
  return countWord(n, one, many, count)
}

/** « texte » avec espaces insécables intérieures (U+00A0). */
export function guillemets(text: string): string {
  return `«${NBSP}${text}${NBSP}»`
}

/** Code temporel « 0:35 » / « 1:02:03 » (lecteur vidéo, durées), tabulaire. */
export function clock(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
