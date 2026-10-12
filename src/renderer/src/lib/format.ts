/**
 * Typography of the active language (`shared/i18n/lang`): percentages, dates, relative durations,
 * sizes, numbers, plurals, quotation marks. Single source: no component formats by hand.
 *
 * English: no space before "%", quotation marks “ ”, `Intl` in `en-US` (« 1,234 », « 4.2 MB »,
 * « Sep 24, 2026 », « 4 min. ago »). French: rules below.
 *
 * Spaces (verified under Node 22 / ICU):
 * - `pct`: U+202F (hand-written: `Intl` style `percent` produces U+00A0);
 * - `dateShort`: `Intl`'s U+0020 become U+00A0;
 * - `relative`: `Intl.RelativeTimeFormat` (U+00A0 before « min », « h », « s »);
 * - `bytes` and `count`: `Intl`'s U+202F (unit, thousands separator).
 */
import { getLang, type Lang } from '../../../shared/i18n/lang'
import { count as countWord, countEn, plural, pluralEn } from '../i18n/plural'

export const NNBSP = ' ' // narrow no-break space
export const NBSP = ' ' // no-break space

export { plural }

/** Plural of the active language (French: 0 and 1 are singular; English: only 1). */
export function pluralFor(n: number, one: string, many: string): string {
  return getLang() === 'fr' ? plural(n, one, many) : pluralEn(n, one, many)
}

/** `Intl` locale of the active language. */
export function intlLocale(lang: Lang = getLang()): string {
  return lang === 'fr' ? 'fr-FR' : 'en-US'
}

/** `Intl` formatters cached per language: created on first use. */
function cached<T>(make: (lang: Lang) => T): () => T {
  const byLang = new Map<Lang, T>()
  return () => {
    const lang = getLang()
    let f = byLang.get(lang)
    if (!f) {
      f = make(lang)
      byLang.set(lang, f)
    }
    return f
  }
}

const fmtNumber = cached((lang) => new Intl.NumberFormat(intlLocale(lang)))

/**
 * Localized integer (or decimal): `1234` → « 1 234 » (U+202F) or « 1,234 ». Non-finite → « 0 ».
 * `-0` (e.g. `Math.round(-0.4)`) is brought back to « 0 »: `Intl` would write « -0 ».
 */
export function count(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  return fmtNumber().format(v === 0 ? 0 : v)
}

/** Percentage of a fraction: `pct(1)` → « 100 % » (U+202F before the sign) or « 100% ». */
export function pct(fraction: number): string {
  const v = Number.isFinite(fraction) ? Math.round(fraction * 100) : 0
  return getLang() === 'fr' ? `${count(v)}${NNBSP}%` : `${count(v)}%`
}

export type DateInput = number | string | Date

const dateFormatters = new Map<string, Intl.DateTimeFormat>()
function dateFormatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const lang = getLang()
  const key = `${lang}|${timeZone ?? ''}`
  let f = dateFormatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(lang), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(timeZone ? { timeZone } : {}),
    })
    dateFormatters.set(key, f)
  }
  return f
}

/** « 24 sept. 2026 » (U+00A0 spaces) or « Sep 24, 2026 ». Invalid date → « ». */
export function dateShort(input: DateInput, opts: { timeZone?: string } = {}): string {
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  const out = dateFormatter(opts.timeZone).format(d)
  return getLang() === 'fr' ? out.replace(/ /g, NBSP) : out
}

const timeFormatter = cached(
  (lang) => new Intl.DateTimeFormat(intlLocale(lang), { hour: 'numeric', minute: '2-digit' }),
)

/** Short time: « 14 h 05 » (U+202F) in French, « 2:05 PM » in English. */
export function hourMinute(input: DateInput): string {
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  if (getLang() === 'fr') {
    return `${d.getHours()}${NNBSP}h${NNBSP}${String(d.getMinutes()).padStart(2, '0')}`
  }
  return timeFormatter().format(d)
}

const rtfShort = cached(
  (lang) => new Intl.RelativeTimeFormat(lang, { style: 'short', numeric: 'auto' }),
)
// The short style abbreviates « mois » to « m. » and « ans » to « a »: unreadable, so use long.
const rtfLong = cached(
  (lang) => new Intl.RelativeTimeFormat(lang, { style: 'long', numeric: 'auto' }),
)

const MIN = 60
const HOUR = 3600
const DAY = 86_400
const DAY_MS = DAY * 1000
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/** Number of calendar days between two instants, local days (`now` − `t`, rounded). */
function calendarDays(t: number, n: number): number {
  const a = new Date(n)
  const b = new Date(t)
  const dayA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const dayB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((dayA - dayB) / DAY_MS)
}

