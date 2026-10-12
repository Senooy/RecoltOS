/**
 * Details panel: 300 pt at `right: 18 ; top: 62 ; bottom: 18`, glass tinted by the ambience
 * (`--viewer-tint`), radius 14, internal scrolling, sections separated by `--viewer-line`, in
 * this order: header, `large` preview + `FormatBadge` and palette swatches, Name, URL, source
 * post, note, Collections, Tags, AI description, Detected text, Info (post without media: separate
 * Colors section). Selectable text (`.select-text`).
 */
import { Copy, ExternalLink, Info, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ItemCard, ItemDetail } from '../../../../shared/dto/items'
import type { TagInfo } from '../../../../shared/dto/collections'
import { FormatBadge, Popover, toast } from '../../components/ui'
import { tr } from '../../i18n'
import { cn } from '../../lib/cn'
import { NBSP, bytes, count, dateShort } from '../../lib/format'
import { mediaSrc } from '../../lib/media-url'
import { RpcError, isNotImplemented, rpc } from '../../lib/rpc'
import { usePrefs } from '../../state/prefs'
import { analyzeItems, setAiExcluded } from '../ai/ai-actions'
import { aiReady, useAi } from '../ai/ai-store'
import '../ai/ai.css'
import { CollectionPickerPopover } from '../collections/CollectionPicker'
import { addToCollection, removeFromCollection } from '../grid/actions'
import { PaletteSwatches } from './PaletteSwatches'
import { SourcePostCard } from './SourcePostCard'

export function formatOf(card: Pick<ItemCard, 'kind' | 'mime'>): string {
  if (card.kind === 'tweet') return 'POST'
  if (card.kind === 'url') return 'PAGE'
  const m = (card.mime ?? '').toLowerCase()
  if (m.includes('gif')) return 'GIF'
  if (m.includes('webp')) return 'WEBP'
  if (m.includes('png')) return 'PNG'
  if (m.includes('jpeg') || m.includes('jpg')) return 'JPG'
  if (m.includes('heic') || m.includes('heif')) return 'HEIC'
  if (m.includes('quicktime')) return 'MOV'
  if (m.includes('webm')) return 'WEBM'
  if (card.kind === 'video') return 'MP4'
  const sub = m.split('/')[1]
  return sub ? sub.toUpperCase().slice(0, 5) : 'IMG'
}

function fail(err: unknown): void {
  toast(err instanceof RpcError ? err.message : tr.errors.generic)
}

function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('viewer-section', className)}>{children}</div>
}

function Label({ children }: { children: ReactNode }) {
  return <div className="viewer-label">{children}</div>
}

/** Name field: saved on blur and on Enter. */
function NameField({ detail }: { detail: ItemDetail }) {
  const [value, setValue] = useState(detail.title ?? '')
  useEffect(() => setValue(detail.title ?? ''), [detail.uuid, detail.title])
  const save = () => {
    const next = value.trim() === '' ? null : value.trim()
    if (next === (detail.title ?? null)) return
    void rpc('items.update', { uuid: detail.uuid, patch: { title: next } }).catch(fail)
  }
  return (
    <input
      data-testid="detail-name"
      className="viewer-input"
      value={value}
      placeholder={tr.viewer.untitled}
      aria-label={tr.viewer.name}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setValue(detail.title ?? '')
          e.stopPropagation()
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/** Note: "+ Add a note" then an auto-growing area, saved on blur and after 800 ms. */
export const NOTE_DEBOUNCE_MS = 800

function NoteField({ detail }: { detail: ItemDetail }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(detail.notes ?? '')
  const saved = useRef(detail.notes ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    setValue(detail.notes ?? '')
    saved.current = detail.notes ?? ''
    setEditing(false)
  }, [detail.uuid]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = (text: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (text === saved.current) return
    saved.current = text
    void rpc('items.update', {
      uuid: detail.uuid,
      patch: { notes: text.trim() === '' ? null : text },
    }).catch(fail)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value, editing])
  if (!editing && value === '') {
    return (
      <button
        type="button"
        data-testid="detail-add-note"
        className="text-[13px] text-[var(--viewer-fg-subtle)] hover:text-[var(--viewer-fg-2)]"
        onClick={() => {
          setEditing(true)
          requestAnimationFrame(() => ref.current?.focus())
        }}
      >
        {tr.viewer.addNote}
      </button>
    )
  }
  return (
    <textarea
      ref={ref}
      data-testid="detail-note"
      className="viewer-input viewer-note"
      rows={2}
      value={value}
      placeholder={tr.viewer.notePlaceholder}
      aria-label={tr.viewer.addNote}
      onChange={(e) => {
        const v = e.target.value
        setValue(v)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => save(v), NOTE_DEBOUNCE_MS)
      }}
      onBlur={() => {
        save(value)
        if (value === '') setEditing(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          ;(e.target as HTMLTextAreaElement).blur()
        }
      }}
    />
  )
}

