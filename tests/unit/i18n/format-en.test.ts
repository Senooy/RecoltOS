/** Formats en anglais (`lib/format.ts` suit la langue active) ; retour au français ensuite. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  bytes,
  count,
  counted,
  dateShort,
  guillemets,
  hourMinute,
  items,
  pct,
  relative,
} from '../../../src/renderer/src/lib/format'
import { setLang } from '../../../src/shared/i18n/lang'

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0)
const MIN = 60_000

beforeAll(() => setLang('en'))
afterAll(() => setLang('fr'))

describe('formats anglais', () => {
  it('nombres, pourcentages et tailles sans espaces insécables', () => {
    expect(count(1234)).toBe('1,234')
    expect(pct(1)).toBe('100%')
    expect(bytes(4_200_000)).toBe('4.2 MB')
    expect(bytes(512)).toBe('512 bytes')
    expect(bytes(1)).toBe('1 byte')
  })
  it('pluriels anglais : seul 1 est au singulier', () => {
    expect(items(0)).toBe('0 items')
    expect(items(1)).toBe('1 item')
    expect(items(1234)).toBe('1,234 items')
    expect(counted(1, 'tag', 'tags')).toBe('1 tag')
    expect(counted(0, 'tag', 'tags')).toBe('0 tags')
  })
  it('dates, heures et durées relatives en anglais', () => {
    expect(dateShort(Date.UTC(2026, 8, 24, 12), { timeZone: 'UTC' })).toBe('Sep 24, 2026')
    expect(relative(NOW - 4 * MIN, NOW)).toBe('4 min. ago')
    expect(relative(NOW, NOW)).toBe('now')
    expect(hourMinute(new Date(2026, 9, 11, 14, 5))).toBe('2:05 PM')
    expect(guillemets('instagram')).toBe('“instagram”')
  })
  it('retour au français : mêmes fonctions, typographie française', () => {
    setLang('fr')
    try {
      expect(pct(1)).toBe('100\u202f%')
      expect(items(1)).toBe('1 élément')
      expect(hourMinute(new Date(2026, 9, 11, 14, 5))).toBe('14\u202fh\u202f05')
      expect(guillemets('x')).toBe('«\u00a0x\u00a0»')
    } finally {
      setLang('en')
    }
  })
})
