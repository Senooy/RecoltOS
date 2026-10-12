/**
 * Common setup of Node tests:
 *  - UTC timezone (deterministic dates);
 *  - no external network access: `fetch` only accepts the loopback and the fake domains
 *    `*.test` / `*.example` (test servers listen on 127.0.0.1);
 *  - never a RECOLTOS_* environment variable inherited from the user's shell;
 *  - deletion of `makeTmpDir` folders at the end of each test file (the process `exit` hook
 *    does not run in vitest workers).
 */
import { afterAll } from 'vitest'
import { removeAllTmpDirs } from '../helpers/tmpdir'

process.env.TZ = 'UTC'
for (const key of Object.keys(process.env)) {
  if (key.startsWith('RECOLTOS_') && key !== 'RECOLTOS_REAL_LIBRARY') delete process.env[key]
}

afterAll(() => removeAllTmpDirs())

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

export function isAllowedTestHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || /\.(test|example|invalid|localhost)$/.test(hostname)
}

const realFetch = globalThis.fetch
globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  let host: string
  try {
    host = new URL(raw).hostname
  } catch {
    return realFetch(input, init)
  }
  if (!isAllowedTestHost(host)) {
    return Promise.reject(new Error(`Réseau externe interdit en test : ${host}`))
  }
  return realFetch(input, init)
}
