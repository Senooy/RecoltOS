/**
 * MINIMAL environment for the AI CLIs: built from scratch, never from `process.env`.
 * Deliberately absent: `ANTHROPIC_*` (API key, base URL exported by the login shell),
 * `CLAUDE_CODE_USE_*`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `CLAUDECODE`,
 * `CLAUDE_CODE_ENTRYPOINT`: a key in the env would bill per use instead of the subscription.
 */
import { homedir, tmpdir, userInfo } from 'node:os'

export const FORBIDDEN_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
] as const

export const FALLBACK_PATH_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
]

export function buildCliEnv(
  loginPath: string | null,
  binDirs: readonly string[],
): NodeJS.ProcessEnv {
  const parts = [
    ...binDirs,
    ...(loginPath ? loginPath.split(':') : []),
    ...FALLBACK_PATH_DIRS,
  ].filter((p) => p && p.startsWith('/'))
  const PATH = [...new Set(parts)].join(':')
  let user = 'user'
  try {
    user = userInfo().username
  } catch {
    // account without a passwd entry: generic name
  }
  return {
    HOME: homedir(),
    USER: user,
    LOGNAME: user,
    SHELL: '/bin/zsh',
    LANG: 'fr_FR.UTF-8',
    TMPDIR: tmpdir(),
    PATH,
    NO_COLOR: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
  }
}
