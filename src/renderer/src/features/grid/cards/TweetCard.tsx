/**
 * `TweetCard` (DESIGN §3.2) : post X / Instagram / Cosmos rendu nativement (suit le thème).
 * Variantes `light` (grille), `overlay` (Redécouvrir, toujours blanc), `cover` (FanStack, étagère :
 * toujours blanche, largeur fixe 300 px réduite par `transform`). Corps tronqué à 8 lignes puis « … ».
 * Icône de source en haut à droite : logo X / Instagram / Cosmos (jamais une croix de fermeture).
 */
import { MessageSquareText } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { ItemCard } from '../../../../../shared/dto/items'
import { CosmosGlyph, InstagramGlyph, XGlyph } from '../../../components/icons'
import { Avatar } from '../../../components/ui'
import { fr } from '../../../i18n/fr'
import { cn } from '../../../lib/cn'
import { mediaSrc } from '../../../lib/media-url'
import { QuotedTweet } from './QuotedTweet'

export type TweetVariant = 'light' | 'overlay' | 'cover'

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
}: {
  card: ItemCard
  variant?: TweetVariant
  className?: string
  style?: CSSProperties
}) {
  const post = card.post
  const name = post?.author.name ?? post?.author.handle ?? card.title ?? ''
  const handle = post?.author.handle ?? null
  const text = gridText(post?.text ?? card.title ?? '')
  return (
    <article
      data-tweet=""
      className={cn(
        'tweet-card relative flex flex-col rounded-md border px-4 pb-[18px] pt-4 text-left',
        variant === 'light' ? 'border-border-subtle bg-surface text-fg' : 'tweet-overlay',
        variant === 'cover' && 'w-[300px]',
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
          <div className="truncate text-[15px] font-semibold leading-5">{name}</div>
          {handle ? (
            <div className="truncate text-[14px] leading-[18px] text-fg-social">@{handle}</div>
          ) : null}
        </div>
      </header>
      <span className="absolute right-4 top-4" data-testid="source-glyph" data-source={card.source}>
        <SourceGlyph source={card.source} />
      </span>
      {text ? (
        <p className="tweet-body mt-[14px] whitespace-pre-wrap break-words text-[15px] leading-[21px]">
          {text}
        </p>
      ) : null}
      {post?.quoted ? <QuotedTweet quoted={post.quoted} /> : null}
      {post && post.threadCount > 0 ? (
        <footer className="mt-3 flex items-center gap-1.5 text-caption text-fg-subtle">
          <MessageSquareText size={13} strokeWidth={1.75} />
          {fr.card.thread(post.threadCount + 1)}
        </footer>
      ) : null}
    </article>
  )
}
