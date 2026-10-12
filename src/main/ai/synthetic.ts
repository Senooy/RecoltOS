/**
 * Image synthétique 256×256 du test de connexion niveau 2 : PNG encodé à la main (zlib),
 * dégradé et damier, sans aucune donnée de l'utilisateur. Le media-worker en fait le JPEG envoyé.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import type { AiInput } from '../../shared/ai-types'
import type { MediaCaller } from '../jobs/handlers/types'
import { prepareImageForAi } from './media'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

export function syntheticPng(size = 256): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x++) {
      const o = row + 1 + x * 3
      const check = ((x >> 5) + (y >> 5)) % 2 === 0
      raw[o] = check ? 230 : Math.round((x / size) * 255)
      raw[o + 1] = check ? 120 : Math.round((y / size) * 255)
      raw[o + 2] = check ? 40 : 200
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export async function syntheticInput(media: MediaCaller, jobDir: string): Promise<AiInput> {
  await mkdir(jobDir, { recursive: true, mode: 0o700 })
  const src = join(jobDir, 'synthetic.png')
  await writeFile(src, syntheticPng())
  const m = await prepareImageForAi(media, src, jobDir, 'img1.jpg')
  return {
    itemUuid: '00000000-0000-4000-8000-000000000000',
    kind: 'image',
    media: [m],
    context: {},
    vocabulary: ['abstrait', 'texture', 'colore'],
  }
}
