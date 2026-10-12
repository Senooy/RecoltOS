import { beforeAll, describe, expect, it } from 'vitest'
import {
  NBSP,
  NNBSP,
  bytes,
  clock,
  count,
  counted,
  dateShort,
  guillemets,
  items,
  pct,
  plural,
  relative,
} from '../../../src/renderer/src/lib/format'

const PARIS = { timeZone: 'Europe/Paris' }
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0)

beforeAll(() => {
  // tests under TZ=Europe/Paris (the functions also accept an explicit timezone).
  process.env.TZ = 'Europe/Paris'
})

describe('pct', () => {
  it('pct(1) = "100 %" with U+202F', () => {
    expect(pct(1)).toBe('100 %')
    expect(pct(1).codePointAt(3)).toBe(0x202f)
  })
  it('rounds and handles extremes', () => {
    expect(pct(0)).toBe('0 %')
    expect(pct(0.255)).toBe('26 %')
    expect(pct(2.5)).toBe('250 %')
    expect(pct(Number.NaN)).toBe('0 %')
  })
})

describe('dateShort', () => {
  it('24 sept. 2026 with U+00A0', () => {
    expect(dateShort(1790209121887, PARIS)).toBe('24 sept. 2026')
  })
  it('no explicit timezone: follows TZ=Europe/Paris', () => {
    expect(dateShort(1790209121887)).toBe('24 sept. 2026')
  })
  it('contains no ordinary space', () => {
    expect(dateShort(Date.UTC(2026, 5, 3), PARIS)).not.toContain(' ')
    expect(dateShort(Date.UTC(2026, 5, 3), PARIS)).toBe(`3${NBSP}juin${NBSP}2026`)
  })
  it('day changes with the timezone (23:30 UTC = 25 sept. in Paris)', () => {
    const t = Date.UTC(2026, 8, 24, 23, 30)
    expect(dateShort(t, PARIS)).toBe('25 sept. 2026')
    expect(dateShort(t, { timeZone: 'UTC' })).toBe('24 sept. 2026')
  })
  it('invalid date: empty string', () => {
    expect(dateShort(Number.NaN)).toBe('')
    expect(dateShort('pas une date')).toBe('')
  })
})

describe('relative', () => {
  it('shows "il y a 4 min" (U+00A0 before "min")', () => {
    expect(relative(NOW - 4 * MIN, NOW)).toBe('il y a 4 min')
  })
  it('truncates downwards', () => {
    expect(relative(NOW - 4 * MIN - 59_000, NOW)).toBe('il y a 4 min')
  })
  it('just now, seconds, hours', () => {
    expect(relative(NOW - 2000, NOW)).toBe('maintenant')
    expect(relative(NOW - 30_000, NOW)).toBe('il y a 30 s')
    expect(relative(NOW - 3 * HOUR, NOW)).toBe('il y a 3 h')
  })
  it('yesterday / "avant-hier" / days', () => {
    expect(relative(NOW - DAY - HOUR, NOW)).toBe('hier')
    expect(relative(NOW - 2 * DAY - HOUR, NOW)).toBe('avant-hier')
    expect(relative(NOW - 4 * DAY, NOW)).toMatch(/^il y a 4\s*j$/)
  })
  it('weeks, months and years spelled out', () => {
    expect(relative(NOW - 15 * DAY, NOW)).toBe('il y a 2 sem.')
    expect(relative(NOW - 65 * DAY, NOW)).toBe('il y a 2 mois')
    expect(relative(NOW - 800 * DAY, NOW)).toBe('il y a 2 ans')
  })
  it('future', () => {
    expect(relative(NOW + 3 * MIN + 1000, NOW)).toBe('dans 3 min')
  })
  it('accepts Date and ISO string; invalid: empty string', () => {
    expect(relative(new Date(NOW - 4 * MIN), NOW)).toBe('il y a 4 min')
    expect(relative(new Date(NOW - 4 * MIN).toISOString(), new Date(NOW))).toBe('il y a 4 min')
    expect(relative('nope', NOW)).toBe('')
  })
})

