/**
 * Palette ⌘K (DESIGN §3.6, WP-23) : cmdk dans un Radix Dialog, voile sans flou, panneau 520 px à
 * `top:146`. Vide : « Récemment consultés » (7 vignettes 63×63, ←/→ dans la rangée, ↵ ouvre) +
 * « Commandes ». Avec texte : « Éléments » (recherche), « Collections », « Tags », « Commandes ».
 * `>` : commandes seules ; `#` : tags seuls. Ouverte par `menu.command` `palette` (accélérateur ⌘K
 * du menu natif, AUCUN écouteur ⌘K côté renderer) et par le bouton « Rechercher » de l'en-tête.
 */
import { Command } from 'cmdk'
import { Folder, Hash, Search } from 'lucide-react'
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui'
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { TagInfo } from '../../../../shared/dto/collections'
import type { ItemCard } from '../../../../shared/dto/items'
import { usePortalContainer } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { cardThumbSrc } from '../../lib/media-url'
import { rpc } from '../../lib/rpc'
import { runMenuCommand, soon } from '../../shell/commands'
import { flattenTree, useCollections } from '../../state/collections'
import { useUi } from '../../state/ui'
import { openViewer } from '../viewer/open'
import { fold, matchCommands, type PaletteCommand } from './commands'
import './palette.css'

export const RECENT_COUNT = 7
const ITEMS_LIMIT = 6

function Thumb({ card, size }: { card: ItemCard; size: number }) {
  const src = cardThumbSrc(card)
  return (
    <span
      className="block shrink-0 overflow-hidden rounded-[6px]"
      style={{ width: size, height: size, background: card.dominant ?? 'var(--skeleton)' }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          crossOrigin="anonymous"
          className="h-full w-full object-cover"
        />
      ) : card.kind === 'tweet' ? (
        <span className="block h-full w-full bg-surface p-1 text-[7px] leading-[9px] text-fg-muted">
          {card.post?.text?.slice(0, 90) ?? card.title ?? ''}
        </span>
      ) : null}
    </span>
  )
}

function Keys({ keys }: { keys: readonly string[] }) {
  if (keys.length === 0) return null
  return <span className="palette-kbd ml-auto">{keys.join('')}</span>
}

/** Ouvre un élément dans la vue détail (liste d'origine = résultats affichés). */
function openItem(card: ItemCard, list: readonly ItemCard[]) {
  openViewer(card, list)
}

