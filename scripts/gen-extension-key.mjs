// Génère la clé de l'extension (champ `key` du manifest) pour un identifiant d'extension STABLE
// (SYNC §1, PLAN §1.18 : `allowed_origins` du manifest de l'hôte natif).
//
//   node scripts/gen-extension-key.mjs [--pem-out <fichier.pem>]
//
// Affiche le `key` (clé publique SPKI en base64) et l'identifiant d'extension qui en découle
// (SHA-256 de la clé publique, 16 premiers octets, alphabet a–p). La clé privée n'est ni affichée ni
// écrite, sauf avec --pem-out (à garder hors du dépôt : seule la clé publique est nécessaire).
import { createHash, generateKeyPairSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

/** Identifiant Chrome : 32 caractères a–p dérivés du SHA-256 de la clé publique DER. */
export function extensionIdFromPublicKey(der) {
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32)
  return [...hex]
    .map((c) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(c, 16)))
    .join('')
}

export function generateExtensionKey() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return {
    key: der.toString('base64'),
    id: extensionIdFromPublicKey(der),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file://').href) {
  const { values } = parseArgs({ options: { 'pem-out': { type: 'string' } } })
  const { key, id, privatePem } = generateExtensionKey()
  if (values['pem-out']) writeFileSync(values['pem-out'], privatePem, { mode: 0o600 })
  console.log(JSON.stringify({ key, id }, null, 2))
}
