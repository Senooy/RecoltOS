/**
 * Stream guards (behaviors observed from the CLIs).
 *
 * claude `--output-format stream-json --verbose`:
 * - `system/init`: `tools` ⊆ {Read, StructuredOutput}, `mcp_servers` empty, otherwise TOOL_VIOLATION;
 * - `system/api_retry`: RATE_LIMITED / NOT_AUTHENTICATED (we kill it: the CLI would retry on its own);
 * - `rate_limit_event` whose `status` ≠ `allowed`: RATE_LIMITED (`resetsAt`);
 * - `assistant`: `tool_use` other than Read (path under `jobs/<id>/`) or StructuredOutput →
 *   TOOL_VIOLATION;
 * - `result`: kept for the final read.
 *
 * codex `exec --json`: allowlist of `item.type` (`agent_message`, `reasoning`); any other
 * type (including `command_execution`, `mcp_tool_call`, `web_search`, `file_change`) → TOOL_VIOLATION;
 * `error` / `turn.failed` are the only error channels; usage is in `turn.completed`.
 */
import { resolve, sep } from 'node:path'
import { AiError } from '../../../shared/ai-types'
import { classifyError } from '../errors'

export const CLAUDE_ALLOWED_TOOLS: ReadonlySet<string> = new Set(['Read', 'StructuredOutput'])
export const CODEX_ALLOWED_ITEMS: ReadonlySet<string> = new Set(['agent_message', 'reasoning'])

type Json = Record<string, unknown>

function parse(line: string): Json | null {
  const t = line.trim()
  if (!t.startsWith('{')) return null
  try {
    const v = JSON.parse(t) as unknown
    return v && typeof v === 'object' ? (v as Json) : null
  } catch {
    return null
  }
}

export interface ClaudeGuard {
  onLine(line: string, stream: 'stdout' | 'stderr'): 'kill' | void
  error: AiError | null
  result: Json | null
  model: string | undefined
  toolUses: string[]
}

export function createClaudeStreamGuard(opts: { jobDir: string }): ClaudeGuard {
  const jobDir = resolve(opts.jobDir) + sep
  const g: ClaudeGuard = {
    error: null,
    result: null,
    model: undefined,
    toolUses: [],
    onLine(line, stream) {
      if (stream !== 'stdout' || g.error) return
      const e = parse(line)
      if (!e) return
      const type = e.type
      if (type === 'system' && e.subtype === 'init') {
        if (typeof e.model === 'string') g.model = e.model
        const tools = Array.isArray(e.tools) ? (e.tools as unknown[]) : []
        const bad = tools.filter((t) => typeof t !== 'string' || !CLAUDE_ALLOWED_TOOLS.has(t))
        const mcp = Array.isArray(e.mcp_servers) ? e.mcp_servers : []
        if (bad.length > 0 || mcp.length > 0) {
          g.error = new AiError(
            'TOOL_VIOLATION',
            `unauthorized tools exposed to the model: ${[...bad.map(String), ...(mcp.length ? ['mcp'] : [])].join(', ')}`,
          )
          return 'kill'
        }
        return
      }
      if (type === 'system' && e.subtype === 'api_retry') {
        const err = typeof e.error === 'string' ? e.error : ''
        const c = classifyError('claude-retry', err)
        if (c.code === 'RATE_LIMITED' || c.code === 'NOT_AUTHENTICATED') {
          g.error = c
          return 'kill'
        }
        return
      }
      if (type === 'rate_limit_event') {
        const info = (e.rate_limit_info ?? {}) as { status?: unknown; resetsAt?: unknown }
        if (
          typeof info.status === 'string' &&
          info.status !== 'allowed' &&
          info.status !== 'allowed_warning'
        ) {
          const resetAt = typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : undefined
          g.error = new AiError('RATE_LIMITED', 'subscription limit reached', {
            ...(resetAt ? { resetAt } : {}),
            raw: info.status,
          })
          return 'kill'
        }
        return
      }
      if (type === 'assistant') {
        const msg = e.message as { content?: unknown } | undefined
        const content = Array.isArray(msg?.content) ? (msg.content as Json[]) : []
        for (const c of content) {
          if (c.type !== 'tool_use') continue
          const name = typeof c.name === 'string' ? c.name : '?'
          g.toolUses.push(name)
          if (name === 'StructuredOutput') continue
          const input = (c.input ?? {}) as { file_path?: unknown }
          const path = typeof input.file_path === 'string' ? resolve(input.file_path) : ''
          if (name !== 'Read' || !path.startsWith(jobDir)) {
            g.error = new AiError(
              'TOOL_VIOLATION',
              name === 'Read'
                ? 'read outside the job folder'
                : `attempt to use the ${name} tool detected in the content`,
            )
            return 'kill'
          }
        }
        return
      }
      if (type === 'result') g.result = e
    },
  }
  return g
}

export interface CodexGuard {
  onLine(line: string, stream: 'stdout' | 'stderr'): 'kill' | void
  error: AiError | null
  lastMessage: string | null
  usage: { input?: number; output?: number }
  model: string | undefined
  itemTypes: string[]
}

export function createCodexStreamGuard(): CodexGuard {
  const g: CodexGuard = {
    error: null,
    lastMessage: null,
    usage: {},
    model: undefined,
    itemTypes: [],
    onLine(line, stream) {
      if (g.error) return
      if (stream === 'stderr') {
        // Informational header "model: …" (never interpreted as an error).
        const m = /^model:\s*(\S+)/i.exec(line.trim())
        if (m) g.model = m[1]
        return
      }
      const e = parse(line)
      if (!e) return
      const type = typeof e.type === 'string' ? e.type : ''
      if (type === 'error') {
        g.error = classifyError('codex-event', typeof e.message === 'string' ? e.message : '')
        return 'kill'
      }
      if (type === 'turn.failed') {
        const err = (e.error ?? {}) as { message?: unknown }
        g.error = classifyError('codex-event', typeof err.message === 'string' ? err.message : '')
        return 'kill'
      }
      if (type === 'turn.completed') {
        const u = (e.usage ?? {}) as { input_tokens?: unknown; output_tokens?: unknown }
        if (typeof u.input_tokens === 'number') g.usage.input = u.input_tokens
        if (typeof u.output_tokens === 'number') g.usage.output = u.output_tokens
        return
      }
      if (type.startsWith('item.')) {
        const item = (e.item ?? {}) as { type?: unknown; item_type?: unknown; text?: unknown }
        const it =
          typeof item.type === 'string'
            ? item.type
            : typeof item.item_type === 'string'
              ? item.item_type
              : '?'
        g.itemTypes.push(it)
        if (!CODEX_ALLOWED_ITEMS.has(it)) {
          g.error = new AiError('TOOL_VIOLATION', 'execution attempt detected in the content', {
            raw: it,
          })
          return 'kill'
        }
        if (it === 'agent_message' && typeof item.text === 'string') g.lastMessage = item.text
      }
    },
  }
  return g
}

/** Tokens on stderr when the stream has no usage: `tokens used\n16 661`. */
export function parseTokensUsed(stderr: string): number | undefined {
  const m = /tokens used\s+([\d\s .,]+)/i.exec(stderr)
  if (!m) return undefined
  const n = Number(m[1]!.replace(/[^\d]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}
