/**
 * Contextual style bar: 36 px pill anchored above the selection (below it if it would leave the
 * view), hidden during gestures and editing. Content depends on the type: note colors, size
 * S/M/L/XL, fill / stroke / thickness / dashes for shapes, text color / size / bold, opacity,
 * lock, duplicate, delete; from 2 nodes, alignment (and distribution from 3).
 */
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Bold,
  Copy,
  Lock,
  LockOpen,
  Trash2,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { aabb, unionRect } from '../../../../../../shared/spaces-geometry'
import {
  ColorToken,
  NOTE_COLORS,
  NOTE_COLOR_HEX,
  type SpaceNode,
} from '../../../../../../shared/spaces-schema'
import { Popover, Tooltip } from '../../../../components/ui'
import { tr } from '../../../../i18n'
import { cn } from '../../../../lib/cn'
import {
  alignSelection,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  setStyle,
  toggleLock,
} from '../actions'
import { worldToScreen } from '../geometry/camera'
import { colorVar } from '../nodes/TextNodes'
import { useCamera, useSpace } from '../store/spaceStore'

const BAR_H = 36
const GAP = 12
const ICON = { size: 16, strokeWidth: 1.75 } as const
const TOKENS = ColorToken.options
const FONT_SIZES = [14, 18, 24, 32] as const
const TEXT_SIZES = [16, 24, 36, 56] as const

function BarButton({
  label,
  onClick,
  active,
  children,
  testId,
}: {
  label: string
  onClick: () => void
  active?: boolean
  children: ReactNode
  testId?: string
}) {
  return (
    <Tooltip content={label} side="top">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        data-testid={testId}
        className={cn(
          'flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-fg-muted hover:bg-[var(--hover)] hover:text-fg',
          active && 'bg-[var(--hover)] text-fg',
        )}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  )
}

function Swatches({
  values,
  current,
  colorOf,
  onPick,
  testPrefix,
  allowNone,
}: {
  values: readonly string[]
  current: string | null
  colorOf: (v: string) => string
  onPick: (v: string | null) => void
  testPrefix: string
  allowNone?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      {allowNone ? (
        <button
          type="button"
          aria-label={tr.spacesUi.noFill}
          aria-pressed={current === null}
          data-testid={`${testPrefix}-none`}
          className="sp-swatch relative overflow-hidden bg-bg"
          onClick={() => onPick(null)}
        >
          <span className="absolute left-1/2 top-[-2px] h-[22px] w-px rotate-45 bg-[var(--sp-red)]" />
        </button>
      ) : null}
      {values.map((v) => (
        <button
          key={v}
          type="button"
          aria-label={v}
          aria-pressed={current === v}
          data-testid={`${testPrefix}-${v}`}
          className="sp-swatch"
          style={{ background: colorOf(v) }}
          onClick={() => onPick(v)}
        />
      ))}
    </div>
  )
}

function ColorPopover({
  label,
  swatch,
  children,
  testId,
}: {
  label: string
  swatch: string
  children: ReactNode
  testId: string
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid={testId}
          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--hover)]"
        >
          <span className="sp-swatch" style={{ background: swatch }} />
        </button>
      </Popover.Trigger>
      <Popover.Content side="top" className="p-2.5">
        {children}
      </Popover.Content>
    </Popover.Root>
  )
}

function Sep() {
  return <span className="sp-sep" />
}

function SizeButtons({
  sizes,
  current,
  onPick,
  labels,
}: {
  sizes: readonly number[]
  current: number
  onPick: (n: number) => void
  labels: readonly string[]
}) {
  return (
    <div className="flex items-center" role="group" aria-label={tr.spacesUi.size}>
      {sizes.map((s, i) => (
        <button
          key={s}
          type="button"
          aria-pressed={current === s}
          data-testid={`size-${labels[i]}`}
          className={cn(
            'h-7 min-w-7 rounded-full px-1.5 text-caption font-medium text-fg-muted hover:text-fg',
            current === s && 'bg-[var(--hover)] text-fg',
          )}
          onClick={() => onPick(s)}
        >
          {labels[i]}
        </button>
      ))}
    </div>
  )
}

