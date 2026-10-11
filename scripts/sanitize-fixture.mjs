// Anonymise une fixture JSON (réponses d'API de sync, payloads de l'extension) AVANT commit
// (PLAN §2.1, SYNC §8, QA §5.2) : jamais de cookie, de jeton, d'identifiant de compte ni de contenu réel.
//
//   node scripts/sanitize-fixture.mjs --in brut.json --out propre.json [--keep-keys a,b] [--report-keys]
//
// Approche par LISTE BLANCHE (tout ce qui n'est pas explicitement conservé est remplacé) :
//  - clés d'objet : seules les clés structurelles connues (KNOWN_KEYS, suffixes `_id`/`_count`/`_at`/
//    `_url`… et préfixes `is_`/`has_`…) et celles de `--keep-keys` survivent ; toute autre clé (pseudo
//    utilisé comme clé de dictionnaire, champ inconnu) devient `champ_N` ; les clés numériques longues
//    deviennent des identifiants synthétiques ;
//  - nombres, booléens, null : conservés, sauf sous une clé d'identifiant (`id`, `rest_id`, `user_id`,
//    `*_id`, `pk`…) où un grand nombre est remplacé par un identifiant synthétique, et sous une clé
//    de géolocalisation ou de téléphone (« [redacted] ») ;
//  - chaînes : seules sont conservées les valeurs structurelles courtes sous une clé de type
//    (`type`, `kind`, `source`, `mime`…) et les dates ISO ; tout le reste devient synthétique :
//      · clés sensibles (cookie, authorization, ct0, auth_token, sessionid, csrf, token, secret,
//        password, bearer, api_key) → "[redacted]" (quelle que soit la valeur, même objet) ;
//      · « Bearer … » → "Bearer [redacted]" ; e-mails → utilisateur@example.test ;
//      · URL : hôte → example.test, requête et fragment supprimés, segments de chemin → x (extension
//        d'image/média conservée, donc plus aucun identifiant ni chiffre d'avatar) ;
//      · identifiants (chaîne) : suites de 6 chiffres ou plus et jetons opaques → synthétiques ;
//      · noms et pseudos (name, screen_name, handle, username, author*, legal_name…) → auteur_N / @auteur_N ;
//      · tout autre texte, quelle que soit la clé (alt_text, message, location…) → « texte N ».
//  - déterministe : une même valeur donne le même pseudonyme dans un fichier.
//
// Garde de fin (QA §5.2.4a) : `assertNoLeak(source, propre)` échoue si une chaîne de 8 caractères ou
// plus de la source survit dans la sortie (hors valeurs et clés structurelles conservées volontairement) ;
// la CLI n'écrit rien dans ce cas. Les clés inconnues renommées sont comptées ; `--report-keys` les
// liste (sur stderr) pour décider quoi ajouter à `--keep-keys`.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const SENSITIVE_KEY =
  /cookie|authorization|ct0|auth_token|sessionid|csrf|token|secret|passw|bearer|api[_-]?key/i
const GEO_KEY =
  /^(lat|lng|lon|latitude|longitude|geo|coordinates|phone|phone_number|mobile|tel|address|street|postal_code|zip)$/i
const NAME_KEY =
  /^(name|screen_name|handle|username|user_name|author_?name|author_?handle|full_name|display_name|legal_name|nickname|given_name|family_name|first_name|last_name)$/i
// Clés d'identifiant : `id`, `pk`, `rest_id`, `id_str`, `user_id`, `userId`, `in_reply_to_status_id_str`…
const ID_KEY =
  /^(id|id_str|ids|pk|uuid|guid|code|media_key|entry_?id)$|(_id|_ids|Id|Ids|_id_str|_key)$/
// Clés dont la valeur chaîne est un énumérateur structurel (conservée si courte et sans espace).
const ENUM_KEY =
  /^(type|__typename|kind|source|platform|status|state|media_type|content_type|mime|mime_type|ext|extension|lang|language|version|schema|format|variant|role|reason|display_type|tweet_display_type)$|(_type|_status|_kind|_state)$/i
// Clés de texte libre : toujours « texte N » (documentaire, le défaut est déjà « texte N »).
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
const SAFE_ENUM = /^[A-Za-z][A-Za-z0-9_./+-]{0,39}$/
const MEDIA_EXT = /\.(jpe?g|png|webp|gif|mp4|m3u8|mov|webm|json|svg)$/i

