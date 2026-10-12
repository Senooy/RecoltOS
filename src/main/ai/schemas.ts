/**
 * Output schemas: STRICT JSON Schema sent to the CLIs (`--json-schema`,
 * `--output-schema`) without bounds (OpenAI's strict mode rejects them); bounds applied by zod
 * by TRUNCATING rather than rejecting. Tolerant text decoding (fences, first balanced brace).
 */
import { z } from 'zod'
import { AI_FIELDS, type AiField } from '../../shared/ai-types'

type JsonSchema = Record<string, unknown>

const FIELD_SCHEMA: Record<AiField, JsonSchema> = {
  title: { type: 'string' },
  description: { type: 'string' },
  tags: { type: 'array', items: { type: 'string' } },
  ocr: { type: 'string' },
}

/** Analysis schema (all fields, or a subset for the "Regenerate …" buttons). */
export function analysisSchema(fields: readonly AiField[] = AI_FIELDS): JsonSchema {
  const keep = AI_FIELDS.filter((f) => fields.includes(f))
  return {
    type: 'object',
    additionalProperties: false,
    required: keep,
    properties: Object.fromEntries(keep.map((f) => [f, FIELD_SCHEMA[f]])),
  }
}

export const IMAGE_PROMPT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'style'],
  properties: { prompt: { type: 'string' }, style: { type: 'string' } },
}

const cleanTitle = (s: string): string =>
  s
    .trim()
    .replace(/^["«“]\s*|\s*["»”]$/g, '')
    .replace(/[.。]\s*$/, '')
    .slice(0, 80)
    .trim()

export const AnalysisZ = z
  .object({
    title: z.string().transform(cleanTitle),
    description: z.string().transform((s) => s.trim().slice(0, 400)),
    tags: z.array(z.string()).transform((a) => a.slice(0, 8)),
    ocr: z.string().transform((s) => s.trim().slice(0, 1200)),
  })
  .refine((v) => v.title !== '' || v.description !== '', 'réponse vide')

/** Single field or subset: absent fields default to `''` / `[]`. */
export function analysisZ(fields: readonly AiField[] = AI_FIELDS) {
  if (fields.length === AI_FIELDS.length) return AnalysisZ
  return z
    .object({
      title: z.string().default(''),
      description: z.string().default(''),
      tags: z.array(z.string()).default([]),
      ocr: z.string().default(''),
    })
    .transform((v) => ({
      title: cleanTitle(v.title),
      description: v.description.trim().slice(0, 400),
      tags: v.tags.slice(0, 8),
      ocr: v.ocr.trim().slice(0, 1200),
    }))
    .refine(
      (v) =>
        fields.some((f) => (f === 'tags' ? v.tags.length > 0 : v[f] !== '')) ||
        fields.includes('ocr'),
      'réponse vide',
    )
}

export const ImagePromptZ = z
  .object({
    prompt: z.string().transform((s) => s.trim().slice(0, 2000)),
    style: z.string().transform((s) => s.trim().slice(0, 200)),
  })
  .refine((v) => v.prompt !== '', 'réponse vide')

/**
 * Tolerant decoding: strips ```json fences, takes the first balanced brace (respecting strings).
 * Returns `undefined` if nothing can be decoded.
 */
export function decodeTolerant(text: string): unknown {
  const t = text.trim()
  try {
    return JSON.parse(t)
  } catch {
    // continue
  }
  const unfenced = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  try {
    return JSON.parse(unfenced)
  } catch {
    // continue
  }
  const start = unfenced.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < unfenced.length; i++) {
    const c = unfenced[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(unfenced.slice(start, i + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}
