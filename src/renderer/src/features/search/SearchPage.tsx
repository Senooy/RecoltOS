/**
 * Page Recherche (DESIGN §3.5, WP-22) : colonne de 700 px, champ de 56 px à y=124, compteur
 * « N éléments dans ta bibliothèque » ; sans saisie : « Tes collections » (carrousel 130×160 à
 * défilement magnétique), « Récents · Effacer » (8 chips), « Aller à un tag » (chips de source en
 * tête, puis tags par usage, 24 au plus puis « +N ») ; avec saisie (debounce 120 ms) : « N
 * résultats », chips des filtres actifs (retirables), masonry pleine largeur. La syntaxe
 * `type:` `source:` `couleur:` `#source` `#tag connu` devient une chip à la frappe d'une espace.
 */
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionNode, SourceChip, TagInfo } from '../../../../shared/dto/collections'
import type { ItemCard } from '../../../../shared/dto/items'
import { toFtsQuery } from '../../../../shared/search-query'
import { EmptyState, Kbd } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { cn } from '../../lib/cn'
import { cardThumbSrc } from '../../lib/media-url'
import { isNotImplemented, rpc, subscribe } from '../../lib/rpc'
import { useCollections } from '../../state/collections'
import { usePrefs } from '../../state/prefs'
import { clampColumns, useUi } from '../../state/ui'
import { MasonryGrid } from '../grid/MasonryGrid'
import { openViewer } from '../viewer/open'
import { TweetCard } from '../grid/cards/TweetCard'
import { FiltersPopover } from './FiltersPopover'
import {
  EMPTY_FILTERS,
  colorLabel,
  activeCount,
  toItemFilters,
  toggle,
  type SearchFilters,
} from './filters'

export const SEARCH_DEBOUNCE_MS = 120
const HISTORY_IDLE_MS = 1500
const TAGS_MAX = 24
const SOURCE_LABEL: Record<string, string> = { x: 'x', instagram: 'instagram', cosmos: 'cosmos' }

interface History {
  query: string
  usedAt: number
  uses: number
}