export default function CommandPalette() {
  const close = useUi((s) => s.closeOverlay)
  const container = usePortalContainer()
  const tree = useCollections((s) => s.tree)
  const [search, setSearch] = useState('')
  const [value, setValue] = useState('')
  const [recent, setRecent] = useState<ItemCard[]>([])
  const [items, setItems] = useState<ItemCard[]>([])
  const [tags, setTags] = useState<TagInfo[]>([])

  useEffect(() => {
    void rpc('items.recentlyViewed', { limit: RECENT_COUNT })
      .then(setRecent)
      .catch(() => undefined)
  }, [])

  const mode: 'empty' | 'text' | 'commands' | 'tags' = search.startsWith('>')
    ? 'commands'
    : search.startsWith('#')
      ? 'tags'
      : search.trim()
        ? 'text'
        : 'empty'
  const text = mode === 'commands' || mode === 'tags' ? search.slice(1).trim() : search.trim()

  // Éléments et tags (debounce court) en mode texte / tags.
  useEffect(() => {
    if (mode !== 'text' && mode !== 'tags') {
      setItems([])
      setTags([])
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      if (mode === 'text') {
        void rpc('search.query', { q: text, limit: ITEMS_LIMIT })
          .then((r) => alive && setItems(r.items))
          .catch(() => alive && setItems([]))
      }
      if (mode === 'tags' && !text) {
        void rpc('tags.list')
          .then((r) => alive && setTags([...r.tags].sort((a, b) => b.count - a.count).slice(0, 12)))
          .catch(() => alive && setTags([]))
      } else {
        void rpc('search.suggest', { q: text })
          .then((r) => alive && setTags(r.tags))
          .catch(() => alive && setTags([]))
      }
    }, 80)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [mode, text])

  const commands = mode === 'tags' ? [] : mode === 'empty' ? matchCommands('') : matchCommands(text)
  const collections = useMemo(() => {
    if (mode !== 'text') return []
    const needle = fold(text)
    return flattenTree(tree)
      .map((f) => f.node)
      .filter((n) => fold(n.name).includes(needle))
      .slice(0, 5)
  }, [mode, text, tree])

  const recentShown = mode === 'empty' ? recent.slice(0, RECENT_COUNT) : []
  const firstValue =
    recentShown.length > 0
      ? `recent:${recentShown[0]!.uuid}`
      : mode === 'text' && items[0]
        ? `item:${items[0].uuid}`
        : commands[0]
          ? `cmd:${commands[0].id}`
          : ''
  // Sélection initiale (et après changement de mode) sur la première entrée.
  useEffect(() => {
    setValue(mode === 'empty' && commands[0] ? `cmd:${commands[0].id}` : firstValue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, firstValue])

  const runCommand = (c: PaletteCommand) => {
    close()
    if (c.run === 'syncNow') soon()
    else runMenuCommand(c.run)
  }

  /** ←/→ dans la rangée « Récemment consultés » ; ↓ en sort vers les commandes. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (!value.startsWith('recent:')) {
      if (
        e.key === 'ArrowUp' &&
        mode === 'empty' &&
        value === `cmd:${commands[0]?.id}` &&
        recentShown[0]
      ) {
        e.preventDefault()
        setValue(`recent:${recentShown[0].uuid}`)
      }
      return
    }
    const i = recentShown.findIndex((c) => `recent:${c.uuid}` === value)
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const j = Math.max(0, Math.min(recentShown.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))
      setValue(`recent:${recentShown[j]!.uuid}`)
    } else if (e.key === 'ArrowDown' && commands[0]) {
      e.preventDefault()
      setValue(`cmd:${commands[0].id}`)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
    }
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && close()}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay className="ui-scrim ui-scrim-palette overlay app-no-drag fixed inset-0 z-50" />
        <DialogPrimitive.Content
          data-testid="palette"
          aria-describedby={undefined}
          className="palette palette-surface app-no-drag fixed left-1/2 top-[146px] z-50 flex max-h-[420px] w-[520px] -translate-x-1/2 flex-col overflow-hidden rounded-[14px] text-fg shadow-[var(--shadow-palette)]"
        >
          <VisuallyHidden.Root asChild>
            <DialogPrimitive.Title>{fr.paletteUi.label}</DialogPrimitive.Title>
          </VisuallyHidden.Root>
          <Command
            label={fr.paletteUi.label}
            shouldFilter={false}
            value={value}
            onValueChange={setValue}
            onKeyDown={onKeyDown}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[rgba(0,0,0,.06)] px-4 dark:border-[rgba(255,255,255,.08)]">
              <Search size={16} strokeWidth={2} className="shrink-0 text-fg-subtle" />
              <Command.Input
                autoFocus
                data-testid="palette-input"
                value={search}
                onValueChange={setSearch}
                placeholder={fr.palette.placeholder}
                className="h-full min-w-0 flex-1 bg-transparent text-[18px] leading-6 text-fg outline-none placeholder:text-[#848484] focus-visible:outline-none"
              />
              <span className="palette-kbd">{fr.paletteUi.escape}</span>
            </div>
            <Command.List className="min-h-0 flex-1 overflow-y-auto pb-1.5">
              <Command.Empty className="px-[18px] py-6 text-center text-small text-fg-faint">
                {fr.paletteUi.noResults}
              </Command.Empty>
              {recentShown.length > 0 ? (
                <Command.Group
                  heading={fr.palette.recentlyViewed}
                  className="palette-recent-row"
                  data-testid="palette-recent"
                >
                  {recentShown.map((card) => (
                    <Command.Item
                      key={card.uuid}
                      value={`recent:${card.uuid}`}
                      className="palette-recent"
                      data-testid="palette-recent-item"
                      data-uuid={card.uuid}
                      onSelect={() => openItem(card, recentShown)}
                    >
                      <Thumb card={card} size={63} />
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {mode === 'text' && items.length > 0 ? (
                <Command.Group heading={fr.palette.items}>
                  {items.map((card) => (
                    <Command.Item
                      key={card.uuid}
                      value={`item:${card.uuid}`}
                      data-testid="palette-element"
                      onSelect={() => openItem(card, items)}
                    >
                      <Thumb card={card} size={28} />
                      <span className="min-w-0 flex-1 truncate">
                        {card.title ?? card.post?.text ?? fr.paletteUi.untitled}
                      </span>
                      <span className="ml-2 shrink-0 text-[12px] text-fg-faint">
                        {fr.paletteUi.sourceNames[card.source] ?? card.source}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {collections.length > 0 ? (
                <Command.Group heading={fr.palette.collections}>
                  {collections.map((n) => (
                    <Command.Item
                      key={n.uuid}
                      value={`col:${n.uuid}`}
                      onSelect={() => {
                        close()
                        useUi.getState().navigate({ name: 'collection', uuid: n.uuid })
                      }}
                    >
                      <Folder />
                      <span className="min-w-0 flex-1 truncate">{n.name}</span>
                      <span className="ml-auto text-[12px] text-fg-faint tnum">{n.count}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {(mode === 'text' || mode === 'tags') && tags.length > 0 ? (
                <Command.Group heading={fr.palette.tags}>
                  {tags.map((tag) => (
                    <Command.Item
                      key={tag.uuid}
                      value={`tag:${tag.uuid}`}
                      onSelect={() => {
                        close()
                        useUi.getState().openSearch({ tag: tag.name })
                      }}
                    >
                      <Hash />
                      <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                      <span className="ml-auto text-[12px] text-fg-faint tnum">{tag.count}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {commands.length > 0 ? (
                <Command.Group heading={fr.palette.commands} data-testid="palette-commands">
                  {commands.map((c) => (
                    <Command.Item
                      key={c.id}
                      value={`cmd:${c.id}`}
                      data-testid="palette-command"
                      data-command={c.id}
                      onSelect={() => runCommand(c)}
                    >
                      <c.Icon />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      <Keys keys={c.keys} />
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
            </Command.List>
            <div
              data-testid="palette-footer"
              className="flex h-8 shrink-0 items-center gap-4 border-t border-[rgba(0,0,0,.06)] px-[14px] text-[11.5px] text-[#9b9b9b] dark:border-[rgba(255,255,255,.08)]"
            >
              <span className="flex items-center gap-1.5">
                <span className="palette-kbd">↑↓</span>
                {fr.palette.navigate}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="palette-kbd">↵</span>
                {fr.palette.select}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="palette-kbd">&gt;</span>
                {fr.palette.commandsOnly}
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
