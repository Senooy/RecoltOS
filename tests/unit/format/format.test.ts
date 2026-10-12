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
  // tests sous TZ=Europe/Paris (les fonctions acceptent aussi un fuseau explicite).
  process.env.TZ = 'Europe/Paris'
})

describe('pct', () => {
  it('pct(1) = « 100 % » avec U+202F', () => {
    expect(pct(1)).toBe('100 %')
    expect(pct(1).codePointAt(3)).toBe(0x202f)
  })
  it('arrondit et gère les extrêmes', () => {
    expect(pct(0)).toBe('0 %')
    expect(pct(0.255)).toBe('26 %')
    expect(pct(2.5)).toBe('250 %')
    expect(pct(Number.NaN)).toBe('0 %')
  })
})

describe('dateShort', () => {
  it('24 sept. 2026 avec U+00A0', () => {
    expect(dateShort(1790209121887, PARIS)).toBe('24 sept. 2026')
  })
  it('sans fuseau explicite : suit TZ=Europe/Paris', () => {
    expect(dateShort(1790209121887)).toBe('24 sept. 2026')
  })
  it('ne contient aucune espace ordinaire', () => {
    expect(dateShort(Date.UTC(2026, 5, 3), PARIS)).not.toContain(' ')
    expect(dateShort(Date.UTC(2026, 5, 3), PARIS)).toBe(`3${NBSP}juin${NBSP}2026`)
  })
  it('bascule de jour selon le fuseau (23 h 30 UTC = 25 sept. à Paris)', () => {
    const t = Date.UTC(2026, 8, 24, 23, 30)
    expect(dateShort(t, PARIS)).toBe('25 sept. 2026')
    expect(dateShort(t, { timeZone: 'UTC' })).toBe('24 sept. 2026')
  })
  it('date invalide : chaîne vide', () => {
    expect(dateShort(Number.NaN)).toBe('')
    expect(dateShort('pas une date')).toBe('')
  })
})

describe('relative', () => {
  it('il y a 4 min (U+00A0 avant « min »)', () => {
    expect(relative(NOW - 4 * MIN, NOW)).toBe('il y a 4 min')
  })
  it('tronque vers le bas', () => {
    expect(relative(NOW - 4 * MIN - 59_000, NOW)).toBe('il y a 4 min')
  })
  it('à l’instant, secondes, heures', () => {
    expect(relative(NOW - 2000, NOW)).toBe('maintenant')
    expect(relative(NOW - 30_000, NOW)).toBe('il y a 30 s')
    expect(relative(NOW - 3 * HOUR, NOW)).toBe('il y a 3 h')
  })
  it('hier / avant-hier / jours', () => {
    expect(relative(NOW - DAY - HOUR, NOW)).toBe('hier')
    expect(relative(NOW - 2 * DAY - HOUR, NOW)).toBe('avant-hier')
    expect(relative(NOW - 4 * DAY, NOW)).toMatch(/^il y a 4\s*j$/)
  })
  it('semaines, mois et années en toutes lettres', () => {
    expect(relative(NOW - 15 * DAY, NOW)).toBe('il y a 2 sem.')
    expect(relative(NOW - 65 * DAY, NOW)).toBe('il y a 2 mois')
    expect(relative(NOW - 800 * DAY, NOW)).toBe('il y a 2 ans')
  })
  it('futur', () => {
    expect(relative(NOW + 3 * MIN + 1000, NOW)).toBe('dans 3 min')
  })
  it('accepte Date et chaîne ISO ; invalide : chaîne vide', () => {
    expect(relative(new Date(NOW - 4 * MIN), NOW)).toBe('il y a 4 min')
    expect(relative(new Date(NOW - 4 * MIN).toISOString(), new Date(NOW))).toBe('il y a 4 min')
    expect(relative('nope', NOW)).toBe('')
  })
})

describe('-0 jamais affiché', () => {
  it('pct et count ramènent -0 à « 0 »', () => {
    expect(pct(-0.001)).toBe(`0${NNBSP}%`)
    expect(count(-0)).toBe('0')
    expect(pct(-0.001)).not.toContain('-')
  })
})

describe('relative : hier / avant-hier au jour calendaire', () => {
  const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi)

  it('22 h 30 la veille, vu à 21 h le lendemain : « hier » (et non « il y a 22 h »)', () => {
    expect(relative(at(2026, 9, 10, 22, 30), at(2026, 9, 11, 21, 0))).toBe('hier')
  })
  it('25 h d’écart à cheval sur deux jours : « hier »', () => {
    expect(relative(at(2026, 9, 10, 12, 0), at(2026, 9, 11, 13, 0))).toBe('hier')
  })
  it('deux jours calendaires : « avant-hier »', () => {
    expect(relative(at(2026, 9, 9, 23, 0), at(2026, 9, 11, 8, 0))).toBe('avant-hier')
  })
  it('même jour : heures, et sous 1 h minutes même à cheval sur minuit', () => {
    expect(relative(at(2026, 9, 11, 9, 0), at(2026, 9, 11, 20, 0))).toBe(`il y a 11${NBSP}h`)
    expect(relative(at(2026, 9, 10, 23, 50), at(2026, 9, 11, 0, 10))).toBe(`il y a 20${NBSP}min`)
  })
})

describe('bytes', () => {
  it('4,2 Mo avec U+202F', () => {
    expect(bytes(4_200_000)).toBe('4,2 Mo')
    expect(bytes(4_200_000).codePointAt(3)).toBe(0x202f)
  })
  it('unités décimales comme le Finder', () => {
    expect(bytes(0)).toBe('0 o')
    expect(bytes(512)).toBe('512 o')
    expect(bytes(1000)).toBe('1 ko')
    expect(bytes(4_200)).toBe('4,2 ko')
    expect(bytes(3_100_000_000)).toBe('3,1 Go')
    expect(bytes(2_500_000_000_000)).toBe('2,5 To')
  })
  it('passe à l’unité supérieure quand l’arrondi atteint 1 000', () => {
    expect(bytes(999_960)).toBe('1 Mo')
  })
  it('entrées invalides', () => {
    expect(bytes(-5)).toBe('0 o')
    expect(bytes(Number.NaN)).toBe('0 o')
  })
})

describe('count, pluriels, guillemets', () => {
  it('1 234 avec U+202F', () => {
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
  it('pluriels génériques (0 et 1 au singulier)', () => {
    expect(plural(0, 'tag', 'tags')).toBe('tag')
    expect(plural(1, 'tag', 'tags')).toBe('tag')
    expect(plural(2, 'tag', 'tags')).toBe('tags')
    expect(counted(3, 'tag', 'tags')).toBe('3 tags')
    expect(counted(1500, 'tag', 'tags')).toBe(`1${NNBSP}500 tags`)
  })
  it('guillemets français avec espaces insécables', () => {
    expect(guillemets('Dev')).toBe('« Dev »')
  })
})

describe('clock', () => {
  it('formate les durées', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(35)).toBe('0:35')
    expect(clock(62.9)).toBe('1:02')
    expect(clock(3723)).toBe('1:02:03')
    expect(clock(-3)).toBe('0:00')
  })
})
