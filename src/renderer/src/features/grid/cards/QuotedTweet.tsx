/**
 * `QuotedTweet` : post cité en bloc bordé (rayon 12), nom + handle en ligne, texte
 * limité à 4 lignes, première image (si téléchargée) pleine largeur, max 180 px.
 */
import { useState } from 'react'
import type { QuotedPostView } from '../../../../../shared/dto/items'
import { cn } from '../../../lib/cn'
import { mediaSrc } from '../../../lib/media-url'

export function QuotedTweet({
  quoted,
  tone = 'light',
  full = false,
}: {
  quoted: QuotedPostView
  tone?: 'light' | 'viewer'
  /** Texte entier (vue détail). */
  full?: boolean
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const img = mediaSrc(quoted.imageUrls[0])
  return (
    <div
      className={cn(
        'mt-[9px] rounded-xl border px-3 pb-[11px] pt-[10px]',
        tone === 'viewer' ? 'border-[var(--viewer-card-border)]' : 'border-border',
      )}
    >
      {quoted.author ? (
        <div className="flex min-w-0 items-baseline gap-1.5 text-[13px] leading-[18px]">
          {quoted.author.name ? (
            <span className="truncate font-semibold">{quoted.author.name}</span>
          ) : null}
          {quoted.author.handle ? (
            <span className="truncate text-fg-social">@{quoted.author.handle}</span>
          ) : null}
        </div>
      ) : null}
      {quoted.text ? (
        <p
          className={cn(
            'mt-[2px] whitespace-pre-wrap break-words text-[13px] leading-[18px]',
            !full && 'quoted-body',
          )}
        >
          {quoted.text}
        </p>
      ) : null}
      {img && !imgFailed ? (
        <img
          src={img}
          alt=""
          className="mt-2 max-h-[180px] w-full rounded-md object-cover"
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setImgFailed(true)}
        />
      ) : null}
    </div>
  )
}