describe('-0 never displayed', () => {
  it('pct and count map -0 to "0"', () => {
    expect(pct(-0.001)).toBe(`0${NNBSP}%`)
    expect(count(-0)).toBe('0')
    expect(pct(-0.001)).not.toContain('-')
  })
})

describe('relative: yesterday / avant-hier by calendar day', () => {
  const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi)

  it('22:30 the day before, seen at 21:00 the next day: "hier" (not "il y a 22 h")', () => {
    expect(relative(at(2026, 9, 10, 22, 30), at(2026, 9, 11, 21, 0))).toBe('hier')
  })
  it('25 h gap straddling two days: "hier"', () => {
    expect(relative(at(2026, 9, 10, 12, 0), at(2026, 9, 11, 13, 0))).toBe('hier')
  })
  it('two calendar days: "avant-hier"', () => {
    expect(relative(at(2026, 9, 9, 23, 0), at(2026, 9, 11, 8, 0))).toBe('avant-hier')
  })
  it('same day: hours, and under 1 h minutes even across midnight', () => {
    expect(relative(at(2026, 9, 11, 9, 0), at(2026, 9, 11, 20, 0))).toBe(`il y a 11${NBSP}h`)
    expect(relative(at(2026, 9, 10, 23, 50), at(2026, 9, 11, 0, 10))).toBe(`il y a 20${NBSP}min`)
  })
})

describe('bytes', () => {
  it('4,2 Mo with U+202F', () => {
    expect(bytes(4_200_000)).toBe('4,2 Mo')
    expect(bytes(4_200_000).codePointAt(3)).toBe(0x202f)
  })
  it('decimal units like the Finder', () => {
    expect(bytes(0)).toBe('0 o')
    expect(bytes(512)).toBe('512 o')
    expect(bytes(1000)).toBe('1 ko')
    expect(bytes(4_200)).toBe('4,2 ko')
    expect(bytes(3_100_000_000)).toBe('3,1 Go')
    expect(bytes(2_500_000_000_000)).toBe('2,5 To')
  })
  it('moves to the next unit when rounding reaches 1 000', () => {
    expect(bytes(999_960)).toBe('1 Mo')
  })
  it('invalid inputs', () => {
    expect(bytes(-5)).toBe('0 o')
    expect(bytes(Number.NaN)).toBe('0 o')
  })
})

describe('count, plurals, quotes', () => {
  it('1 234 with U+202F', () => {
    expect(count(1234)).toBe(`1${NNBSP}234`)
    expect(count(1234567)).toBe(`1${NNBSP}234${NNBSP}567`)
    expect(count(Number.POSITIVE_INFINITY)).toBe('0')
  })
  it('0 élément / 1 élément / 36 éléments', () => {
    expect(items(0)).toBe('0 élément')
    expect(items(1)).toBe('1 élément')
    expect(items(2)).toBe('2 éléments')
    expect(items(36)).toBe('36 éléments')
    expect(items(1234)).toBe(`1${NNBSP}234 éléments`)
  })
  it('generic plurals (0 and 1 singular)', () => {
    expect(plural(0, 'tag', 'tags')).toBe('tag')
    expect(plural(1, 'tag', 'tags')).toBe('tag')
    expect(plural(2, 'tag', 'tags')).toBe('tags')
    expect(counted(3, 'tag', 'tags')).toBe('3 tags')
    expect(counted(1500, 'tag', 'tags')).toBe(`1${NNBSP}500 tags`)
  })
  it('French quotes with non-breaking spaces', () => {
    expect(guillemets('Dev')).toBe('« Dev »')
  })
})

describe('clock', () => {
  it('formats durations', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(35)).toBe('0:35')
    expect(clock(62.9)).toBe('1:02')
    expect(clock(3723)).toBe('1:02:03')
    expect(clock(-3)).toBe('0:00')
  })
})
