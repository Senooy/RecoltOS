/**
 * Génère `build/icon.png` (1024×1024) : logo ORIGINAL de RecoltOS (un épi de blé crème sur un
 * fond ambre), sur la grille d'icône macOS (corps « squircle » de ~824 px, marge ~100 px, ombre
 * douce). Rien n'est repris d'une autre app. Lancement : `pnpm run icon` (puis `scripts/make-icns.sh`).
 *
 * Le tracé est entièrement calculé ici : le SVG produit est déterministe, donc l'icône aussi.
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SIZE = 1024
const CENTER = SIZE / 2
const BODY = 824 // grille macOS : corps de l'icône
const HALF = BODY / 2

/** Superellipse |x|^n + |y|^n = 1 (n = 5 ≈ « squircle » macOS), échantillonnée en polygone lissé. */
function squirclePath(n = 5, steps = 360): string {
  const pts: string[] = []
  for (let i = 0; i < steps; i += 1) {
    const t = (i / steps) * Math.PI * 2
    const c = Math.cos(t)
    const s = Math.sin(t)
    const x = CENTER + HALF * Math.sign(c) * Math.abs(c) ** (2 / n)
    const y = CENTER + HALF * Math.sign(s) * Math.abs(s) ** (2 / n)
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
}

/** Un grain : ellipse centrée en (cx, cy), inclinée de `deg` degrés. */
function grain(cx: number, cy: number, deg: number, rx = 25, ry = 58): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${deg} ${cx} ${cy})"/>`
}

function wheat(): string {
  const grains: string[] = []
  // Paires de grains le long de l'épi, de bas en haut, qui rétrécissent légèrement.
  const rows = [640, 566, 492, 418, 344]
  rows.forEach((y, i) => {
    const spread = 40 - i * 3
    const ry = 60 - i * 3
    grains.push(grain(CENTER - spread, y, -26, 25, ry), grain(CENTER + spread, y, 26, 25, ry))
  })
  grains.push(grain(CENTER, 262, 0, 24, 64))
  return `
  <g fill="#FFF3D6">
    ${grains.join('\n    ')}
  </g>
  <path d="M${CENTER} 700 C${CENTER - 4} 640 ${CENTER + 4} 420 ${CENTER} 300" fill="none"
        stroke="#FFF3D6" stroke-width="16" stroke-linecap="round"/>
  <path d="M${CENTER} 700 L${CENTER} 790" fill="none" stroke="#FFF3D6" stroke-width="18"
        stroke-linecap="round"/>
  <path d="M${CENTER} 760 C${CENTER - 70} 740 ${CENTER - 120} 700 ${CENTER - 138} 640
           C${CENTER - 92} 650 ${CENTER - 40} 690 ${CENTER} 760Z" fill="#FFF3D6" opacity=".92"/>
  <path d="M${CENTER} 760 C${CENTER + 70} 740 ${CENTER + 120} 700 ${CENTER + 138} 640
           C${CENTER + 92} 650 ${CENTER + 40} 690 ${CENTER} 760Z" fill="#FFF3D6" opacity=".92"/>`
}

export function iconSvg(): string {
  const body = squirclePath()
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#F6BE55"/>
      <stop offset="1" stop-color="#D2641F"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity=".22"/>
      <stop offset=".5" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000000" flood-opacity=".32"/>
    </filter>
    <filter id="ear" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#7A2E08" flood-opacity=".35"/>
    </filter>
  </defs>
  <path d="${body}" fill="url(#bg)" filter="url(#shadow)"/>
  <path d="${body}" fill="url(#sheen)"/>
  <g filter="url(#ear)">${wheat()}</g>
</svg>
`
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '..')
  const out = resolve(root, 'build', 'icon.png')
  mkdirSync(dirname(out), { recursive: true })
  await sharp(Buffer.from(iconSvg()), { density: 72 }).resize(SIZE, SIZE).png().toFile(out)
  console.log(`icône générée : ${out}`)
}

// Garde : comparaison de chemins décodés (et non de chaînes `file://` brutes), pour qu'un chemin
// contenant un espace ou un caractère encodé lance bien le script au lieu de sortir en silence.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
