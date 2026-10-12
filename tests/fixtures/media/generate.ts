/**
 * Fixtures médias synthétiques, générées à la volée dans un dossier temporaire :
 * aucun binaire versionné, aucune donnée réelle.
 * - `exif6.jpg` 300×200 avec orientation EXIF 6 (affichée 200×300) ;
 * - `anim.webp` 3 images 120×80 (rouge, vert, bleu) ;
 * - `photo.png` 320×200 avec alpha → `photo.heic`, `photo.psd` (sips), `photo.tiff` (sharp) ;
 * - `portrait.heic` 300×200 stocké avec orientation 6 (affiché 200×300), coin rouge en haut à
 *   gauche des pixels stockés → en haut à droite une fois redressé (ImageIO via `swift`) ;
 * - `rot90.mp4` 320×240, 2 s, avec audio, matrice d'affichage 90° (ffmpeg `-display_rotation`) ;
 * - `long.mp4` 1280×720, 10 s, avec audio (aperçu ≤ 8 s) ;
 * - `blocks.webp` vignette 4 bandes de couleurs (palette).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

export const SIPS = '/usr/bin/sips'

function findTool(name: string): string | undefined {
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return undefined
}

export const FFMPEG = findTool('ffmpeg')
export const FFPROBE = findTool('ffprobe')
export const HAS_SIPS = existsSync(SIPS)

export interface MediaFixtures {
  dir: string
  exif6Jpg: string
  animWebp: string
  alphaPng: string
  heic?: string
  /** Absent si `swift` (outils en ligne de commande Xcode) n'est pas utilisable. */
  heicOriented?: string
  psd?: string
  tiff: string
  rot90Mp4?: string
  longMp4?: string
  blocksWebp: string
}

/** Couleurs des bandes de `blocks.webp`, de la plus large à la plus étroite. */
export const BLOCK_COLORS = ['#d23c28', '#1e5aa0', '#f0c814', '#28a050'] as const
export const BLOCK_WIDTHS = [160, 100, 60, 40] as const
export const ANIM_FRAMES = ['#ff0000', '#00ff00', '#0000ff'] as const

export async function generateMediaFixtures(dir: string): Promise<MediaFixtures> {
  mkdirSync(dir, { recursive: true })
  const f: MediaFixtures = {
    dir,
    exif6Jpg: join(dir, 'exif6.jpg'),
    animWebp: join(dir, 'anim.webp'),
    alphaPng: join(dir, 'photo.png'),
    tiff: join(dir, 'photo.tiff'),
    blocksWebp: join(dir, 'blocks.webp'),
  }

  // JPEG 300×200 stocké avec orientation 6 (rotation 90° horaire à l'affichage).
  await sharp({ create: { width: 300, height: 200, channels: 3, background: '#336699' } })
    .jpeg({ quality: 90 })
    .withMetadata({ orientation: 6 })
    .toFile(f.exif6Jpg)

  // WebP animé : 3 images unies.
  const frames = await Promise.all(
    ANIM_FRAMES.map((c) =>
      sharp({ create: { width: 120, height: 80, channels: 3, background: c } })
        .png()
        .toBuffer(),
    ),
  )
  await sharp(frames, { join: { animated: true } })
    .webp({ loop: 0, delay: [100, 100, 100], lossless: true })
    .toFile(f.animWebp)

  // PNG avec alpha : source des formats « étrangers » et du TIFF.
  await sharp({
    create: {
      width: 320,
      height: 200,
      channels: 4,
      background: { r: 20, g: 160, b: 90, alpha: 0.6 },
    },
  })
    .png()
    .toFile(f.alphaPng)
  await sharp(f.alphaPng).tiff({ compression: 'lzw' }).toFile(f.tiff)

  // Vignette à bandes (largeurs 160/100/60/40 sur 360 px) pour la palette.
  const raw = Buffer.alloc(360 * 240 * 3)
  for (let y = 0; y < 240; y++) {
    let x0 = 0
    BLOCK_COLORS.forEach((hex, i) => {
      const n = Number.parseInt(hex.slice(1), 16)
      const w = BLOCK_WIDTHS[i] ?? 0
      for (let x = x0; x < x0 + w; x++) {
        const o = (y * 360 + x) * 3
        raw[o] = (n >> 16) & 0xff
        raw[o + 1] = (n >> 8) & 0xff
        raw[o + 2] = n & 0xff
      }
      x0 += w
    })
  }
  await sharp(raw, { raw: { width: 360, height: 240, channels: 3 } })
    .webp({ quality: 80 })
    .toFile(f.blocksWebp)

  if (HAS_SIPS) {
    f.heic = join(dir, 'photo.heic')
    f.psd = join(dir, 'photo.psd')
    execFileSync(SIPS, ['-s', 'format', 'heic', f.alphaPng, '--out', f.heic], { stdio: 'ignore' })
    execFileSync(SIPS, ['-s', 'format', 'psd', f.alphaPng, '--out', f.psd], { stdio: 'ignore' })
    f.heicOriented = await orientedHeic(dir)
  }

  if (FFMPEG) {
    const base = join(dir, 'base.mp4')
    const q = ['-hide_banner', '-loglevel', 'error', '-y']
    execFileSync(FFMPEG, [
      ...q,
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=25:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      base,
    ])
    f.rot90Mp4 = join(dir, 'rot90.mp4')
    execFileSync(FFMPEG, [...q, '-display_rotation', '90', '-i', base, '-c', 'copy', f.rot90Mp4])
    f.longMp4 = join(dir, 'long.mp4')
    execFileSync(FFMPEG, [
      ...q,
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=30:duration=10',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:duration=10',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      f.longMp4,
    ])
  }
  return f
}

const HEIC_ORIENT_SWIFT = join(import.meta.dirname, 'heic-orient.swift')

/**
 * HEIC 300×200 avec orientation 6, coin 60×60 rouge en haut à gauche des pixels stockés.
 * `/usr/bin/swift` existe même sans les outils Xcode (il échoue alors) : on vérifie
 * `xcode-select -p`, on l'exécute réellement et on renvoie `undefined` en cas d'échec.
 */
async function orientedHeic(dir: string): Promise<string | undefined> {
  const w = 300
  const h = 200
  const raw = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3
      if (x < 60 && y < 60) raw[o] = 255
      else raw[o + 2] = 200
    }
  }
  const src = join(dir, 'portrait-src.png')
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toFile(src)
  const dst = join(dir, 'portrait.heic')
  try {
    // Sans outils de développement, le shim `swift` ouvrirait la fenêtre d'installation.
    execFileSync('/usr/bin/xcode-select', ['-p'], { stdio: 'ignore' })
    execFileSync('/usr/bin/swift', [HEIC_ORIENT_SWIFT, src, dst, '6'], {
      stdio: 'ignore',
      timeout: 120_000,
    })
  } catch {
    return undefined
  }
  return existsSync(dst) ? dst : undefined
}
