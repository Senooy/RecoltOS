/**
 * Source post card of the Details panel: name, handle, full selectable text,
 * nested quoted post (64 px thumbnails), thread separated by rules, footer
 * "x.com · 24 Sep 2026" (date = `created_at`) and "Open".
 */
import { ExternalLink } from 'lucide-react'
import type { ItemDetail } from '../../../../shared/dto/items'
import { CosmosGlyph, InstagramGlyph, XGlyph } from '../../components/icons'
import { tr } from '../../i18n'
import { dateShort } from '../../lib/format'
import { mediaSrc } from '../../lib/media-url'

const HOSTS: Record<string, string> = {
  x: 'x.com',
  instagram: 'instagram.com',
  cosmos: 'cosmos.so',
}

export function sourceHostOf(detail: Pick<ItemDetail, 'source' | 'sourceUrl'>): string | null {
  if (detail.sourceUrl) {
    try {
      return new URL(detail.sourceUrl).hostname.replace(/^www\./, '')
    } catch {
      // invalid link: fall back to the source
    }
  }
  return HOSTS[detail.source] ?? null
}

function Glyph({ source }: { source: string }) {
  const p = { size: 14, className: 'text-[#8d8d8d]' }
  if (source === 'instagram') return <InstagramGlyph {...p} />
  if (source === 'cosmos') return <CosmosGlyph {...p} />
  return <XGlyph {...p} />
}

function Thumbs({ urls }: { urls: readonly string[] }) {
  const shown = urls.map((u) => mediaSrc(u)).filter((u): u is string => !!u)
  if (shown.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {shown.map((src) => (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          className="h-16 w-16 rounded-md object-cover"
          loading="lazy"
          decoding="async"
        />
      ))}
    </div>
  )
}

export function SourcePostCard({
  detail,
  onOpen,
}: {
  detail: ItemDetail
  onOpen: (() => void) | null
}) {
  const post = detail.post
  if (!post) return null
  const name = post.author.name ?? post.author.handle ?? ''
  const host = sourceHostOf(detail)
  return (
    <section data-testid="source-post" className="viewer-postcard">
      <div className="select-text">
        {name ? (
          <div className="text-[13px] font-semibold leading-[17px] text-white">{name}</div>
        ) : null}
        {post.author.handle ? (
          <div className="text-[11.5px] leading-[15px] text-[var(--viewer-fg-muted)]">
            @{post.author.handle}
          </div>
        ) : null}
        {post.text ? (
          <p className="mt-[15px] whitespace-pre-wrap break-words text-[12px] leading-[17px] text-[var(--viewer-fg-2)]">
            {post.text}
          </p>
        ) : null}
        {post.quoted ? (
          <div className="mt-3 rounded-[10px] border border-[#3a3a3c] px-3 py-[10px]">
            {post.quoted.author ? (
              <div className="flex min-w-0 items-baseline gap-1.5">
                {post.quoted.author.name ? (
                  <span className="truncate text-[13px] font-semibold text-white">
                    {post.quoted.author.name}
                  </span>
                ) : null}
                {post.quoted.author.handle ? (
                  <span className="truncate text-[12px] text-[var(--viewer-fg-muted)]">
                    @{post.quoted.author.handle}
                  </span>
                ) : null}
              </div>
            ) : null}
            {post.quoted.text ? (
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-[19px] text-[var(--viewer-fg-2)]">
                {post.quoted.text}
              </p>
            ) : null}
            <Thumbs urls={post.quoted.imageUrls} />
          </div>
        ) : null}
        {post.thread.map((t, i) => (
          <div key={i} className="mt-3 border-t border-[#373739] pt-3">
            <p className="whitespace-pre-wrap break-words text-[12px] leading-[17px] text-[var(--viewer-fg-2)]">
              {t.text}
            </p>
            <Thumbs urls={t.imageUrls} />
          </div>
        ))}
      </div>
      <footer className="mt-[22px] flex items-center border-t border-[#373739] pt-[13px] text-[12px] text-[#8d8d8d]">
        <Glyph source={detail.source} />
        <span className="ml-[7px] truncate">
          {host ? `${host} · ` : ''}
          {dateShort(detail.createdAt)}
        </span>
        {onOpen ? (
          <button
            type="button"
            className="ml-auto flex items-center gap-1 text-[12.5px] text-[#c0c0c0] hover:text-white"
            onClick={onOpen}
          >
            {tr.viewer.open}
            <ExternalLink size={13} strokeWidth={1.75} />
          </button>
        ) : null}
      </footer>
    </section>
  )
}