/** Clés structurelles connues (API de sync X / Instagram / Cosmos, enveloppes génériques). */
export const KNOWN_KEYS = new Set(
  `id ids pk uuid guid type kind source platform status state version schema format role reason lang language
  data items item results result entries entry edges node nodes cursor next_cursor previous_cursor page pages
  count total size length offset limit has_more more_available next_max_id auto_load_more_enabled num_results
  created_at updated_at deleted_at taken_at timestamp date time duration
  text full_text caption title description bio note notes content ocr_text body message
  name screen_name handle username user_name author authors author_name author_handle full_name display_name legal_name
  url urls uri href src link source_url media_url media_url_https expanded_url display_url profile_image_url
  profile_image_url_https profile_pic_url avatar avatar_url thumbnail thumbnail_url thumb poster poster_url
  width height original_width original_height aspect_ratio bitrate fps mime mime_type content_type ext extension
  media medias image images video videos photo photos variants video_info video_versions image_versions2 candidates
  carousel_media carousel_media_count sizes large medium small orig resize original_info focus_rects x y w h
  user users account tweet tweets post posts quoted quoted_status thread retweeted_status legacy core entities
  extended_entities hashtags symbols user_mentions tags collections collection saves save bookmarks
  timeline instructions entryId itemContent tweet_results user_results timeline_v2 views edge_sidecar_to_children
  favorite_count retweet_count reply_count quote_count bookmark_count like_count comment_count view_count
  followers_count friends_count statuses_count is_private is_verified verified protected
  headers request response error errors code status_code ok success meta metadata payload params variables features
  fieldToggles queryId operationName variables_json elements blocks element
  indices start end index position order sort_index sortIndex rank
  alt_text ext_alt_text location
  email likes comments shares replies retweets reposts followers following
  __typename`
    .split(/\s+/)
    .filter(Boolean),
)
// Suffixes et préfixes structurels (noms de champs d'API, pas des pseudos).
const KEY_SHAPE =
  /(_id|_ids|Id|_str|_count|Count|_at|At|_url|Url|URL|_https|_type|Type|_status|_key|_results|_result|_info|_versions|_width|_height|_enabled|_ms|_ts)$|^(is|has|can|should|__)[_A-Z]/

export function makeSanitizer(options = {}) {
  const keep = new Set([...KNOWN_KEYS, ...(options.keepKeys ?? [])])
  const maps = {
    name: new Map(),
    text: new Map(),
    id: new Map(),
    field: new Map(),
    opaque: new Map(),
  }
  const survivors = new Set() // chaînes conservées volontairement telles quelles (clés et valeurs)
  const renamedKeys = new Set()
  const pseudo = (map, value, make) => {
    if (!map.has(value)) map.set(value, make(map.size + 1))
    return map.get(value)
  }
  const numericId = (digits) => pseudo(maps.id, digits, (n) => String(9_000_000_000 + n))
  const keepString = (s) => {
    survivors.add(s)
    return s
  }

  const cleanKey = (k) => {
    // Les noms de champs sensibles (cookie, Authorization…) sont structurels : seule leur valeur est masquée.
    if (keep.has(k) || KEY_SHAPE.test(k) || SENSITIVE_KEY.test(k) || GEO_KEY.test(k))
      return keepString(k)
    if (/^\d{1,4}$/.test(k)) return keepString(k) // indices de tableau / petits entiers
    if (/^\d{5,}$/.test(k)) return numericId(k)
    renamedKeys.add(k)
    return pseudo(maps.field, k, (n) => `champ_${n}`)
  }

  const cleanUrl = (s) => {
    try {
      const u = new URL(s)
      const path = u.pathname === '/' ? '' : u.pathname
      const clean = path.replace(/[^/]+/g, (seg) => {
        if (/^\d{1,4}$/.test(seg)) return seg
        const ext = MEDIA_EXT.exec(seg)?.[0] ?? ''
        return `x${ext.toLowerCase()}`
      })
      return `https://example.test${clean}`
    } catch {
      return 'https://example.test/x'
    }
  }

  const cleanId = (s) => {
    if (/^\d{1,5}$/.test(s)) return keepString(s)
    if (/^\d+$/.test(s)) return numericId(s)
    // Préfixes structurels d'identifiants composés (`tweet-123…`, `user-123…`) ; le reste est synthétique.
    const m =
      /^(tweet|user|cursor|conversationthread|profile|module|entry|media|item)([-_:])(.+)$/i.exec(s)
    if (m) return `${m[1]}${m[2]}${/^\d+$/.test(m[3]) ? numericId(m[3]) : cleanId(m[3])}`
    return pseudo(maps.opaque, s, (n) => `id_${n}`)
  }

  const cleanString = (s, key) => {
    if (SENSITIVE_KEY.test(key) || GEO_KEY.test(key)) return '[redacted]'
    if (/^Bearer\s+\S+/i.test(s)) return 'Bearer [redacted]'
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'utilisateur@example.test'
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return cleanUrl(s)
    if (NAME_KEY.test(key)) {
      const bare = s.replace(/^@/, '')
      const p = pseudo(maps.name, bare, (n) => `auteur_${n}`)
      return s.startsWith('@') ? `@${p}` : p
    }
    if (ISO_DATE.test(s)) return keepString(s)
    if (ID_KEY.test(key)) return cleanId(s)
    if (ENUM_KEY.test(key) && SAFE_ENUM.test(s)) return keepString(s)
    return pseudo(maps.text, s, (n) => `texte ${n}`)
  }

  const walk = (value, key = '') => {
    if (Array.isArray(value)) {
      if (SENSITIVE_KEY.test(key)) return '[redacted]'
      return value.map((v) => walk(v, key))
    }
    if (value && typeof value === 'object') {
      if (SENSITIVE_KEY.test(key)) return '[redacted]'
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [cleanKey(k), walk(v, k)]))
    }
    if (typeof value === 'string') return cleanString(value, key)
    if (typeof value === 'number') {
      if (SENSITIVE_KEY.test(key) || GEO_KEY.test(key)) return '[redacted]'
      if (ID_KEY.test(key) && Math.abs(value) >= 1_000_000) {
        return Number(numericId(String(Math.trunc(Math.abs(value)))))
      }
    }
    return value
  }

  const run = (data) => walk(data)
  run.survivors = survivors
  run.renamedKeys = renamedKeys
  return run
}