/**
 * « il y a 4 min », « hier », « avant-hier », « dans 3 min »… (short style for short durations).
 * `now` is injectable for tests. Less than 5 s apart: « maintenant ».
 *
 * Deliberate choices:
 * - months and years use the long style (`style: 'long'`): the short style of `Intl` writes « m. »
 *   and « a », which is unreadable; hence « le mois dernier » or « il y a 2 mois »;
 * - « hier » and « avant-hier » follow the local calendar day (not an hour gap):
 *   22:30 the evening before, seen at 21:00 the next day, gives « hier ». Under 1 h, we stay in
 *   minutes.
 */
export function relative(input: DateInput, now: number | Date = Date.now()): string {
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime()
  const n = now instanceof Date ? now.getTime() : now
  if (Number.isNaN(t) || Number.isNaN(n)) return ''
  const diff = (t - n) / 1000
  const abs = Math.abs(diff)
  const sign = diff < 0 ? -1 : 1
  const short = rtfShort()
  if (abs < 5) return short.format(0, 'second')
  if (abs < MIN) return short.format(sign * Math.floor(abs), 'second')
  if (abs < HOUR) return short.format(sign * Math.floor(abs / MIN), 'minute')
  if (diff < 0) {
    const days = calendarDays(t, n)
    if (days === 1 || days === 2) return short.format(-days, 'day')
  }
  if (abs < DAY) return short.format(sign * Math.floor(abs / HOUR), 'hour')
  if (abs < WEEK) return short.format(sign * Math.floor(abs / DAY), 'day')
  if (abs < MONTH) return short.format(sign * Math.floor(abs / WEEK), 'week')
  if (abs < YEAR) return rtfLong().format(sign * Math.floor(abs / MONTH), 'month')
  return rtfLong().format(sign * Math.floor(abs / YEAR), 'year')
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const
const byteFormatters = cached((lang) =>
  BYTE_UNITS.map(
    (unit) =>
      new Intl.NumberFormat(intlLocale(lang), {
        style: 'unit',
        unit,
        unitDisplay: 'short',
        maximumFractionDigits: unit === 'byte' ? 0 : 1,
      }),
  ),
)

/**
 * Decimal sizes like the Finder: `4_200_000` → « 4,2 Mo » (U+202F) or « 4.2 MB »;
 * `512` → « 512 o » or « 512 bytes ».
 */
export function bytes(n: number): string {
  let v = Number.isFinite(n) && n > 0 ? n : 0
  let i = 0
  while (i < BYTE_UNITS.length - 1 && v >= 1000) {
    v /= 1000
    i++
  }
  // 999,96 ko rounds to « 1 000 ko »: switch to the next unit up.
  if (i > 0 && i < BYTE_UNITS.length - 1 && Math.round(v * 10) / 10 >= 1000) {
    v /= 1000
    i++
  }
  if (i === 0 && getLang() !== 'fr') return `${count(v)} ${pluralEn(v, 'byte', 'bytes')}`
  return (byteFormatters()[i] as Intl.NumberFormat).format(v)
}

/** Examples: « 0 élément », « 1 élément », « 36 éléments », « 1 234 éléments » (French); « 0 items », « 1 item » (English). */
export function items(n: number): string {
  return getLang() === 'fr'
    ? countWord(n, 'élément', 'éléments', count)
    : countEn(n, 'item', 'items', count)
}

/**
 * Generic plural with a formatted number, following the active language's rule:
 * `counted(3, 'tag', 'tags')` → « 3 tags ». The words passed must be those of the active language.
 */
export function counted(n: number, one: string, many: string): string {
  return getLang() === 'fr' ? countWord(n, one, many, count) : countEn(n, one, many, count)
}

/** « texte » with inner no-break spaces (U+00A0); “text” in English. */
export function guillemets(text: string): string {
  return getLang() === 'fr' ? `«${NBSP}${text}${NBSP}»` : `“${text}”`
}

/** « label : value » separator: « : » preceded by a space in French, « : » attached in English. */
export function colonSep(): string {
  return getLang() === 'fr' ? ' : ' : ': '
}

/** « Images : 4,2 Mo » / « Images: 4.2 MB ». */
export function labelled(label: string, value: string): string {
  return `${label}${colonSep()}${value}`
}

/** List separator « ; » (space before it in French). */
export function listSep(): string {
  return getLang() === 'fr' ? ' ; ' : '; '
}

/** Time code « 0:35 » / « 1:02:03 » (video player, durations), tabular. */
export function clock(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
