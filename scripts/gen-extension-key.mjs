// Generates the extension key (`key` field of the manifest) for a STABLE extension ID
// (`allowed_origins` of the native host manifest).
//
//   node scripts/gen-extension-key.mjs [--pem-out <fichier.pem>]
//
// Prints the `key` (base64 SPKI public key) and the extension ID derived from it
// (SHA-256 of the public key, first 16 bytes, alphabet a–p). The private key is neither printed
// nor written, except with --pem-out (keep it out of the repository: only the public key is needed).
import { createHash, generateKeyPairSync } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

/** Chrome ID: 32 characters a–p derived from the SHA-256 of the DER public key. */
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
