/**
 * Native messaging frames: `[uint32 length, native order = LE on arm64/x64][JSON UTF-8]`.
 * No dependencies (host bundle and tests).
 */
import { MAX_FROM_EXT_BYTES, MAX_TO_EXT_BYTES } from '../shared/bridge/constants'

export type DecodeEvent =
  | { kind: 'message'; value: unknown }
  | { kind: 'invalid'; reason: string }
  | { kind: 'fatal'; reason: string }

/** Incremental decoder: accepts arbitrary chunks, returns complete messages. */
export class FrameDecoder {
  private pending: Buffer = Buffer.alloc(0)
  private dead = false
  private readonly maxBytes: number
  private readonly littleEndian: boolean

  constructor(maxBytes: number = MAX_FROM_EXT_BYTES, littleEndian = true) {
    this.maxBytes = maxBytes
    this.littleEndian = littleEndian
  }

  /** After a `fatal`, nothing more is decoded (the stream must be closed). */
  get closed(): boolean {
    return this.dead
  }

  push(chunk: Buffer): DecodeEvent[] {
    if (this.dead) return []
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk
    const out: DecodeEvent[] = []
    while (this.pending.length >= 4) {
      const len = this.littleEndian ? this.pending.readUInt32LE(0) : this.pending.readUInt32BE(0)
      if (len === 0 || len > this.maxBytes) {
        this.dead = true
        this.pending = Buffer.alloc(0)
        out.push({
          kind: 'fatal',
          reason: len === 0 ? 'empty frame' : `${len}-byte frame refused`,
        })
        return out
      }
      if (this.pending.length < 4 + len) break
      const body = this.pending.subarray(4, 4 + len)
      this.pending = this.pending.subarray(4 + len)
      try {
        out.push({ kind: 'message', value: JSON.parse(body.toString('utf8')) })
      } catch {
        out.push({ kind: 'invalid', reason: 'invalid JSON' })
      }
    }
    return out
  }
}

/** Encodes a message; `null` if it exceeds `maxBytes` (the browser would close the port). */
export function encodeFrame(
  msg: unknown,
  maxBytes: number = MAX_TO_EXT_BYTES,
  littleEndian = true,
): Buffer | null {
  const body = Buffer.from(JSON.stringify(msg), 'utf8')
  if (body.length > maxBytes) return null
  const head = Buffer.alloc(4)
  if (littleEndian) head.writeUInt32LE(body.length, 0)
  else head.writeUInt32BE(body.length, 0)
  return Buffer.concat([head, body])
}

/** NDJSON lines (host ↔ app socket): accumulates and returns complete non-empty lines. */
export class LineDecoder {
  private acc = ''
  private readonly maxChars: number
  constructor(maxChars = 96 * 1024 * 1024) {
    this.maxChars = maxChars
  }
  push(chunk: string): string[] | null {
    this.acc += chunk
    if (this.acc.length > this.maxChars) return null
    const lines: string[] = []
    for (let i = this.acc.indexOf('\n'); i >= 0; i = this.acc.indexOf('\n')) {
      const line = this.acc.slice(0, i)
      this.acc = this.acc.slice(i + 1)
      if (line.trim()) lines.push(line)
    }
    return lines
  }
}
