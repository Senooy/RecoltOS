/**
 * `InlineEditableTitle`: 18/24 600 title; a click turns it into an `<input>` of the
 * same typography (`--hover` background, radius 6, padding 2 6). ↵ or losing focus commits, Esc cancels.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { cn } from '../../lib/cn'

export interface InlineEditableTitleHandle {
  edit: () => void
}

export const InlineEditableTitle = forwardRef<
  InlineEditableTitleHandle,
  { value: string; label: string; onCommit: (next: string) => void | Promise<void> }
>(function InlineEditableTitle({ value, label, onCommit }, ref) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const cancelled = useRef(false)
  useImperativeHandle(ref, () => ({ edit: () => setEditing(true) }), [])
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])
  useEffect(() => {
    if (editing) {
      cancelled.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])
  const commit = () => {
    setEditing(false)
    if (cancelled.current) return
    const next = draft.trim()
    if (next && next !== value) void onCommit(next)
    else setDraft(value)
  }
  const typo = 'text-title font-semibold text-fg'
  if (editing) {
    return (
      <input
        ref={inputRef}
        data-testid="collection-title-input"
        aria-label={label}
        className={cn(
          typo,
          'app-no-drag -mx-1.5 h-7 min-w-[120px] max-w-[420px] rounded-[6px] bg-[var(--hover)] px-1.5 py-0.5 outline-none',
        )}
        style={{ width: `${Math.max(6, draft.length + 2)}ch` }}
        value={draft}
        maxLength={200}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancelled.current = true
            setDraft(value)
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <button
      type="button"
      data-testid="collection-title"
      className={cn(typo, 'max-w-[420px] truncate text-left')}
      title={label}
      onClick={() => setEditing(true)}
    >
      {value}
    </button>
  )
})