/** Toutes les chaînes d'un JSON : valeurs, et clés si `withKeys`. */
function strings(data, withKeys, out = []) {
  if (Array.isArray(data)) for (const v of data) strings(v, withKeys, out)
  else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      if (withKeys) out.push(k)
      strings(v, withKeys, out)
    }
  } else if (typeof data === 'string') out.push(data)
  return out
}

/**
 * Garde anti-fuite (QA §5.2.4a) : renvoie les chaînes de ≥ 8 caractères de `source` qui subsistent
 * dans `clean` (comme chaîne entière ou comme sous-chaîne), hors `allowed` (valeurs et clés
 * structurelles conservées volontairement). Liste vide = aucune fuite.
 */
export function findLeaks(source, clean, allowed = new Set(), minLength = 8) {
  const out = strings(clean, true).filter((s) => !allowed.has(s))
  const haystack = out.join('\u0000')
  const leaks = new Set()
  for (const s of strings(source, true)) {
    if (s.length < minLength || allowed.has(s)) continue
    if (haystack.includes(s)) leaks.add(s)
  }
  return [...leaks]
}

export function assertNoLeak(source, clean, allowed = new Set()) {
  const leaks = findLeaks(source, clean, allowed)
  if (leaks.length > 0) {
    // Ne jamais afficher la valeur (donnée réelle) : longueur seulement.
    throw new Error(
      `${leaks.length} chaîne(s) de 8 caractères ou plus de la source survivent dans la sortie ` +
        `(longueurs : ${leaks.map((l) => l.length).join(', ')})`,
    )
  }
}

/** Anonymise `data` puis vérifie la garde de fin ; lève une erreur si une chaîne de la source survit. */
export function sanitize(data, options = {}) {
  const run = makeSanitizer(options)
  const clean = run(data)
  assertNoLeak(data, clean, run.survivors)
  return clean
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file://').href) {
  const { values } = parseArgs({
    options: {
      in: { type: 'string' },
      out: { type: 'string' },
      'keep-keys': { type: 'string' },
      'report-keys': { type: 'boolean', default: false },
    },
  })
  if (!values.in || !values.out) {
    console.error(
      'usage : sanitize-fixture.mjs --in <brut.json> --out <propre.json> [--keep-keys a,b,c] [--report-keys]',
    )
    process.exit(2)
  }
  // Lecture et analyse protégées : fichier absent, illisible ou JSON invalide → message en français, sortie 1
  // (pas de trace de pile). Rien n'est écrit dans ce cas.
  let source
  try {
    source = JSON.parse(readFileSync(values.in, 'utf8'))
  } catch (e) {
    const reason = e instanceof SyntaxError ? 'JSON invalide' : (e?.code ?? e?.message ?? String(e))
    console.error(
      `sanitize-fixture : lecture impossible de ${values.in} (${reason}), rien n'a été écrit`,
    )
    process.exit(1)
  }
  const run = makeSanitizer({
    keepKeys: (values['keep-keys'] ?? '').split(',').filter(Boolean),
  })
  const clean = run(source)
  try {
    assertNoLeak(source, clean, run.survivors)
  } catch (e) {
    console.error(`sanitize-fixture : ÉCHEC, rien n'a été écrit : ${e.message}`)
    process.exit(1)
  }
  try {
    writeFileSync(values.out, `${JSON.stringify(clean, null, 2)}\n`)
  } catch (e) {
    console.error(
      `sanitize-fixture : écriture impossible de ${values.out} (${e?.code ?? e?.message ?? e})`,
    )
    process.exit(1)
  }
  console.log(`sanitize-fixture : ${values.out}`)
  if (run.renamedKeys.size > 0) {
    console.error(
      `sanitize-fixture : ${run.renamedKeys.size} clé(s) inconnue(s) renommée(s) en champ_N` +
        ' (--keep-keys pour en conserver, --report-keys pour les lister)',
    )
    if (values['report-keys']) console.error([...run.renamedKeys].join(', '))
  }
}
