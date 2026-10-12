/**
 * `Avatar`: image (`recolt://…`) or, failing that / on error, initials on a
 * hue derived from a hash of the handle (same handle → same color). Instagram avatars are
 * almost all expired: the initials fallback is the common case, never a hole.
 */
import { useState, type CSSProperties } from 'react'
import { cn } from '../../lib/cn'
import './ui.css'

/** FNV-1a 32-bit: deterministic, no dependency. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Hue 0–359 for a handle (case-insensitive, ignores a leading « @ »). */
export function hashHue(handle: string): number {
  return fnv1a(handle.trim().replace(/^@/, '').toLowerCase()) % 360
}

/** « GamesLover with a Preference » → « GP » (first and last word); one word → 1 letter; empty → « ? ». */
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
  /** `recolt://…` URL or null (never an http(s) URL). */
  src?: string | null
  name: string
  /** Handle with or without « @ »: used for the fallback color. */
  handle?: string
  /** Diameter in px (36 on X cards). */
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
