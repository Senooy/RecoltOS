/**
 * `screencapture` process: arguments per mode, `execFile` (never `exec`) with a
 * minimal environment, binary replaceable in development (`RECOLTOS_SCREENCAPTURE_BIN`, refused
 * in the packaged app). Success = non-empty file with a PNG signature, never the exit code alone.
 */
import { execFile } from 'node:child_process'
import { open, stat } from 'node:fs/promises'
import type { CaptureMode } from '../../shared/prefs'
import { mt } from '../i18n'

export const DEFAULT_SCREENCAPTURE = '/usr/sbin/screencapture'

export function screencaptureBin(isPackaged: boolean, env = process.env): string {
  return (!isPackaged && env.RECOLTOS_SCREENCAPTURE_BIN) || DEFAULT_SCREENCAPTURE
}

function fakeEnv(env = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (e): e is [string, string] => e[0].startsWith('FAKE_SCREENCAPTURE_') && e[1] !== undefined,
    ),
  )
}

export function buildArgs(mode: CaptureMode, out: string, displayIndex = 1): string[] {
  const base = ['-x', '-t', 'png']
  switch (mode) {
    case 'region':
      return ['-i', '-s', ...base, out]
    case 'window':
      return ['-i', '-w', '-o', ...base, out]
    case 'screen':
      return ['-D', String(displayIndex), ...base, out]
  }
}

export function runScreencapture(
  bin: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        env: {
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
          HOME: process.env.HOME ?? '',
          // Fake test binary (development only): settings passed through.
          ...(bin !== DEFAULT_SCREENCAPTURE ? fakeEnv() : {}),
        },
        timeout: 5 * 60_000,
        ...(signal ? { signal } : {}),
      },
      (err, _stdout, stderr) => {
        const code =
          err && typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
            ? (err as unknown as { code: number }).code
            : err
              ? null
              : 0
        resolve({ code, stderr: String(stderr ?? '') })
      },
    )
  })
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Existing, non-empty file starting with the PNG signature. */
export async function isPngFile(path: string): Promise<boolean> {
  try {
    const st = await stat(path)
    if (!st.isFile() || st.size <= PNG_SIG.length) return false
    const fh = await open(path, 'r')
    try {
      const buf = Buffer.alloc(8)
      await fh.read(buf, 0, 8, 0)
      return buf.equals(PNG_SIG)
    } finally {
      await fh.close()
    }
  } catch {
    return false
  }
}

/**
 * « Capture RecoltOS 2026-10-11 à 14.32.07.png » (local time); in English
 * « RecoltOS Capture 2026-10-11 at 14.32.07.png ».
 */
export function dropFileName(at: Date, n = 1): string {
  const p = (v: number) => String(v).padStart(2, '0')
  const base = mt().capture.fileBase(
    `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`,
    `${p(at.getHours())}.${p(at.getMinutes())}.${p(at.getSeconds())}`,
  )
  return n > 1 ? `${base} (${n}).png` : `${base}.png`
}
