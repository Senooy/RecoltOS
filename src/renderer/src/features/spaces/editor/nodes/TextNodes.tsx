/**
 * Nœuds de texte (SPACES §1.5.5, DESIGN §3.11) : note (6 teintes, 15/21, `<textarea>` en
 * édition), forme (rectangle, ellipse, triangle, losange en SVG, libellé centré) et texte libre
 * (`contenteditable="plaintext-only"`, largeur automatique tant qu'aucune poignée latérale n'a été
 * tirée). L'édition reste locale jusqu'au blur / Échap : un seul commit dans l'historique ;
 * `commitEditing()` (handshake de fermeture) la valide à la demande.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { SpaceNode } from '../../../../../../shared/spaces-schema'
import { NOTE_COLOR_HEX } from '../../../../../../shared/spaces-schema'
import { fr } from '../../../../i18n/fr'
import { setContent } from '../actions'
import { commit, registerEditingCommit, useSpace } from '../store/spaceStore'

type NoteN = Extract<SpaceNode, { type: 'note' }>
type ShapeN = Extract<SpaceNode, { type: 'shape' }>
type TextN = Extract<SpaceNode, { type: 'text' }>

/** Taille S/M/L/XL → police/interligne (S = 15/21 de DESIGN §3.11). */
export const NOTE_FONT: Record<number, [number, number]> = {
  14: [15, 21],
  18: [18, 25],
  24: [24, 31],
  32: [32, 40],
}

export const colorVar = (token: string | null | undefined): string =>
  token ? `var(--sp-${token})` : 'transparent'

function stopEditing() {
  useSpace.setState({ editingId: null })
}

/** Édition locale + validation unique (blur, Échap, handshake). */
function useEditing(id: string, initial: string, editing: boolean, onCommit: (v: string) => void) {
  const [draft, setDraft] = useState(initial)
  const draftRef = useRef(initial)
  const done = useRef(false)
  useEffect(() => {
    if (!editing) return
    setDraft(initial)
    draftRef.current = initial
    done.current = false
    const commitNow = () => {
      if (done.current) return
      done.current = true
      onCommit(draftRef.current)
    }
    registerEditingCommit(commitNow)
    return () => {
      commitNow()
      registerEditingCommit(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, id])
  const update = (v: string) => {
    draftRef.current = v
    setDraft(v)
  }
  return { draft, update }
}

export function NoteNodeView({ node, editing }: { node: NoteN; editing: boolean }) {
  const [size, lh] = NOTE_FONT[node.style.fontSize] ?? [15, 21]
  const { draft, update } = useEditing(node.uuid, node.content, editing, (v) =>
    setContent(node.uuid, v),
  )
  const ta = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (!editing) return
    const el = ta.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])
  const style = {
    background: NOTE_COLOR_HEX[node.style.color],
    fontSize: size,
    lineHeight: `${lh}px`,
    textAlign: node.style.align,
  } as const
  return (
    <div className="sp-note h-full w-full" style={style}>
      {editing ? (
        <textarea
          ref={ta}
          data-testid="note-editor"
          aria-label={fr.spaces.tools.note}
          value={draft}
          placeholder={fr.spacesUi.notePlaceholder}
          spellCheck={false}
          onChange={(e) => update(e.target.value)}
          onBlur={stopEditing}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              e.preventDefault()
              stopEditing()
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="sp-note-text">
          {node.content || (
            <span className="sp-note-placeholder">{fr.spacesUi.notePlaceholder}</span>
          )}
        </div>
      )}
    </div>
  )
}

function shapePath(kind: ShapeN['style']['kind'], w: number, h: number, sw: number): ReactNode {
  const i = sw / 2
  switch (kind) {
    case 'ellipse':
      return (
        <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - i)} ry={Math.max(0, h / 2 - i)} />
      )
    case 'triangle':
      return <polygon points={`${w / 2},${i} ${w - i},${h - i} ${i},${h - i}`} />
    case 'diamond':
      return <polygon points={`${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}`} />
    default:
      return null
  }
}

