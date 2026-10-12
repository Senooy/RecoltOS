/**
 * Confidentialité : description de ce qui part réellement (fichiers, nombre de caractères,
 * empreinte du prompt) et aperçu avant envoi (JPEG exacts en data URL, prompt complet).
 * Les chemins locaux ne sont jamais exposés : seul le nom `imgN.jpg` du dossier de job l'est.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { AiCallMeta, AiInput } from '../../shared/ai-types'
import { sentTextChars } from './prompts'

export function promptSha256(system: string, prompt: string): string {
  return createHash('sha256').update(system).update('\n\n').update(prompt).digest('hex')
}

export function sentFilesOf(input: AiInput): AiCallMeta['sentFiles'] {
  return input.media.map((m) => ({
    name: basename(m.path),
    bytes: m.bytes,
    width: m.width,
    height: m.height,
  }))
}

export interface PayloadPreview {
  prompt: string
  system: string
  files: (AiCallMeta['sentFiles'][number] & { dataUrl: string })[]
  textChars: number
}

export async function previewOf(
  input: AiInput,
  system: string,
  prompt: string,
): Promise<PayloadPreview> {
  const files: PayloadPreview['files'] = []
  for (const m of input.media) {
    const b64 = (await readFile(m.path)).toString('base64')
    files.push({
      name: basename(m.path),
      bytes: m.bytes,
      width: m.width,
      height: m.height,
      dataUrl: `data:image/jpeg;base64,${b64}`,
    })
  }
  return { prompt, system, files, textChars: sentTextChars(system, prompt) }
}
