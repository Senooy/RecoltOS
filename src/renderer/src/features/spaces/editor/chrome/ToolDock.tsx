/**
 * Floating tool dock: bottom-center, 44 px pill, `--bg` background,
 * hairline, pill shadow; 36 px buttons, 18 px icons; active tool = black disc, icon
 * white (like the segmented control). Select V, Hand H | Note N, Text T, Shapes (R, O, triangle,
 * diamond) | Image I, Library L. Undo / Redo on the right.
 */
import {
  ChevronUp,
  Circle,
  Diamond,
  Hand,
  Image as ImageIcon,
  Library,
  MousePointer2,
  Redo2,
  Square,
  StickyNote,
  Triangle,
  Type,
  Undo2,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Menu, Tooltip } from '../../../../components/ui'
import { tr } from '../../../../i18n'
import { history, redo, setTool, undo, useSpace, type Tool } from '../store/spaceStore'

const ICON = { size: 18, strokeWidth: 1.75 } as const

const SHAPES: { tool: Tool; icon: ReactNode; label: () => string; key?: string }[] = [
  { tool: 'rect', icon: <Square {...ICON} />, label: () => tr.spaces.tools.rect, key: 'R' },
  { tool: 'ellipse', icon: <Circle {...ICON} />, label: () => tr.spaces.tools.ellipse, key: 'O' },
  { tool: 'triangle', icon: <Triangle {...ICON} />, label: () => tr.spacesExtra.triangle },
  { tool: 'diamond', icon: <Diamond {...ICON} />, label: () => tr.spacesExtra.diamond },
]

function ToolButton({
  label,
  shortcut,
  active,
  onClick,
  children,
  testId,
  disabled,
}: {
  label: string
  shortcut?: string
  active?: boolean
  onClick: () => void
  children: ReactNode
  testId: string
  disabled?: boolean
}) {
  return (
    <Tooltip content={label} shortcut={shortcut ? [shortcut] : undefined} side="top">
      <button
        type="button"
        className="sp-tool"
        data-testid={testId}
        aria-label={label}
        aria-pressed={active ?? false}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export function ToolDock() {
  const tool = useSpace((s) => s.tool)
  const drawerOpen = useSpace((s) => s.drawerOpen)
  useSpace((s) => s.historyVersion)
  const [shape, setShape] = useState<Tool>('rect')
  const current = SHAPES.find(
    (s) => s.tool === (SHAPES.some((x) => x.tool === tool) ? tool : shape),
  )!
  const shapeActive = SHAPES.some((s) => s.tool === tool)
  return (
    <div
      role="toolbar"
      aria-label={tr.spacesUi.toolsLabel}
      data-testid="space-dock"
      className="sp-float absolute bottom-6 left-1/2 z-20 flex h-11 -translate-x-1/2 items-center gap-0.5 p-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <ToolButton
        testId="tool-select"
        label={tr.spaces.tools.select}
        shortcut="V"
        active={tool === 'select'}
        onClick={() => setTool('select')}
      >
        <MousePointer2 {...ICON} />
      </ToolButton>
      <ToolButton
        testId="tool-hand"
        label={tr.spaces.tools.hand}
        shortcut="H"
        active={tool === 'hand'}
        onClick={() => setTool('hand')}
      >
        <Hand {...ICON} />
      </ToolButton>
      <span className="sp-sep" />
      <ToolButton
        testId="tool-note"
        label={tr.spaces.tools.note}
        shortcut="N"
        active={tool === 'note'}
        onClick={() => setTool('note')}
      >
        <StickyNote {...ICON} />
      </ToolButton>
      <ToolButton
        testId="tool-text"
        label={tr.spaces.tools.text}
        shortcut="T"
        active={tool === 'text'}
        onClick={() => setTool('text')}
      >
        <Type {...ICON} />
      </ToolButton>
      <ToolButton
        testId={`tool-${current.tool}`}
        label={current.label()}
        {...(current.key ? { shortcut: current.key } : {})}
        active={shapeActive}
        onClick={() => setTool(current.tool)}
      >
        {current.icon}
      </ToolButton>
      <Menu.Dropdown.Root>
        <Menu.Dropdown.Trigger asChild>
          <button
            type="button"
            data-testid="tool-shapes"
            aria-label={tr.spacesExtra.shapes}
            className="-ml-1 flex h-9 w-4 items-center justify-center rounded-full text-fg-faint hover:text-fg"
          >
            <ChevronUp size={12} strokeWidth={2} />
          </button>
        </Menu.Dropdown.Trigger>
        <Menu.Dropdown.Content side="top" align="center" data-testid="shapes-menu">
          {SHAPES.map((s) => (
            <Menu.Dropdown.Item
              key={s.tool}
              icon={s.icon}
              data-testid={`shape-${s.tool}`}
              onSelect={() => {
                setShape(s.tool)
                setTool(s.tool)
              }}
            >
              {s.label()}
              {s.key ? <span className="ml-auto pl-4 text-fg-faint">{s.key}</span> : null}
            </Menu.Dropdown.Item>
          ))}
        </Menu.Dropdown.Content>
      </Menu.Dropdown.Root>
      <span className="sp-sep" />
      <ToolButton
        testId="tool-image"
        label={tr.spacesUi.pickImages}
        shortcut="I"
        onClick={() =>
          document.querySelector<HTMLInputElement>('[data-testid="space-file-input"]')?.click()
        }
      >
        <ImageIcon {...ICON} />
      </ToolButton>
      <ToolButton
        testId="tool-library"
        label={tr.spacesUi.drawer}
        shortcut="L"
        active={drawerOpen}
        onClick={() => useSpace.setState((s) => ({ drawerOpen: !s.drawerOpen }))}
      >
        <Library {...ICON} />
      </ToolButton>
      <span className="sp-sep" />
      <ToolButton
        testId="space-undo"
        label={tr.spacesUi.undo}
        shortcut="⌘Z"
        disabled={!history.canUndo}
        onClick={() => void undo()}
      >
        <Undo2 {...ICON} />
      </ToolButton>
      <ToolButton
        testId="space-redo"
        label={tr.spacesUi.redo}
        shortcut="⇧⌘Z"
        disabled={!history.canRedo}
        onClick={() => void redo()}
      >
        <Redo2 {...ICON} />
      </ToolButton>
    </div>
  )
}
