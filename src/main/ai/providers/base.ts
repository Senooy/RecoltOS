/**
 * Base des fournisseurs CLI (AI §3.2) : prompt, empreinte, fichiers envoyés, décodage tolérant,
 * validation zod bornante, wrappers champ unique. Chaque fournisseur n'implémente que `exec`
 * (lancement du CLI et lecture de sa sortie) et `status`.
 */
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ZodType } from 'zod'
import {
  AI_FIELDS,
  AiError,
  type AiAnalysis,
  type AiCallMeta,
  type AiCallOptions,
  type AiCliId,
  type AiField,
  type AiImagePrompt,
  type AiInput,
  type AiProvider,
  type AiResult,
  type ProviderStatus,
  type ProviderTestResult,
} from '../../../shared/ai-types'
import type { AiPrefs } from '../../../shared/prefs'
import type { ResolvedCli } from '../cli/resolve'
import { promptSha256, sentFilesOf } from '../privacy'
import { SYSTEM_FR, buildAnalyzePrompt, buildImagePromptPrompt, sentTextChars } from '../prompts'
import {
  IMAGE_PROMPT_SCHEMA,
  ImagePromptZ,
  analysisSchema,
  analysisZ,
  decodeTolerant,
} from '../schemas'

export interface CliRuntime {
  /** Binaire résolu (mis en cache par l'appelant). */
  resolve(): Promise<ResolvedCli | null>
  loginPath(): Promise<string | null>
  /** `<userData>/ai-sandbox/<fournisseur>` (cwd fixe, 0700). */
  sandboxDir: string
  prefs(): AiPrefs
  /** Entrée de test (image synthétique 256×256) pour le test de connexion niveau 2. */
  makeTestInput?(jobDir: string): Promise<AiInput>
}

export interface ExecSpec {
  task: 'analyze' | 'imagePrompt'
  system: string
  prompt: string
  schema: Record<string, unknown>
  input: AiInput
  jobDir: string
}

export interface ExecOutput {
  json: unknown
  model?: string
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
}

export type AiPrefsLike = AiPrefs

export abstract class CliProviderBase implements AiProvider {
  abstract readonly id: AiCliId
  protected readonly rt: CliRuntime
  constructor(rt: CliRuntime) {
    this.rt = rt
  }

  abstract status(): Promise<ProviderStatus>
  protected abstract exec(spec: ExecSpec, o: AiCallOptions): Promise<ExecOutput>

  protected async withJobDir<T>(o: AiCallOptions, fn: (dir: string) => Promise<T>): Promise<T> {
    if (o.jobDir) {
      await mkdir(o.jobDir, { recursive: true, mode: 0o700 })
      return fn(o.jobDir)
    }
    const dir = join(
      this.rt.sandboxDir,
      'jobs',
      `t${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    )
    await mkdir(dir, { recursive: true, mode: 0o700 })
    try {
      return await fn(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  protected async structured<T>(
    task: ExecSpec['task'],
    input: AiInput,
    prompt: string,
    schema: Record<string, unknown>,
    zod: ZodType<T>,
    o: AiCallOptions,
  ): Promise<AiResult<T>> {
    const started = Date.now()
    return this.withJobDir(o, async (jobDir) => {
      const out = await this.exec({ task, system: SYSTEM_FR, prompt, schema, input, jobDir }, o)
      const parsed = zod.safeParse(
        typeof out.json === 'string' ? decodeTolerant(out.json) : out.json,
      )
      if (!parsed.success) throw new AiError('BAD_OUTPUT', 'réponse invalide', { retryable: true })
      const meta: AiCallMeta = {
        provider: this.id,
        durationMs: Date.now() - started,
        sentFiles: sentFilesOf(input),
        sentTextChars: sentTextChars(SYSTEM_FR, prompt),
        promptSha256: promptSha256(SYSTEM_FR, prompt),
        ...(out.model ? { model: out.model } : {}),
        ...(out.costUsd !== undefined ? { costUsd: out.costUsd } : {}),
        ...(out.inputTokens !== undefined ? { inputTokens: out.inputTokens } : {}),
        ...(out.outputTokens !== undefined ? { outputTokens: out.outputTokens } : {}),
      }
      return { value: parsed.data, meta }
    })
  }

  /** Analyse limitée à `fields` (tous par défaut). */
  analyzeFields(
    i: AiInput,
    fields: readonly AiField[],
    o: AiCallOptions,
  ): Promise<AiResult<AiAnalysis>> {
    const prompt = buildAnalyzePrompt(i, this.id, { fields, ...(o.retry ? { retry: true } : {}) })
    return this.structured('analyze', i, prompt, analysisSchema(fields), analysisZ(fields), o)
  }

  analyze(i: AiInput, o: AiCallOptions): Promise<AiResult<AiAnalysis>> {
    return this.analyzeFields(i, AI_FIELDS, o)
  }
  async describe(i: AiInput, o: AiCallOptions) {
    const r = await this.analyzeFields(i, ['description'], o)
    return { value: { description: r.value.description }, meta: r.meta }
  }
  async title(i: AiInput, o: AiCallOptions) {
    const r = await this.analyzeFields(i, ['title'], o)
    return { value: { title: r.value.title }, meta: r.meta }
  }
  async tags(i: AiInput, o: AiCallOptions) {
    const r = await this.analyzeFields(i, ['tags'], o)
    return { value: { tags: r.value.tags }, meta: r.meta }
  }
  async ocr(i: AiInput, o: AiCallOptions) {
    const r = await this.analyzeFields(i, ['ocr'], o)
    return { value: { ocr: r.value.ocr }, meta: r.meta }
  }
  imagePrompt(i: AiInput, o: AiCallOptions): Promise<AiResult<AiImagePrompt>> {
    const prompt = buildImagePromptPrompt(i, this.id, o.retry ? { retry: true } : {})
    return this.structured('imagePrompt', i, prompt, IMAGE_PROMPT_SCHEMA, ImagePromptZ, o)
  }

  /** Niveau 1 (gratuit) puis, si `live`, un vrai appel sur une image synthétique (niveau 2). */
  async test(o: { live: boolean }): Promise<ProviderTestResult> {
    const status = await this.status()
    if (!o.live || !status.installed || status.loggedIn === false) {
      return {
        ok: status.installed && status.loggedIn !== false,
        status,
        ...(!status.installed
          ? { error: 'CLI introuvable' }
          : status.loggedIn === false
            ? { error: 'Non connecté' }
            : {}),
      }
    }
    if (!this.rt.makeTestInput) return { ok: false, status, error: 'test indisponible' }
    const ac = new AbortController()
    try {
      const r = await this.withJobDir({ signal: ac.signal, timeoutMs: 120_000 }, async (jobDir) => {
        const input = await this.rt.makeTestInput!(jobDir)
        return this.analyze(input, { signal: ac.signal, timeoutMs: 120_000, jobDir })
      })
      return {
        ok: true,
        status,
        latencyMs: r.meta.durationMs,
        ...(r.meta.model ? { model: r.meta.model } : {}),
      }
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError('PROCESS', String(err))
      return { ok: false, status, error: `${e.code} : ${e.message}` }
    }
  }
}