function Opacity({ value }: { value: number }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={tr.spacesUi.opacity}
          data-testid="style-opacity"
          className="h-7 rounded-full px-2 text-caption text-fg-muted tnum hover:bg-[var(--hover)] hover:text-fg"
        >
          {Math.round(value * 100)} %
        </button>
      </Popover.Trigger>
      <Popover.Content side="top" className="w-[180px] p-3">
        <label className="flex flex-col gap-2 text-caption text-fg-muted">
          {tr.spacesUi.opacity}
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            defaultValue={Math.round(value * 100)}
            onPointerUp={(e) =>
              setStyle(
                ['item', 'image', 'note', 'shape', 'text'],
                { opacity: Number(e.currentTarget.value) / 100 },
                tr.spacesUi.opacity,
              )
            }
            onKeyUp={(e) =>
              setStyle(
                ['item', 'image', 'note', 'shape', 'text'],
                { opacity: Number(e.currentTarget.value) / 100 },
                tr.spacesUi.opacity,
              )
            }
          />
        </label>
      </Popover.Content>
    </Popover.Root>
  )
}

function TypeControls({ n }: { n: SpaceNode }) {
  switch (n.type) {
    case 'note':
      return (
        <>
          <Swatches
            values={NOTE_COLORS}
            current={n.style.color}
            colorOf={(v) => NOTE_COLOR_HEX[v as (typeof NOTE_COLORS)[number]]}
            onPick={(v) => v && setStyle(['note'], { color: v })}
            testPrefix="note-color"
          />
          <Sep />
          <SizeButtons
            sizes={FONT_SIZES}
            current={n.style.fontSize}
            labels={['S', 'M', 'L', 'XL']}
            onPick={(s) => setStyle(['note'], { fontSize: s }, tr.spacesUi.size)}
          />
        </>
      )
    case 'shape':
      return (
        <>
          <ColorPopover
            label={tr.spacesUi.fill}
            swatch={n.style.fill ? colorVar(n.style.fill) : 'transparent'}
            testId="style-fill"
          >
            <Swatches
              values={TOKENS}
              current={n.style.fill}
              colorOf={colorVar}
              allowNone
              onPick={(v) =>
                setStyle(['shape'], { fill: v, fillAlpha: v ? 0.9 : 1 }, tr.spacesUi.fill)
              }
              testPrefix="fill"
            />
          </ColorPopover>
          <ColorPopover
            label={tr.spacesUi.stroke}
            swatch={n.style.stroke ? colorVar(n.style.stroke) : 'transparent'}
            testId="style-stroke"
          >
            <Swatches
              values={TOKENS}
              current={n.style.stroke}
              colorOf={colorVar}
              allowNone
              onPick={(v) => setStyle(['shape'], { stroke: v }, tr.spacesUi.stroke)}
              testPrefix="stroke"
            />
          </ColorPopover>
          <SizeButtons
            sizes={[1, 2, 4]}
            current={n.style.strokeWidth}
            labels={['1', '2', '4']}
            onPick={(s) => setStyle(['shape'], { strokeWidth: s }, tr.spacesExtra.strokeWidth)}
          />
          <BarButton
            label={tr.spacesExtra.dashed}
            active={n.style.dash === 'dashed'}
            onClick={() =>
              setStyle(['shape'], { dash: n.style.dash === 'dashed' ? 'solid' : 'dashed' })
            }
          >
            <span className="block h-0 w-4 border-t-2 border-dashed border-current" />
          </BarButton>
        </>
      )
    case 'text':
      return (
        <>
          <ColorPopover
            label={tr.spacesUi.color}
            swatch={colorVar(n.style.color)}
            testId="style-text-color"
          >
            <Swatches
              values={TOKENS}
              current={n.style.color}
              colorOf={colorVar}
              onPick={(v) => v && setStyle(['text'], { color: v })}
              testPrefix="text-color"
            />
          </ColorPopover>
          <SizeButtons
            sizes={TEXT_SIZES}
            current={n.style.fontSize}
            labels={['S', 'M', 'L', 'XL']}
            onPick={(s) => setStyle(['text'], { fontSize: s }, tr.spacesExtra.textSize)}
          />
          <BarButton
            label={tr.spacesExtra.bold}
            active={n.style.weight === 600}
            onClick={() => setStyle(['text'], { weight: n.style.weight === 600 ? 400 : 600 })}
          >
            <Bold {...ICON} />
          </BarButton>
        </>
      )
    default:
      return null
  }
}

