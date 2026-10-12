/**
 * Génère `build/icon.png` (1024×1024) : logo RecoltOS « Germe double » (une graine pointue et deux
 * feuilles symétriques, nacre douce irisée lavande / beurre / bleu ciel) sur un squircle noir satiné,
 * posé sur la grille d'icône macOS (corps de ~824 px, marge ~100 px, ombre douce). Génère aussi les
 * icônes de l'extension navigateur (`extension/icons/{16,32,48,128}.png`, squircle plein cadre, sans
 * marge, lisible en petit). Lancement : `pnpm run icon` (puis `scripts/make-icns.sh`).
 *
 * Tout est calculé ici (aucun aléa) : le SVG produit est déterministe, donc les PNG aussi.
 * Dessin en coordonnées 0..100.
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SIZE = 1024
const BODY = 824 // grille macOS : corps de l'icône
const MARGIN = (SIZE - BODY) / 2
/** Mise à l'échelle du symbole dans le squircle (1 = dessin de la planche). */
const SYMBOL_SCALE = 1.04

/** Superellipse |x|^n + |y|^n = 1 (n = 5 ≈ « squircle » macOS) sur 0..100, polygone lissé. */
function squirclePath(n = 5, steps = 360): string {
  const pts: string[] = []
  for (let i = 0; i < steps; i += 1) {
    const t = (i / steps) * Math.PI * 2
    const c = Math.cos(t)
    const s = Math.sin(t)
    const x = 50 + 50 * Math.sign(c) * Math.abs(c) ** (2 / n)
    const y = 50 + 50 * Math.sign(s) * Math.abs(s) ** (2 / n)
    pts.push(`${x.toFixed(3)},${y.toFixed(3)}`)
  }
  return `M${pts.join('L')}Z`
}

/** Le logo en coordonnées 0..100 (fond + symbole), `id` suffixe tous les identifiants. */
function logoDefsAndBody(id: string): { defs: string; body: string; symbol: string } {
  const sq = squirclePath()
  const defs = `
    <linearGradient id="bg${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2c30"/><stop offset=".6" stop-color="#161719"/><stop offset="1" stop-color="#0c0d0e"/></linearGradient>
    <radialGradient id="sheen${id}" cx=".5" cy="0" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="main${id}" gradientUnits="userSpaceOnUse" x1="28" y1="18" x2="72" y2="88"><stop offset="0" stop-color="#f8f9fb"/><stop offset=".55" stop-color="#d2d9e0"/><stop offset="1" stop-color="#a9bccb"/></linearGradient>
    <radialGradient id="i0${id}" gradientUnits="userSpaceOnUse" cx="80" cy="26" r="34"><stop offset="0" stop-color="#b394ee" stop-opacity=".7"/><stop offset="1" stop-color="#b394ee" stop-opacity="0"/></radialGradient>
    <radialGradient id="i1${id}" gradientUnits="userSpaceOnUse" cx="80" cy="76" r="30"><stop offset="0" stop-color="#efdc86" stop-opacity=".65"/><stop offset="1" stop-color="#efdc86" stop-opacity="0"/></radialGradient>
    <radialGradient id="i2${id}" gradientUnits="userSpaceOnUse" cx="20" cy="74" r="36"><stop offset="0" stop-color="#7eb0d2" stop-opacity=".75"/><stop offset="1" stop-color="#7eb0d2" stop-opacity="0"/></radialGradient>
    <filter id="bevel${id}" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.1" result="b"/><feOffset in="b" dx="1.1" dy="1.7" result="o"/>
      <feComposite in="SourceAlpha" in2="o" operator="out" result="rim"/>
      <feFlood flood-color="#fff" flood-opacity=".7"/><feComposite in2="rim" operator="in" result="hl"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="hl"/></feMerge></filter>
    <filter id="drop${id}" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="2.2" stdDeviation="2.4" flood-color="#000" flood-opacity=".55"/></filter>
    <mask id="m${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#000"/><g fill="#fff">
      <path d="M50 52 C60 59 73 66 73 76 C73 85 63 90 50 90 C37 90 27 85 27 76 C27 66 40 59 50 52 Z"/>
      <path d="M47 45 C30 46 18 38 17 21 C34 20 46 28 47 45 Z"/>
      <path d="M53 45 C54 28 66 20 83 21 C82 38 70 46 53 45 Z"/></g></mask>`
  const body = `<path d="${sq}" fill="url(#bg${id})"/><path d="${sq}" fill="url(#sheen${id})"/>`
  // Le symbole occupe x 17..83, y 20..90 : on le centre optiquement (centre ≈ 50, 55) puis on l'agrandit.
  const k = SYMBOL_SCALE
  const symbol = `<g transform="translate(${(50 - 50 * k).toFixed(3)} ${(50 - 55 * k).toFixed(3)}) scale(${k})"><g filter="url(#drop${id})"><g filter="url(#bevel${id})"><g mask="url(#m${id})"><rect width="100" height="100" fill="url(#main${id})"/><rect width="100" height="100" fill="url(#i0${id})"/><rect width="100" height="100" fill="url(#i1${id})"/><rect width="100" height="100" fill="url(#i2${id})"/></g></g></g></g>`
  return { defs, body, symbol }
}

/** Icône d'app : corps de 824 px dans 1024, ombre portée douce. */
export function iconSvg(): string {
  const { defs, body, symbol } = logoDefsAndBody('a')
  const k = BODY / 100
  const place = `translate(${MARGIN} ${MARGIN}) scale(${k})`
  // L'ombre est appliquée hors du groupe mis à l'échelle : ses paramètres sont en pixels.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>${defs}
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000000" flood-opacity=".32"/>
    </filter>
  </defs>
  <g filter="url(#shadow)"><g transform="${place}">${body}</g></g>
  <g transform="${place}">${symbol}</g>
</svg>
`
}

/** Icône d'extension : squircle plein cadre (pas de marge ni d'ombre), carré `size` px. */
export function extensionIconSvg(size: number): string {
  const { defs, body, symbol } = logoDefsAndBody('e')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs>${defs}</defs>${body}${symbol}
</svg>
`
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '..')
  const out = resolve(root, 'build', 'icon.png')
  mkdirSync(dirname(out), { recursive: true })
  await sharp(Buffer.from(iconSvg()), { density: 72 }).resize(SIZE, SIZE).png().toFile(out)
  console.log(`icône générée : ${out}`)
  const extDir = resolve(root, 'extension', 'icons')
  mkdirSync(extDir, { recursive: true })
  for (const size of [16, 32, 48, 128]) {
    // Rendu à 8× puis réduction (lanczos) : bords nets même à 16 px.
    await sharp(Buffer.from(extensionIconSvg(size * 8)), { density: 72 })
      .resize(size, size)
      .png()
      .toFile(resolve(extDir, `${size}.png`))
  }
  console.log(`icônes d'extension générées : ${extDir}`)
}

// Garde : comparaison de chemins décodés (et non de chaînes `file://` brutes), pour qu'un chemin
// contenant un espace ou un caractère encodé lance bien le script au lieu de sortir en silence.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