function Chip({
  children,
  onRemove,
  removeLabel,
  testId,
}: {
  children: ReactNode
  onRemove?: () => void
  removeLabel?: string
  testId?: string
}) {
  return (
    <span data-testid={testId} className="viewer-chip group">
      <span className="truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          className="-mr-1 ml-1 hidden h-4 w-4 items-center justify-center rounded-full text-[var(--viewer-fg-muted)] hover:text-white group-hover:flex"
          onClick={onRemove}
        >
          <X size={11} strokeWidth={2} />
        </button>
      ) : null}
    </span>
  )
}

function CollectionsField({ detail }: { detail: ItemDetail }) {
  const checked = useMemo(() => detail.collections.map((c) => c.uuid), [detail.collections])
  return (
    <div className="flex flex-wrap gap-1.5">
      {detail.collections.map((c) => (
        <Chip
          key={c.uuid}
          testId="detail-collection"
          removeLabel={tr.viewerUi.removeCollection(c.name)}
          onRemove={() => void removeFromCollection(c, [detail.uuid])}
        >
          {c.name}
        </Chip>
      ))}
      <CollectionPickerPopover
        checked={checked}
        onPick={(node) => {
          if (!node) return
          if (checked.includes(node.uuid)) void removeFromCollection(node, [detail.uuid])
          else void addToCollection(node, [detail.uuid])
        }}
      >
        <button
          type="button"
          data-testid="detail-add-collection"
          className="viewer-chip viewer-chip-add"
        >
          {tr.viewer.add}
        </button>
      </CollectionPickerPopover>
    </div>
  )
}

