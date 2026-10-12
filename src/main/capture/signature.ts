/**
 * Nature de la signature de l'app : `codesign -dv --verbose=2 <bundle>` →
 * `adhoc` (« Signature=adhoc »), `identity` (Authority=…), `unsigned`, ou `dev` (non empaquetée).
 */
import { execFile } from 'node:child_process'
import path from 'node:path'

export type SignatureKind = 'adhoc' | 'identity' | 'unsigned' | 'dev'

export function parseCodesign(output: string, exitCode: number | null): SignatureKind {
  if (/Signature=adhoc/i.test(output)) return 'adhoc'
  if (/Authority=/i.test(output)) return 'identity'
  if (exitCode !== 0 || /not signed/i.test(output)) return 'unsigned'
  return 'identity'
}

/** Racine `.app` d'un exécutable (`…/RecoltOS.app/Contents/MacOS/RecoltOS`). */
export function bundleOf(exePath: string): string | null {
  const i = exePath.indexOf('.app/')
  return i < 0 ? null : exePath.slice(0, i + 4)
}

let cached: SignatureKind | null = null

export function getSignatureKind(isPackaged: boolean, exePath: string): Promise<SignatureKind> {
  if (!isPackaged) return Promise.resolve('dev')
  if (cached) return Promise.resolve(cached)
  const bundle = bundleOf(exePath) ?? path.dirname(exePath)
  return new Promise((resolve) => {
    execFile('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], (err, stdout, stderr) => {
      const code = err ? ((err as { code?: number }).code ?? 1) : 0
      cached = parseCodesign(`${stdout}\n${stderr}`, typeof code === 'number' ? code : 1)
      resolve(cached)
    })
  })
}
