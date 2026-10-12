/**
 * `Avatar` : image (`recolt://…`) ou, à défaut / en cas d'erreur, initiales sur une
 * teinte dérivée d'un hash du handle (même handle → même couleur). Les avatars Instagram sont
 * presque tous expirés : le repli par initiales est le cas courant, jamais un trou.
 */
import { useState, type CSSProperties } from 'react'
import { cn } from '../../lib/cn'
import './ui.css'

/** FNV-1a 32 bits : déterministe, sans dépendance. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Teinte 0–359 pour un handle (insensible à la casse et au « @ » initial). */
export function hashHue(handle: string): number {
  return fnv1a(handle.trim().replace(/^@/, '').toLowerCase()) % 360
}

/** « GamesLover with a Preference » → « GP » (premier et dernier mot) ; un seul mot → 1 lettre ; vide → « ? ». */
export function initials(name: string, handle?: string): string {
  const words = name
    .replace(/^@/, '')
    .split(/[\s._-]+/u)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
  const first = (w: string | undefined): string => {
    const m = w ? /[\p{L}\p{N}]/u.exec(w) : null
    return m ? m[0].toUpperCase() : ''
  }
  const letters =
    words.length >= 2 ? first(words[0]) + first(words[words.length - 1]) : first(words[0])
  if (letters) return letters
  const h = first(handle?.replace(/^@/, ''))
  return h || '?'
}

export interface AvatarProps {
  /** URL `recolt://…` ou null (jamais d'URL http(s)). */
  src?: string | null
  name: string
  /** Handle sans ou avec « @ » : sert à la couleur de repli. */
  handle?: string
  /** Diamètre en px (36 sur les cartes X). */
  size?: number
  className?: string
}

export function Avatar({ src, name, handle, size = 36, className }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src) && failedSrc !== src
  const style = {
    width: size,
    height: size,
    fontSize: Math.max(10, Math.round(size * 0.39)),
    '--avatar-hue': hashHue(handle ?? name),
  } as CSSProperties
  return (
    <span
      aria-hidden="true"
      data-avatar=""
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold leading-none',
        showImage ? 'bg-surface-muted' : 'ui-avatar-tint text-fg-muted',
        className,
      )}
      style={style}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          width={size}
          height={size}
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(src ?? null)}
        />
      ) : (
        initials(name, handle)
      )}
    </span>
  )
}