function TagsField({ detail }: { detail: ItemDetail }) {
  const [all, setAll] = useState<TagInfo[] | null>(null)
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const load = () => {
    if (all) return
    void rpc('tags.list')
      .then((r) => setAll(r.tags))
      .catch((err: unknown) => {
        if (!isNotImplemented(err)) console.warn('[viewer] tags', err)
        setAll([])
      })
  }
  const q = text.trim().replace(/^#/, '').toLowerCase()
  const own = new Set(detail.tags.map((t) => t.name.toLowerCase()))
  const suggestions = (all ?? [])
    .filter((t) => !own.has(t.name.toLowerCase()) && (q === '' || t.name.toLowerCase().includes(q)))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
  const add = (name: string) => {
    const n = name.trim().replace(/^#/, '')
    if (!n) return
    setText('')
    setActive(0)
    setAll(null)
    void rpc('tags.add', { itemUuids: [detail.uuid], names: [n] }).catch(fail)
  }
  return (
    <div className="relative">
      <div className="flex flex-wrap gap-1.5">
        {detail.tags.map((t) => (
          <Chip
            key={t.uuid}
            testId="detail-tag"
            removeLabel={tr.viewerUi.removeTag(t.name)}
            onRemove={() =>
              void rpc('tags.remove', { itemUuids: [detail.uuid], tagUuids: [t.uuid] }).catch(fail)
            }
          >
            # {t.name}
          </Chip>
        ))}
        <input
          data-testid="detail-tag-input"
          className="viewer-tag-input"
          value={text}
          placeholder={tr.viewer.addTag}
          aria-label={tr.viewer.addTag}
          spellCheck={false}
          onFocus={() => {
            setFocused(true)
            load()
          }}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, Math.max(0, suggestions.length - 1)))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const pick =
                q !== '' &&
                suggestions[active] &&
                suggestions[active].name.toLowerCase().startsWith(q)
                  ? suggestions[active].name
                  : text
              add(pick)
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              setText('')
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
      </div>
      {focused && suggestions.length > 0 && q !== '' ? (
        <ul role="listbox" aria-label={tr.viewerUi.tagSuggestions} className="viewer-suggest">
          {suggestions.map((t, i) => (
            <li key={t.uuid}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={cn('viewer-suggest-item', i === active && 'is-active')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(t.name)}
              >
                <span># {t.name}</span>
                <span className="ml-auto text-[11px] text-[var(--viewer-fg-muted)]">
                  {count(t.count)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function AiSection({ detail }: { detail: ItemDetail }) {
  const provider = usePrefs((s) => s.prefs.ai.provider)
  const consent = useAi((s) => s.consentVersion)
  const ready = aiReady(provider, consent)
  const job = detail.aiJob
  const busy = job?.type === 'ai.enrich'
  const promptBusy = job?.type === 'ai.prompt'
  const failed = detail.aiState === 'failed' && !job
  const via = detail.aiProvider && detail.aiProvider !== 'gatheros' ? detail.aiProvider : null
  const t = tr.aiUi
  return (
    <div data-testid="detail-ai" data-state={busy ? job.state : failed ? 'failed' : detail.aiState}>
      {busy ? (
        <p className="ai-shimmer text-[13px] leading-[19px]" data-testid="detail-ai-busy">
          {job.state === 'running' ? t.generating : t.queued}
        </p>
      ) : detail.aiDescription ? (
        <p
          className="select-text text-[13px] leading-[19px] text-[var(--viewer-fg-2)]"
          data-testid="detail-ai-description"
        >
          {detail.aiDescription}
        </p>
      ) : (
        <p className="text-[12.5px] text-[var(--viewer-fg-subtle)]">{tr.viewerUi.aiNone}</p>
      )}
      {failed || (job && detail.aiError) ? (
        <p className="mt-1.5 text-[12px] text-[#ff8a80]" data-testid="detail-ai-error">
          {failed ? `${t.failed} ` : ''}
          <span className="text-[var(--viewer-fg-subtle)]">
            {detail.aiError
              ? (tr.aiUi.errorCodes[detail.aiError.code] ?? detail.aiError.message)
              : null}
          </span>
        </p>
      ) : null}
      {detail.aiExcluded ? (
        <div className="mt-2.5 flex items-center gap-2.5">
          <span className="viewer-chip">{t.excluded}</span>
          <button
            type="button"
            className="text-[11.5px] text-[var(--viewer-fg-muted)] hover:text-white"
            onClick={() => void setAiExcluded([detail.uuid], false)}
          >
            {t.include}
          </button>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            data-testid="detail-ai-generate"
            disabled={busy}
            title={ready ? undefined : tr.viewerUi.aiUnavailable}
            className="viewer-pill"
            onClick={() =>
              void analyzeItems([detail.uuid], { force: Boolean(detail.aiDescription) || failed })
            }
          >
            <Sparkles size={13} strokeWidth={1.75} />
            {failed ? t.retry : detail.aiDescription ? tr.viewer.regenerate : tr.viewer.generate}
          </button>
          {via ? (
            <span
              className="text-[11px] text-[var(--viewer-fg-subtle)]"
              data-testid="detail-ai-via"
            >
              {t.via(t.shortNames[via] ?? via, provider !== 'off' && via !== provider)}
            </span>
          ) : null}
        </div>
      )}
      {detail.aiPrompt ? (
        <div className="viewer-prompt mt-3">
          <div className="flex items-center justify-between text-[11px] text-[var(--viewer-fg-muted)]">
            {tr.viewer.imagePrompt}
            <button
              type="button"
              aria-label={tr.viewerUi.copyPrompt}
              className="text-[var(--viewer-fg-muted)] hover:text-white"
              onClick={() =>
                void rpc('system.copyText', { text: detail.aiPrompt ?? '' })
                  .then(() => toast(t.copied))
                  .catch(fail)
              }
            >
              <Copy size={13} strokeWidth={1.75} />
            </button>
          </div>
          <p className="select-text mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-[17px] text-[var(--viewer-fg-2)]">
            {detail.aiPrompt}
          </p>
        </div>
      ) : detail.kind !== 'tweet' && !detail.aiExcluded ? (
        <button
          type="button"
          className={cn(
            'mt-2.5 text-[11.5px] text-[var(--viewer-fg-muted)] hover:text-white',
            promptBusy && 'ai-shimmer',
          )}
          disabled={promptBusy}
          data-testid="detail-ai-prompt"
          onClick={() => void analyzeItems([detail.uuid], { task: 'imagePrompt' })}
        >
          {promptBusy ? t.generating : t.generatePrompt}
        </button>
      ) : null}
    </div>
  )
}

function OcrSection({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label>{tr.viewer.ocr}</Label>
        <button
          type="button"
          className="text-[11.5px] text-[var(--viewer-fg-muted)] hover:text-white"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? tr.viewerUi.ocrHide : tr.viewerUi.ocrShow}
        </button>
      </div>
      <p
        className={cn(
          'select-text mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-[18px] text-[var(--viewer-fg-2)]',
          !open && 'line-clamp-2',
        )}
      >
        {text}
      </p>
    </div>
  )
}

function InfoGrid({ detail }: { detail: ItemDetail }) {
  const rows: [string, string][] = [[tr.viewer.type, tr.viewerUi.kinds[detail.kind] ?? detail.kind]]
  if (detail.width && detail.height)
    rows.push([tr.viewer.dimensions, `${detail.width}${NBSP}×${NBSP}${detail.height}`])
  if (detail.fileSize) rows.push([tr.viewer.size, bytes(detail.fileSize)])
  rows.push([tr.viewer.addedOn, dateShort(detail.addedAt)])
  rows.push([tr.viewer.views, count(detail.viewCount)])
  rows.push([tr.viewer.source, tr.viewerUi.sources[detail.source] ?? detail.source])
  return (
    <dl
      data-testid="detail-info"
      className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]"
    >
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[var(--viewer-fg-muted)]">{k}</dt>
          <dd className="select-text truncate text-right text-[var(--viewer-fg-2)]">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export interface DetailsPanelProps {
  card: ItemCard
  detail: ItemDetail | null
  className?: string
  style?: React.CSSProperties
}

export function DetailsPanel({ card, detail, className, style }: DetailsPanelProps) {
  const preview = mediaSrc(card.largeUrl ?? card.posterUrl ?? card.thumbUrl)
  const ratio = card.width && card.height ? card.width / card.height : 1.5
  const openSource =
    detail?.sourceUrl && /^https?:/i.test(detail.sourceUrl)
      ? () => void rpc('system.openExternal', { url: detail.sourceUrl! }).catch(fail)
      : null
  return (
    <aside
      data-testid="details-panel"
      aria-label={tr.viewer.details}
      className={cn('viewer-panel', className)}
      style={style}
    >
      <div className="viewer-panel-head">
        <span>{tr.viewer.details}</span>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={tr.viewerUi.techInfo}
              className="flex h-6 w-6 items-center justify-center rounded-full text-[#a9a9ab] hover:text-white"
            >
              <Info size={16} strokeWidth={1.75} />
            </button>
          </Popover.Trigger>
          <Popover.Content align="end" className="w-[240px] p-3 text-[12px]">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <span className="text-fg-muted">{tr.viewerUi.format}</span>
              <span className="select-text truncate">{card.mime ?? formatOf(card)}</span>
              <span className="text-fg-muted">{tr.viewerUi.identifier}</span>
              <span className="select-text truncate font-mono text-[11px]">{card.uuid}</span>
            </div>
            {detail ? (
              <div
                className="mt-2.5 flex flex-col items-start gap-1 border-t border-border-subtle pt-2"
                data-testid="detail-ai-menu"
              >
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => void analyzeItems([card.uuid], { force: true })}
                >
                  {tr.ai.analyze}
                </button>
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => void analyzeItems([card.uuid], { force: true, fields: ['title'] })}
                >
                  {tr.ai.regenerateTitle}
                </button>
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() =>
                    void analyzeItems([card.uuid], { force: true, fields: ['description'] })
                  }
                >
                  {tr.ai.regenerateDescription}
                </button>
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => useAi.getState().openPreview(card.uuid)}
                >
                  {tr.ai.previewPayload}
                </button>
                <label className="mt-1 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    data-testid="detail-ai-exclude"
                    checked={detail.aiExcluded}
                    onChange={(e) => void setAiExcluded([card.uuid], e.target.checked)}
                  />
                  {tr.ai.neverSend}
                </label>
              </div>
            ) : null}
          </Popover.Content>
        </Popover.Root>
      </div>
      {card.kind !== 'tweet' && preview ? (
        <Section className="pt-4">
          <div
            className="relative overflow-hidden rounded-[10px] bg-black/30 shadow-[0_8px_24px_rgba(0,0,0,.28)]"
            style={{ aspectRatio: String(ratio), maxHeight: 190 }}
          >
            <img
              src={preview}
              alt=""
              draggable={false}
              decoding="async"
              className="h-full w-full object-cover"
            />
            <FormatBadge format={formatOf(card)} className="absolute right-2 top-2" />
          </div>
          {detail?.palette && detail.palette.length > 0 ? (
            <div className="mt-[14px]" aria-label={tr.viewer.colors} role="group">
              <PaletteSwatches palette={detail.palette} />
            </div>
          ) : null}
        </Section>
      ) : null}
      {detail ? (
        <>
          <Section className="viewer-fields space-y-[6px]">
            <div>
              <Label>{tr.viewer.name}</Label>
              <NameField detail={detail} />
            </div>
            {detail.sourceUrl ? (
              <div>
                <Label>{tr.viewer.url}</Label>
                <div className="relative">
                  <input
                    data-testid="detail-url"
                    className="viewer-input select-text"
                    style={{ paddingRight: 34 }}
                    value={detail.sourceUrl}
                    readOnly
                    aria-label={tr.viewer.url}
                  />
                  {openSource ? (
                    <button
                      type="button"
                      aria-label={tr.viewerUi.openSource}
                      className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-[#d0d0d2] hover:text-white"
                      onClick={openSource}
                    >
                      <ExternalLink size={14} strokeWidth={1.75} />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {detail.post ? <SourcePostCard detail={detail} onOpen={openSource} /> : null}
            <div className="pt-[9px]">
              <NoteField detail={detail} />
            </div>
          </Section>
          <Section>
            <Label>{tr.viewer.collections}</Label>
            <CollectionsField detail={detail} />
          </Section>
          <Section>
            <Label>{tr.viewer.tags}</Label>
            <TagsField detail={detail} />
          </Section>
          {detail.palette && detail.palette.length > 0 && (card.kind === 'tweet' || !preview) ? (
            <Section>
              <Label>{tr.viewer.colors}</Label>
              <PaletteSwatches palette={detail.palette} />
            </Section>
          ) : null}
          <Section>
            <Label>{tr.viewer.aiDescription}</Label>
            <AiSection detail={detail} />
          </Section>
          {detail.ocrText ? (
            <Section>
              <OcrSection text={detail.ocrText} />
            </Section>
          ) : null}
          <Section>
            <Label>{tr.viewer.info}</Label>
            <InfoGrid detail={detail} />
          </Section>
        </>
      ) : null}
    </aside>
  )
}