function MiniFan({ covers }: { covers: readonly ItemCard[] }) {
  const shown = covers.slice(0, 3)
  const rot = ['rotate(-4deg)', 'rotate(4deg)', 'rotate(0deg)']
  return (
    <div className="absolute left-1/2 top-[14px] h-[76px] w-[76px] -translate-x-1/2">
      {shown
        .map((c, i) => ({ c, i }))
        .reverse()
        .map(({ c, i }) => {
          const src = cardThumbSrc(c)
          return (
            <div
              key={c.uuid}
              className="absolute left-1 top-1 h-[68px] w-[68px] overflow-hidden rounded-[6px] border border-[rgba(255,255,255,.9)]"
              style={{
                transform: rot[(shown.length - 1 - i) % 3] ?? undefined,
                boxShadow: 'var(--shadow-stack)',
                background: c.dominant ?? 'var(--skeleton)',
              }}
            >
              {c.kind === 'tweet' ? (
                <div className="h-full w-full overflow-hidden bg-white">
                  <TweetCard
                    card={c}
                    variant="cover"
                    style={{ transform: 'scale(.23)', transformOrigin: 'top left' }}
                  />
                </div>
              ) : src ? (
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  crossOrigin="anonymous"
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
          )
        })}
    </div>
  )
}

function CollectionsCarousel({ tree }: { tree: readonly CollectionNode[] }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const navigate = useUi((s) => s.navigate)
  const [edges, setEdges] = useState({ start: true, end: false })
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setEdges({
      start: el.scrollLeft <= 1,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
    })
  }, [])
  useEffect(update, [tree, update])
  const page = (dir: 1 | -1) => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * (el.clientWidth - 40), behavior: 'smooth' })
  }
  const arrow =
    'flex h-6 w-6 items-center justify-center rounded-full border border-border text-fg-subtle'
  return (
    <section data-testid="search-collections">
      <div className="mt-[18px] flex h-6 items-center justify-between">
        <h2 className="text-micro font-medium uppercase text-fg-faint">
          {fr.search.yourCollections}
        </h2>
        <div className="flex gap-1.5">
          <button
            type="button"
            aria-label={fr.searchUi.prev}
            className={arrow}
            style={{ opacity: edges.start ? 0.4 : 1 }}
            disabled={edges.start}
            onClick={() => page(-1)}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            aria-label={fr.searchUi.next}
            className={arrow}
            style={{ opacity: edges.end ? 0.4 : 1 }}
            disabled={edges.end}
            onClick={() => page(1)}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div
        ref={ref}
        onScroll={update}
        className="no-scrollbar mt-[22px] flex snap-x snap-mandatory gap-3 overflow-x-auto"
      >
        {tree.map((n) => (
          <button
            key={n.uuid}
            type="button"
            data-testid="search-collection-card"
            className="relative h-[160px] w-[130px] shrink-0 snap-start rounded-[10px] border border-border bg-bg text-left transition-colors hover:bg-surface"
            onClick={() => navigate({ name: 'collection', uuid: n.uuid })}
          >
            <MiniFan covers={n.covers} />
            <span className="absolute bottom-[30px] left-3 right-2 truncate text-[13px] font-semibold leading-4 text-fg">
              {n.name}
            </span>
            <span className="absolute bottom-[14px] left-3 text-[11px] leading-[14px] text-fg-faint">
              {fr.count.items(n.count)}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

export default function SearchPage() {
  const seed = useUi((s) => s.search)
  const tree = useCollections((s) => s.tree)
  const defaultColumns = usePrefs((s) => s.prefs.defaultColumns)
  const columns = useUi((s) => s.columns.library) ?? clampColumns(defaultColumns)
  const [text, setText] = useState('')
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS)
  const [libraryTotal, setLibraryTotal] = useState<number | null>(null)
  const [history, setHistory] = useState<History[]>([])
  const [tags, setTags] = useState<TagInfo[]>([])
  const [sourceChips, setSourceChips] = useState<SourceChip[]>([])
  const [showAllTags, setShowAllTags] = useState(false)
  const [result, setResult] = useState<{
    items: ItemCard[]
    total: number
    noPalette: number
    q: string
  } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const scrollRef = useRef<HTMLElement | null>(null)

  const q = text.trim()
  const nFilters = activeCount(filters)
  const searching = q !== '' || nFilters > 0

  // Données de l'état vide.
  const loadIdle = useCallback(() => {
    void rpc('items.counts')
      .then((c) => setLibraryTotal(c.all))
      .catch(() => undefined)
    void rpc('search.history.list')
      .then(setHistory)
      .catch((e: unknown) => {
        if (!isNotImplemented(e)) console.warn('[search] historique', e)
      })
    void rpc('tags.list')
      .then((r) => {
        setTags(r.tags)
        setSourceChips(r.sourceChips)
      })
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    loadIdle()
    const offs = [subscribe('items.changed', loadIdle), subscribe('library.switched', loadIdle)]
    return () => offs.forEach((o) => o())
  }, [loadIdle])

  // Graine `ui.openSearch({ query, tag, color })` (ERRATA §B).
  useEffect(() => {
    const next = { ...EMPTY_FILTERS }
    if (seed.color) next.colors = [seed.color.toLowerCase()]
    setFilters(next)
    setText(seed.query ?? (seed.tag ? `#${seed.tag} ` : ''))
    inputRef.current?.focus()
  }, [seed])

  // Rafraîchit les résultats quand la bibliothèque change.
  const [version, bump] = useState(0)
  useEffect(() => subscribe('items.changed', () => bump((n) => n + 1)), [])

  // Requête (debounce 120 ms).
  useEffect(() => {
    if (!searching) {
      setResult(null)
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      void rpc('search.query', { q, filters: toItemFilters(filters), limit: 1000 })
        .then((r) => {
          if (alive) setResult({ ...r, q })
        })
        .catch((e: unknown) => {
          if (alive && !isNotImplemented(e)) setResult({ items: [], total: 0, noPalette: 0, q })
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [q, filters, searching, version])

  // Historique : recherche gardée après un moment sans frappe (ou ↵).
  const addHistory = useCallback((query: string) => {
    if (!query) return
    void rpc('search.history.add', { query })
      .then(() => rpc('search.history.list'))
      .then(setHistory)
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    if (!q || !result || result.q !== q || result.total === 0) return
    const timer = setTimeout(() => addHistory(q), HISTORY_IDLE_MS)
    return () => clearTimeout(timer)
  }, [q, result, addHistory])

  /** Convertit la syntaxe reconnue en chips (à la frappe d'une espace ou de ↵). */
  const absorbSyntax = (raw: string): string => {
    const words = raw.split(/(\s+)/)
    let next = { ...filters }
    let changed = false
    const kept = words.filter((w, i) => {
      if (/^\s*$/.test(w) || i === words.length - 1) return true
      const p = toFtsQuery(w)
      const isSyntax = /^(type|source|couleur|color):/i.test(w) || w.startsWith('#')
      if (!isSyntax) return true
      if (p.kinds.length || p.sources.length || p.color) {
        next = {
          ...next,
          kinds: [...new Set([...next.kinds, ...p.kinds])],
          sources: [...new Set([...next.sources, ...p.sources])],
          colors: p.color ? [...new Set([...next.colors, p.color.toLowerCase()])] : next.colors,
        }
        changed = true
        return false
      }
      const tag = p.tags[0]
        ? tags.find((t) => t.name.toLowerCase() === p.tags[0]!.toLowerCase())
        : null
      if (tag) {
        if (!next.tags.some((t) => t.uuid === tag.uuid))
          next = { ...next, tags: [...next.tags, { uuid: tag.uuid, name: tag.name }] }
        changed = true
        return false
      }
      return true
    })
    if (!changed) return raw
    setFilters(next)
    return kept.join('').replace(/^\s+/, '')
  }

  const chips = useMemo(() => {
    const out: { key: string; label: string; remove: () => void }[] = []
    for (const k of filters.kinds)
      out.push({
        key: `k:${k}`,
        label: fr.searchUi.kinds[k]!,
        remove: () => setFilters((f) => ({ ...f, kinds: toggle(f.kinds, k) })),
      })
    for (const s of filters.sources)
      out.push({
        key: `s:${s}`,
        label: fr.searchUi.sources[s]!,
        remove: () => setFilters((f) => ({ ...f, sources: toggle(f.sources, s) })),
      })
    for (const hex of filters.colors)
      out.push({
        key: `c:${hex}`,
        label: fr.searchUi.colorChip(colorLabel(hex)),
        remove: () => setFilters((f) => ({ ...f, colors: f.colors.filter((c) => c !== hex) })),
      })
    if (filters.period !== 'all')
      out.push({
        key: 'period',
        label: fr.searchUi.periodChip[filters.period]!,
        remove: () => setFilters((f) => ({ ...f, period: 'all' })),
      })
    if (filters.collectionUuid) {
      const id = filters.collectionUuid
      const name =
        (function find(list: readonly CollectionNode[]): string | null {
          for (const n of list) {
            if (n.uuid === id) return n.name
            const c = find(n.children)
            if (c) return c
          }
          return null
        })(tree) ?? fr.search.inCollection
      out.push({
        key: 'col',
        label: name,
        remove: () => setFilters((f) => ({ ...f, collectionUuid: null })),
      })
    }
    for (const t of filters.tags)
      out.push({
        key: `t:${t.uuid}`,
        label: `#${t.name}`,
        remove: () => setFilters((f) => ({ ...f, tags: f.tags.filter((x) => x.uuid !== t.uuid) })),
      })
    return out
  }, [filters, tree])

  const tagChips: { key: string; name: string; apply: () => void }[] = [
    ...sourceChips.map((s) => ({
      key: `src:${s.source}`,
      name: SOURCE_LABEL[s.source] ?? s.source,
      apply: () => {
        setText('')
        setFilters({ ...EMPTY_FILTERS, sources: [s.source] })
      },
    })),
    ...[...tags]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'))
      .map((t) => ({
        key: t.uuid,
        name: t.name,
        apply: () => {
          setText('')
          setFilters({ ...EMPTY_FILTERS, tags: [{ uuid: t.uuid, name: t.name }] })
        },
      })),
  ]
  const shownTags = showAllTags ? tagChips : tagChips.slice(0, TAGS_MAX)
  const hiddenTags = tagChips.length - shownTags.length

  return (
    <main
      ref={scrollRef}
      data-testid="search-page"
      className="relative min-h-0 flex-1 overflow-y-auto pb-[100px]"
      aria-label={fr.nav.search}
    >
      <div className="mx-auto w-full max-w-[700px] px-0 pt-7">
        <div className="search-field relative flex h-14 items-center rounded-xl border border-border bg-surface shadow-[var(--shadow-field)] transition-[border-color,box-shadow] focus-within:border-border-strong focus-within:shadow-[0_0_0_3px_rgba(0,0,0,.04)]">
          <Search
            size={18}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-[18px] text-fg-subtle"
          />
          <input
            ref={inputRef}
            data-testid="search-input"
            type="text"
            autoFocus
            spellCheck={false}
            aria-label={fr.searchUi.inputLabel}
            className="h-full min-w-0 flex-1 bg-transparent pl-12 pr-2 text-[16px] text-fg outline-none placeholder:text-fg-faint focus-visible:outline-none"
            placeholder={fr.search.placeholder}
            style={{ outline: 'none' }}
            value={text}
            onChange={(e) => {
              const v = e.target.value
              setText(/\s$/.test(v) ? absorbSyntax(v) : v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = absorbSyntax(`${text} `).trim()
                setText(v)
                addHistory(v)
              } else if (e.key === 'Escape' && text) {
                e.stopPropagation()
                setText('')
              }
            }}
          />
          <Kbd keys={['⌘', 'K']} size="xs" tone="light" className="mr-2.5" />
          <FiltersPopover
            value={filters}
            onChange={setFilters}
            tags={tags}
            noPalette={result?.noPalette ?? 0}
          >
            <button
              type="button"
              data-testid="search-filters"
              aria-label={nFilters > 0 ? fr.searchUi.filtersActive(nFilters) : fr.search.filters}
              className="relative mr-3 flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle hover:bg-[var(--hover)]"
            >
              <SlidersHorizontal size={18} strokeWidth={1.75} />
              {nFilters > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg tnum">
                  {nFilters}
                </span>
              ) : null}
            </button>
          </FiltersPopover>
        </div>
        <div className="mt-3 flex min-h-4 flex-wrap items-center gap-2 text-caption text-fg-faint tnum">
          <span data-testid="search-count">
            {searching
              ? result
                ? fr.search.results(result.total)
                : ' '
              : libraryTotal !== null
                ? fr.search.inLibrary(libraryTotal)
                : ' '}
          </span>
          {searching
            ? chips.map((c) => (
                <span
                  key={c.key}
                  data-testid="search-filter-chip"
                  className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-bg pl-2.5 pr-1 text-[12px] text-fg-muted"
                >
                  {c.label}
                  <button
                    type="button"
                    aria-label={fr.searchUi.removeFilter(c.label)}
                    className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-[var(--hover)]"
                    onClick={c.remove}
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </span>
              ))
            : null}
        </div>

        <div
          className={cn(
            'transition-opacity duration-[180ms]',
            searching ? 'hidden opacity-0' : 'opacity-100',
          )}
          data-testid="search-idle"
        >
          {tree.length > 0 ? <CollectionsCarousel tree={tree} /> : null}
          {history.length > 0 ? (
            <section data-testid="search-recent">
              <div className="mt-[33px] flex h-[14px] items-center gap-1.5 text-micro font-medium uppercase text-fg-faint">
                <h2>{fr.search.recent}</h2>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  data-testid="search-recent-clear"
                  className="text-[11px] font-normal normal-case tracking-normal text-fg-faint hover:text-fg"
                  onClick={() =>
                    void rpc('search.history.clear')
                      .then(() => setHistory([]))
                      .catch(() => undefined)
                  }
                >
                  {fr.search.clear}
                </button>
              </div>
              <div className="mt-[15px] flex flex-wrap gap-2">
                {history.slice(0, 8).map((h) => (
                  <button
                    key={h.query}
                    type="button"
                    data-testid="search-recent-chip"
                    aria-label={`${fr.searchUi.recentLabel} « ${h.query} »`}
                    className="flex h-[30px] items-center gap-1.5 rounded-full border border-border px-3 text-[12.5px] text-fg-muted hover:bg-[var(--hover)]"
                    onClick={() => setText(h.query)}
                  >
                    <Search size={13} strokeWidth={1.75} className="text-fg-subtle" />
                    {h.query}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {tagChips.length > 0 ? (
            <section data-testid="search-tags">
              <h2 className="mt-[21px] text-micro font-medium uppercase text-fg-faint">
                {fr.search.jumpToTag}
              </h2>
              <div className="mt-[13px] flex flex-wrap gap-2">
                {shownTags.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    data-testid="search-tag-chip"
                    className="flex h-7 items-center gap-1 rounded-full border border-border px-[11px] text-[12.5px] text-fg-muted hover:bg-[var(--hover)]"
                    onClick={t.apply}
                  >
                    <span className="text-fg-disabled">#</span>
                    {t.name}
                  </button>
                ))}
                {hiddenTags > 0 ? (
                  <button
                    type="button"
                    className="flex h-7 items-center rounded-full border border-border px-[11px] text-[12.5px] text-fg-muted hover:bg-[var(--hover)]"
                    onClick={() => setShowAllTags(true)}
                  >
                    {fr.searchUi.moreTags(hiddenTags)}
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {searching && result ? (
        <div className="pt-6" data-testid="search-results">
          {result.items.length === 0 ? (
            <EmptyState
              className="pt-16"
              title={fr.search.noResults(result.q || chips.map((c) => c.label).join(', '))}
              description={fr.search.noResultsHint}
            />
          ) : (
            <MasonryGrid
              onOpen={openViewer}
              items={result.items}
              columns={columns}
              scrollRef={scrollRef}
              context="library"
            />
          )}
        </div>
      ) : null}
    </main>
  )
}