export function StyleBar() {
  const selection = useSpace((s) => s.selection)
  const nodes = useSpace((s) => s.nodes)
  const preview = useSpace((s) => s.preview)
  const editingId = useSpace((s) => s.editingId)
  const marquee = useSpace((s) => s.marquee)
  const camera = useCamera((s) => s.camera)
  const view = useCamera((s) => s.view)
  const ref = useRef<HTMLDivElement | null>(null)
  const [barW, setBarW] = useState(320)
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth
    if (w && Math.abs(w - barW) > 1) setBarW(w)
  }, [barW, selection, nodes])
  const sel = selection.map((id) => nodes[id]).filter((n): n is SpaceNode => Boolean(n))
  if (sel.length === 0 || preview || editingId || marquee) return null
  const box = unionRect(sel.map(aabb))!
  const a = worldToScreen(camera, { x: box.x, y: box.y })
  const b = worldToScreen(camera, { x: box.x + box.width, y: box.y + box.height })
  const half = barW / 2 + 8
  const cx = Math.min(Math.max((a.x + b.x) / 2, half), Math.max(half, view.w - half))
  const single0 = sel.length === 1 ? sel[0]! : null
  // Above the rotation handle when it is shown (single node, unlocked).
  const gap = single0 && !single0.locked ? GAP + 22 : GAP
  const above = Math.min(a.y, b.y) - BAR_H - gap
  const top = above >= 8 ? above : Math.min(Math.max(a.y, b.y) + GAP, view.h - BAR_H - 80)
  const single = sel.length === 1 ? sel[0]! : null
  const locked = sel.every((n) => n.locked)
  const opacity = (sel[0]!.style as { opacity?: number }).opacity ?? 1
  return (
    <div
      role="toolbar"
      aria-label={tr.spacesUi.color}
      data-testid="space-stylebar"
      className="sp-float absolute z-20 flex h-9 -translate-x-1/2 items-center gap-1 px-1.5"
      ref={ref}
      style={{ left: cx, top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {single ? <TypeControls n={single} /> : null}
      {sel.length >= 2 ? (
        <>
          <BarButton
            label={tr.spacesExtra.alignLeft}
            onClick={() => alignSelection('left')}
            testId="align-left"
          >
            <AlignStartVertical {...ICON} />
          </BarButton>
          <BarButton label={tr.spacesExtra.alignHCenter} onClick={() => alignSelection('hcenter')}>
            <AlignCenterVertical {...ICON} />
          </BarButton>
          <BarButton label={tr.spacesExtra.alignRight} onClick={() => alignSelection('right')}>
            <AlignEndVertical {...ICON} />
          </BarButton>
          <BarButton
            label={tr.spacesExtra.alignTop}
            onClick={() => alignSelection('top')}
            testId="align-top"
          >
            <AlignStartHorizontal {...ICON} />
          </BarButton>
          <BarButton label={tr.spacesExtra.alignVCenter} onClick={() => alignSelection('vcenter')}>
            <AlignCenterHorizontal {...ICON} />
          </BarButton>
          <BarButton label={tr.spacesExtra.alignBottom} onClick={() => alignSelection('bottom')}>
            <AlignEndHorizontal {...ICON} />
          </BarButton>
          {sel.length >= 3 ? (
            <>
              <BarButton
                label={tr.spacesExtra.distributeH}
                onClick={() => distributeSelection('h')}
              >
                <AlignHorizontalDistributeCenter {...ICON} />
              </BarButton>
              <BarButton
                label={tr.spacesExtra.distributeV}
                onClick={() => distributeSelection('v')}
              >
                <AlignVerticalDistributeCenter {...ICON} />
              </BarButton>
            </>
          ) : null}
        </>
      ) : null}
      {single && single.type !== 'item' && single.type !== 'image' ? (
        <Sep />
      ) : sel.length >= 2 ? (
        <Sep />
      ) : null}
      <Opacity value={opacity} />
      <BarButton
        label={locked ? tr.spacesUi.unlock : tr.spacesUi.lock}
        active={locked}
        onClick={toggleLock}
        testId="style-lock"
      >
        {locked ? <Lock {...ICON} /> : <LockOpen {...ICON} />}
      </BarButton>
      <BarButton
        label={tr.spacesUi.duplicate}
        onClick={() => void duplicateSelection()}
        testId="style-duplicate"
      >
        <Copy {...ICON} />
      </BarButton>
      <BarButton label={tr.spacesUi.delete} onClick={deleteSelection} testId="style-delete">
        <Trash2 {...ICON} />
      </BarButton>
    </div>
  )
}
