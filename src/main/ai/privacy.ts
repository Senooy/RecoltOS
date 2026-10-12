/**
 * Privacy: describes what is actually sent (files, number of characters, prompt fingerprint)
 * and previews it before sending (exact JPEGs as data URLs, full prompt).
 * Local paths are never exposed: only the `imgN.jpg` name in the job folder is.
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
