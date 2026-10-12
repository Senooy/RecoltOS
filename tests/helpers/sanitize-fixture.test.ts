/**
 * `scripts/sanitize-fixture.mjs`: anonymization by allowlist and end guard
 * against leaks. The values below are FAKE, realistic data (no real data).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertNoLeak,
  findLeaks,
  makeSanitizer,
  sanitize,
} from '../../scripts/sanitize-fixture.mjs'
import { REPO_ROOT } from './paths'
import { makeTmpDir } from './tmpdir'

const RAW = {
  realuser_dupont: {
    rest_id: '1234567890123',
    id_str: '1234567890123',
    user_id: 987654321,
    legal_name: 'Jeanne Dupontel',
    location: 'Rue des Lilas, Lyon',
    phone: '+33 6 12 34 56 78',
    alt_text: 'Photo de la famille Dupontel à Lyon',
    message: 'Rendez-vous chez moi demain soir',
    unknown_field: 'valeur inconnue réelle',
    profile_image_url_https:
      'https://pbs.twimg.com/profile_images/1234567890123/jdupontel_normal.jpg?s=1',
    type: 'photo',
    created_at: '2024-05-06T10:00:00Z',
    views: 120000,
    entryId: 'tweet-1789012345678',
    code: 'C7abcDEF12x',
    lat: 45.7578,
  },
}

const text = (v: unknown): string => JSON.stringify(v)

describe('sanitize-fixture: allowlist', () => {
  const clean = sanitize(RAW) as Record<string, Record<string, unknown>>
  const raw = text(clean)

  it('leaves no personal data from the source behind', () => {
    for (const secret of [
      'realuser',
      'dupont',
      'Dupontel',
      '1234567890123',
      '987654321',
      'Lilas',
      'Lyon',
      '12 34 56',
      'famille',
      'Rendez-vous',
      'valeur inconnue',
      'unknown_field',
      'twimg',
      'jdupontel',
      'C7abcDEF12x',
      '45.7578',
      '1789012345678',
    ]) {
      expect(raw, secret).not.toContain(secret)
    }
  })

  it('pseudonymizes identifiers (string and number) without breaking their shape', () => {
    const u = clean.champ_1 as Record<string, unknown>
    expect(u.rest_id).toMatch(/^\d{10}$/)
    expect(u.id_str).toBe(u.rest_id) // same value → same pseudonym
    expect(typeof u.user_id).toBe('number')
    expect(u.user_id).not.toBe(987654321)
    expect(u.entryId).toMatch(/^tweet-\d{10}$/)
    expect(u.code).toMatch(/^id_\d+$/)
  })

  it('free text under any key, legal name, phone and geolocation', () => {
    const u = clean.champ_1 as Record<string, unknown>
    expect(u.alt_text).toMatch(/^texte \d+$/)
    expect(u.message).toMatch(/^texte \d+$/)
    expect(u.location).toMatch(/^texte \d+$/)
    expect(u.legal_name).toMatch(/^auteur_\d+$/)
    expect(u.phone).toBe('[redacted]')
    expect(u.lat).toBe('[redacted]')
    expect(u.champ_2).toMatch(/^texte \d+$/) // unknown key renamed, synthetic value
  })

  it('keeps the structure: known keys, numbers, types, dates', () => {
    const u = clean.champ_1 as Record<string, unknown>
    expect(u.type).toBe('photo')
    expect(u.created_at).toBe('2024-05-06T10:00:00Z')
    expect(u.views).toBe(120000)
    expect(u.profile_image_url_https).toBe('https://example.test/x/x/x.jpg')
  })

  it('the object key that is a username is renamed, deterministically', () => {
    expect(Object.keys(clean)).toEqual(['champ_1'])
    const run = makeSanitizer()
    expect(text(run(RAW))).toBe(text(run(RAW)))
  })

  it('--keep-keys / keepKeys keeps additional structural keys', () => {
    const out = sanitize({ edge_thing: { page_info: 1 } }, { keepKeys: ['edge_thing'] })
    expect(Object.keys(out as object)).toEqual(['edge_thing'])
  })
})

describe('sanitize-fixture: end guard', () => {
  it('detects a string of 8 characters or more that survives', () => {
    const source = { note: 'Texte confidentiel de 30 caractères', court: 'abc' }
    const fuite = { champ: 'préfixe Texte confidentiel de 30 caractères suffixe', court: 'abc' }
    expect(findLeaks(source, fuite)).toEqual(['Texte confidentiel de 30 caractères'])
    expect(() => assertNoLeak(source, fuite)).toThrow(/survivent/)
    // The real value is never copied into the error message.
    expect(() => assertNoLeak(source, fuite)).not.toThrow(/confidentiel/)
  })

  it('does not flag structural values kept on purpose', () => {
    const source = { content_type: 'application/json', created_at: '2024-05-06T10:00:00Z' }
    const run = makeSanitizer()
    const out = run(source)
    expect(findLeaks(source, out, run.survivors)).toEqual([])
    // Without the list of kept values, they would be taken for leaks.
    expect(findLeaks(source, out).length).toBeGreaterThan(0)
  })

  it('the sanitize() function passes the guard on varied data', () => {
    expect(() => sanitize(RAW)).not.toThrow()
  })
})

describe('sanitize-fixture: CLI', () => {
  const run = (args: string[]) =>
    spawnSync('node', ['scripts/sanitize-fixture.mjs', ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })

  it('writes clean output and reports renamed keys without naming them', () => {
    const dir = makeTmpDir('sanitize-cli')
    const from = join(dir, 'in.json')
    const to = join(dir, 'out.json')
    writeFileSync(from, JSON.stringify(RAW))
    const r = run(['--in', from, '--out', to])
    expect(r.status, r.stderr).toBe(0)
    expect(readFileSync(to, 'utf8')).not.toContain('Dupontel')
    expect(r.stderr).toContain('unknown key(s)')
    expect(r.stderr).not.toContain('realuser')
    const withReport = run(['--in', from, '--out', to, '--report-keys'])
    expect(withReport.stderr).toContain('realuser_dupont')
  })

  it('missing file or invalid JSON: French message, code 1, no stack trace', () => {
    const dir = makeTmpDir('sanitize-cli-bad')
    const to = join(dir, 'out.json')
    const missing = run(['--in', join(dir, 'absent.json'), '--out', to])
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('sanitize-fixture: cannot read')
    expect(missing.stderr).not.toMatch(/\n\s+at /)
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ pas du json')
    const invalid = run(['--in', bad, '--out', to])
    expect(invalid.status).toBe(1)
    expect(invalid.stderr).toContain('invalid JSON')
    expect(invalid.stderr).not.toMatch(/\n\s+at /)
    expect(existsSync(to)).toBe(false)
  })

  it('usage without arguments: code 2 and nothing written', () => {
    const dir = makeTmpDir('sanitize-cli-usage')
    const r = run(['--in', join(dir, 'absent.json')])
    expect(r.status).toBe(2)
    expect(existsSync(join(dir, 'out.json'))).toBe(false)
  })
})
