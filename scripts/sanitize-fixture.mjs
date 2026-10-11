// Anonymise une fixture JSON (réponses d'API de sync, payloads de l'extension) AVANT commit
// (PLAN §2.1, SYNC §8) : jamais de cookie, de jeton, d'identifiant de compte ni de contenu réel.
//
//   node scripts/sanitize-fixture.mjs --in brut.json --out propre.json
//
// Règles (déterministes : une même valeur donne toujours le même pseudonyme dans un fichier) :
//  - clés sensibles (cookie, authorization, ct0, auth_token, sessionid, csrftoken, token, secret,
//    password, bearer…) → "[redacted]" ;
//  - chaînes « Bearer … » → "Bearer [redacted]" ; e-mails → utilisateur@example.test ;
//  - URL : l'hôte est remplacé par example.test, requête et fragment supprimés (signatures CDN) ;
//  - noms et pseudos (name, screen_name, handle, username, author*) → auteur_N / @auteur_N ;
//  - texte libre (text, caption, description, title, full_text, bio) → « texte N » ;
//  - nombres, booléens, null et structure conservés.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const SENSITIVE_KEY =
  /cookie|authorization|ct0|auth_token|sessionid|csrf|token|secret|passw|bearer|api[_-]?key/i
const NAME_KEY =
  /^(name|screen_name|handle|username|author_?name|author_?handle|full_name|display_name)$/i
const TEXT_KEY = /^(text|caption|description|title|full_text|bio|note|notes|ocr_text|content)$/i

export function makeSanitizer() {
  const names = new Map()
  const texts = new Map()
  const pseudo = (map, value, prefix) => {
    if (!map.has(value)) map.set(value, `${prefix} ${map.size + 1}`)
    return map.get(value)
  }
  const cleanString = (s) => {
    if (/^Bearer\s+\S+/i.test(s)) return 'Bearer [redacted]'
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'utilisateur@example.test'
    if (/^https?:\/\//i.test(s)) {
      try {
        const u = new URL(s)
        return `https://example.test${u.pathname === '/' ? '' : u.pathname.replace(/[^/]+/g, (seg) => (/^\d+$/.test(seg) ? seg : 'x'))}`
      } catch {
        return 'https://example.test/x'
      }
    }
    return s
  }
  const walk = (value, key = '') => {
    if (Array.isArray(value)) return value.map((v) => walk(v, key))
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]))
    }
    if (typeof value !== 'string') return value
    if (SENSITIVE_KEY.test(key)) return '[redacted]'
    if (NAME_KEY.test(key)) {
      const bare = value.replace(/^@/, '')
      const p = pseudo(names, bare, 'auteur').replace(' ', '_')
      return value.startsWith('@') ? `@${p}` : p
    }
    if (TEXT_KEY.test(key) && !/^https?:\/\//i.test(value)) return pseudo(texts, value, 'texte')
    return cleanString(value)
  }
  return (data) => walk(data)
}

export function sanitize(data) {
  return makeSanitizer()(data)
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file://').href) {
  const { values } = parseArgs({ options: { in: { type: 'string' }, out: { type: 'string' } } })
  if (!values.in || !values.out) {
    console.error('usage : sanitize-fixture.mjs --in <brut.json> --out <propre.json>')
    process.exit(2)
  }
  const clean = sanitize(JSON.parse(readFileSync(values.in, 'utf8')))
  writeFileSync(values.out, `${JSON.stringify(clean, null, 2)}\n`)
  console.log(`sanitize-fixture : ${values.out}`)
}