/** Contenu éditable en place (texte libre, libellé de forme). */
function Editable({
  value,
  editing,
  onInput,
  className,
  style,
  testId,
}: {
  value: string
  editing: boolean
  onInput: (v: string) => void
  className?: string
  style?: CSSProperties
  testId?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (editing) {
      el.textContent = value
      el.focus()
      const r = document.createRange()
      r.selectNodeContents(el)
      r.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])
  if (!editing) {
    return (
      <div className={className} style={style}>
        {value}
      </div>
    )
  }
  return (
    <div
      ref={ref}
      data-testid={testId}
      className={className}
      style={style}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      onInput={(e) => onInput(e.currentTarget.textContent ?? '')}
      onBlur={stopEditing}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          stopEditing()
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}

export function ShapeNodeView({ node, editing }: { node: ShapeN; editing: boolean }) {
  const st = node.style
  const { draft, update } = useEditing(node.uuid, node.content, editing, (v) =>
    setContent(node.uuid, v),
  )
  const [size, lh] = NOTE_FONT[st.fontSize] ?? [15, 21]
  const w = node.width
  const h = node.height
  const fill = st.fill ? colorVar(st.fill) : 'transparent'
  return (
    <div className="relative h-full w-full">
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${w} ${h}`}
        className="absolute inset-0 overflow-visible"
      >
        <g
          fill={fill}
          fillOpacity={st.fill ? st.fillAlpha : 0}
          stroke={st.stroke ? colorVar(st.stroke) : 'none'}
          strokeWidth={st.strokeWidth}
          strokeDasharray={
            st.dash === 'dashed' ? `${st.strokeWidth * 4} ${st.strokeWidth * 3}` : undefined
          }
        >
          {st.kind === 'rect' ? (
            <rect
              x={st.strokeWidth / 2}
              y={st.strokeWidth / 2}
              width={Math.max(0, w - st.strokeWidth)}
              height={Math.max(0, h - st.strokeWidth)}
              rx={Math.min(st.radius, w / 2, h / 2)}
            />
          ) : (
            shapePath(st.kind, w, h, st.strokeWidth)
          )}
        </g>
      </svg>
      {(node.content || editing) && (
        <div className="absolute inset-0 flex items-center justify-center p-2">
          <Editable
            value={editing ? draft : node.content}
            editing={editing}
            onInput={update}
            testId="shape-editor"
            className="sp-text max-w-full text-center outline-none"
            style={{
              fontSize: size,
              lineHeight: `${lh}px`,
              color: colorVar(st.textColor),
              minWidth: 8,
            }}
          />
        </div>
      )}
    </div>
  )
}

const FONT_FAMILY = {
  sans: 'var(--font-sans, inherit)',
  serif: 'ui-serif, Georgia, serif',
  mono: 'var(--font-mono, ui-monospace, monospace)',
} as const

export function TextNodeView({ node, editing }: { node: TextN; editing: boolean }) {
  const st = node.style
  const measure = useRef<HTMLDivElement | null>(null)
  const { draft, update } = useEditing(node.uuid, node.content, editing, (v) => {
    // Texte vide à la fin de l'édition : le nœud disparaît (comme une zone de texte vide).
    if (!v.trim()) {
      commit(fr.spacesUi.delete, (d) => {
        delete d[node.uuid]
      })
      return
    }
    const el = measure.current
    const lineH = Math.round(st.fontSize * 1.3)
    let width = node.width
    let height = node.height
    if (el) {
      el.textContent = v
      const r = el.getBoundingClientRect()
      const z = el.offsetWidth > 0 ? r.width / el.offsetWidth : 1
      if (st.autoWidth) width = Math.max(24, Math.ceil(r.width / z) + 2)
      el.style.width = st.autoWidth ? '' : `${width}px`
      height = Math.max(24, Math.ceil(el.getBoundingClientRect().height / z), lineH)
    }
    commit('Modifier le texte', (d) => {
      const m = d[node.uuid]
      if (!m || m.type !== 'text') return
      m.content = v
      m.width = width
      m.height = height
    })
  })
  const style: CSSProperties = {
    fontSize: st.fontSize,
    lineHeight: 1.3,
    fontWeight: st.weight,
    fontFamily: FONT_FAMILY[st.font],
    textAlign: st.align,
    color: colorVar(st.color),
    whiteSpace: st.autoWidth ? 'pre' : 'pre-wrap',
  }
  return (
    <div className="relative h-full w-full">
      <Editable
        value={editing ? draft : node.content}
        editing={editing}
        onInput={update}
        testId="text-editor"
        className="sp-text min-h-full min-w-full"
        style={style}
      />
      <div
        ref={measure}
        aria-hidden="true"
        className="sp-text pointer-events-none absolute left-0 top-0"
        style={{
          ...style,
          visibility: 'hidden',
          width: st.autoWidth ? 'max-content' : node.width,
        }}
      />
    </div>
  )
}
