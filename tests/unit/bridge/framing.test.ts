/**
 * Native messaging frames: arbitrary cuts, multi-messages, length 0, 0xFFFFFFFF.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { encodeFrame, FrameDecoder, LineDecoder } from '../../../src/host/framing'

function split(buf: Buffer, cuts: number[]): Buffer[] {
  const points = [...new Set(cuts.map((c) => c % (buf.length + 1)))].sort((a, b) => a - b)
  const out: Buffer[] = []
  let prev = 0
  for (const p of points) {
    out.push(buf.subarray(prev, p))
    prev = p
  }
  out.push(buf.subarray(prev))
  return out
}

describe('FrameDecoder', () => {
  it('rebuilds messages whatever the cuts (fast-check)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.jsonValue(), { minLength: 1, maxLength: 8 }),
        fc.array(fc.nat(), { maxLength: 12 }),
        (msgs, cuts) => {
          const stream = Buffer.concat(msgs.map((m) => encodeFrame(m) as Buffer))
          const d = new FrameDecoder()
          const got: unknown[] = []
          for (const part of split(stream, cuts)) {
            for (const ev of d.push(part)) {
              expect(ev.kind).toBe('message')
              if (ev.kind === 'message') got.push(ev.value)
            }
          }
          expect(got).toEqual(msgs.map((m) => JSON.parse(JSON.stringify(m)) as unknown))
        },
      ),
    )
  })

  it('length 0 → clean close, no message', () => {
    const d = new FrameDecoder()
    const evs = d.push(Buffer.from([0, 0, 0, 0, 1, 2, 3]))
    expect(evs).toEqual([{ kind: 'fatal', reason: 'trame vide' }])
    expect(d.closed).toBe(true)
    expect(d.push(encodeFrame({ a: 1 }) as Buffer)).toEqual([])
  })

  it('0xFFFFFFFF → clean close (beyond 64 MiB)', () => {
    const d = new FrameDecoder()
    const evs = d.push(Buffer.from([0xff, 0xff, 0xff, 0xff]))
    expect(evs[0]?.kind).toBe('fatal')
    expect(d.closed).toBe(true)
  })

  it('invalid JSON: frame ignored, the stream continues', () => {
    const body = Buffer.from('{oups')
    const head = Buffer.alloc(4)
    head.writeUInt32LE(body.length)
    const d = new FrameDecoder()
    const evs = d.push(Buffer.concat([head, body, encodeFrame({ ok: true }) as Buffer]))
    expect(evs).toEqual([
      { kind: 'invalid', reason: 'JSON invalide' },
      { kind: 'message', value: { ok: true } },
    ])
  })

  it('encodeFrame refuses more than 1 MB to the extension', () => {
    expect(encodeFrame({ s: 'x'.repeat(1024 * 1024) })).toBeNull()
    expect(encodeFrame({ s: 'x'.repeat(1000) })?.readUInt32LE(0)).toBe(1008)
  })
})

describe('LineDecoder', () => {
  it('NDJSON lines cut anywhere', () => {
    const d = new LineDecoder()
    expect(d.push('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(d.push(':2}\n\n')).toEqual(['{"b":2}'])
  })
})
