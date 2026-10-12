/**
 * `TweetCard` : post X / Instagram / Cosmos rendu nativement (suit le thème).
 * Variantes `light` (grille), `overlay` (Redécouvrir, toujours blanc), `cover` (FanStack, étagère :
 * toujours blanche, largeur fixe 300 px réduite par `transform`), `detail` (vue détail d'un post sans
 * média, 560 px, blanche, texte complet sélectionnable, post cité et fil entiers).
 * Corps tronqué à 8 lignes puis « … » (sauf `detail`).
 * Icône de source en haut à droite : logo X / Instagram / Cosmos (jamais une croix de fermeture).
 */
import { MessageSquareText } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { ItemCard, PostDetailView } from '../../../../../shared/dto/items'
import { CosmosGlyph, InstagramGlyph, XGlyph } from '../../../components/icons'
import { Avatar } from '../../../components/ui'
import { tr } from '../../../i18n'
import { cn } from '../../../lib/cn'
import { mediaSrc } from '../../../lib/media-url'
import { QuotedTweet } from './QuotedTweet'

export type TweetVariant = 'light' | 'overlay' | 'cover' | 'detail'

/**
 * Texte d'un post dans la grille : le lien `t.co` final (média ou post cité joints, déjà visibles
 * ailleurs) est remplacé par « … », comme sur X. Le texte complet reste dans le détail.
 */
export function gridText(text: string): string {
  const stripped = text.replace(/\s*https:\/\/t\.co\/\w+\s*$/, '')
  return stripped !== text && stripped.trim() !== '' ? `${stripped}\n…` : text
}

function SourceGlyph({ source }: { source: ItemCard['source'] }) {
  const common = { size: 18, className: 'text-fg-social' }
  if (source === 'instagram') return <InstagramGlyph {...common} />
  if (source === 'cosmos') return <CosmosGlyph {...common} />
  return <XGlyph {...common} />
}

export function TweetCard({
  card,
  variant = 'light',
  className,
  style,
  full,
}: {
  card: ItemCard
  variant?: TweetVariant
  className?: string
  style?: CSSProperties
  /** Post complet (variante `detail`) : texte entier et fil. */
  full?: PostDetailView | null
}) {
  const detail = variant === 'detail'
  const post = (detail ? (full ?? card.post) : card.post) ?? null
  const name = post?.author.name ?? post?.author.handle ?? card.title ?? ''
  const handle = post?.author.handle ?? null
  const raw = post?.text ?? card.title ?? ''
  const text = detail ? raw : gridText(raw)
  const thread = detail && full ? full.thread : []
  return (
    <article
      data-tweet=""
      className={cn(
        'tweet-card relative flex flex-col rounded-md border px-[14px] pb-[14px] pt-[13px] text-left',
        variant === 'light'
          ? 'border-border-subtle bg-surface text-fg'
          : 'tweet-overlay light-island',
        variant === 'cover' && 'w-[300px]',
        detail && 'tweet-detail w-[560px] select-text',
        className,
      )}
      style={style}
    >
      <header className="flex min-w-0 items-center gap-3 pr-7">
        <Avatar
          src={mediaSrc(post?.author.avatarUrl) ?? null}
          name={name || '?'}
          {...(handle ? { handle } : {})}
          size={36}
        />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold leading-[18px]">{name}</div>
          {handle ? (
            <div className="truncate text-[13px] leading-[18px] text-fg-social">@{handle}</div>
          ) : null}
        </div>
      </header>
      <span
        className="absolute right-[14px] top-[13px]"
        data-testid="source-glyph"
        data-source={card.source}
      >
        <SourceGlyph source={card.source} />
      </span>
      {text ? (
        <p
          className={cn(
            'tweet-text mt-[10px] whitespace-pre-wrap break-words pr-1',
            !detail && 'tweet-body',
          )}
        >
          {text}
        </p>
      ) : null}
      {post?.quoted ? <QuotedTweet quoted={post.quoted} full={detail} /> : null}
      {thread.map((t, i) => (
        <p
          key={i}
          className="tweet-text mt-3 whitespace-pre-wrap break-words border-t border-border-subtle pt-3"
        >
          {t.text}
        </p>
      ))}
      {post && post.threadCount > 0 && !detail ? (
        <footer className="mt-3 flex items-center gap-1.5 text-caption text-fg-subtle">
          <MessageSquareText size={13} strokeWidth={1.75} />
          {tr.card.thread(post.threadCount + 1)}
        </footer>
      ) : null}
    </article>
  )
}
