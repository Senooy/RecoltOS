/**
 * `scripts/sanitize-fixture.mjs` : anonymisation par liste blanche et garde de fin
 * anti-fuite. Les valeurs ci-dessous sont des FAUSSES données réalistes (pas de donnée réelle).
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

describe('sanitize-fixture : liste blanche', () => {
  const clean = sanitize(RAW) as Record<string, Record<string, unknown>>
  const raw = text(clean)

  it('ne laisse subsister aucune donnée personnelle de la source', () => {
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

  it('pseudonymise les identifiants (chaîne et nombre) sans casser leur forme', () => {
    const u = clean.champ_1 as Record<string, unknown>
    expect(u.rest_id).toMatch(/^\d{10}$/)
    expect(u.id_str).toBe(u.rest_id) // même valeur → même pseudonyme
    expect(typeof u.user_id).toBe('number')
    expect(u.user_id).not.toBe(987654321)
    expect(u.entryId).toMatch(/^tweet-\d{10}$/)
    expect(u.code).toMatch(/^id_\d+$/)
  })

  it('texte libre sous toute clé, nom légal, téléphone et géolocalisation', () => {
    const u = clean.champ_1 as Record<string, unknown>
    expect(u.alt_text).toMatch(/^texte \d+$/)
    expect(u.message).toMatch(/^texte \d+$/)
    expect(u.location).toMatch(/^texte \d+$/)
    expect(u.legal_name).toMatch(/^auteur_\d+$/)
    expect(u.phone).toBe('[redacted]')
    expect(u.lat).toBe('[redacted]')
    expect(u.champ_2).toMatch(/^texte \d+$/) // clé inconnue renommée, valeur synthétique
  })

  it('conserve la structure : clés connues, nombres, types, dates', () => {
    const u = clean.champ_1 as Record<string, unknown>
    expect(u.type).toBe('photo')
    expect(u.created_at).toBe('2024-05-06T10:00:00Z')
    expect(u.views).toBe(120000)
    expect(u.profile_image_url_https).toBe('https://example.test/x/x/x.jpg')
  })

  it('la clé d’objet qui est un pseudo est renommée, de façon déterministe', () => {
    expect(Object.keys(clean)).toEqual(['champ_1'])
    const run = makeSanitizer()
    expect(text(run(RAW))).toBe(text(run(RAW)))
  })

  it('--keep-keys / keepKeys conserve des clés structurelles supplémentaires', () => {
    const out = sanitize({ edge_thing: { page_info: 1 } }, { keepKeys: ['edge_thing'] })
    expect(Object.keys(out as object)).toEqual(['edge_thing'])
  })
})

describe('sanitize-fixture : garde de fin', () => {
  it('détecte une chaîne de 8 caractères ou plus qui survit', () => {
    const source = { note: 'Texte confidentiel de 30 caractères', court: 'abc' }
    const fuite = { champ: 'préfixe Texte confidentiel de 30 caractères suffixe', court: 'abc' }
    expect(findLeaks(source, fuite)).toEqual(['Texte confidentiel de 30 caractères'])
    expect(() => assertNoLeak(source, fuite)).toThrow(/survivent/)
    // La valeur réelle n'est jamais recopiée dans le message d'erreur.
    expect(() => assertNoLeak(source, fuite)).not.toThrow(/confidentiel/)
  })

  it('ne signale pas les valeurs structurelles conservées volontairement', () => {
    const source = { content_type: 'application/json', created_at: '2024-05-06T10:00:00Z' }
    const run = makeSanitizer()
    const out = run(source)
    expect(findLeaks(source, out, run.survivors)).toEqual([])
    // Sans la liste des valeurs conservées, elles seraient prises pour des fuites.
    expect(findLeaks(source, out).length).toBeGreaterThan(0)
  })

  it('la fonction sanitize() passe la garde sur des données variées', () => {
    expect(() => sanitize(RAW)).not.toThrow()
  })
})

describe('sanitize-fixture : CLI', () => {
  const run = (args: string[]) =>
    spawnSync('node', ['scripts/sanitize-fixture.mjs', ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })

  it('écrit une sortie propre et signale les clés renommées sans les nommer', () => {
    const dir = makeTmpDir('sanitize-cli')
    const from = join(dir, 'in.json')
    const to = join(dir, 'out.json')
    writeFileSync(from, JSON.stringify(RAW))
    const r = run(['--in', from, '--out', to])
    expect(r.status, r.stderr).toBe(0)
    expect(readFileSync(to, 'utf8')).not.toContain('Dupontel')
    expect(r.stderr).toContain('clé(s) inconnue(s)')
    expect(r.stderr).not.toContain('realuser')
    const withReport = run(['--in', from, '--out', to, '--report-keys'])
    expect(withReport.stderr).toContain('realuser_dupont')
  })

  it('fichier absent ou JSON invalide : message français, code 1, pas de trace de pile', () => {
    const dir = makeTmpDir('sanitize-cli-bad')
    const to = join(dir, 'out.json')
    const missing = run(['--in', join(dir, 'absent.json'), '--out', to])
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('sanitize-fixture : lecture impossible')
    expect(missing.stderr).not.toMatch(/\n\s+at /)
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ pas du json')
    const invalid = run(['--in', bad, '--out', to])
    expect(invalid.status).toBe(1)
    expect(invalid.stderr).toContain('JSON invalide')
    expect(invalid.stderr).not.toMatch(/\n\s+at /)
    expect(existsSync(to)).toBe(false)
  })

  it('usage sans arguments : code 2 et rien d’écrit', () => {
    const dir = makeTmpDir('sanitize-cli-usage')
    const r = run(['--in', join(dir, 'absent.json')])
    expect(r.status).toBe(2)
    expect(existsSync(join(dir, 'out.json'))).toBe(false)
  })
})
