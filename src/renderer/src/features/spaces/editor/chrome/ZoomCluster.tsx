/**
 * Zoom cluster: bottom-left, 32 px pill « − 100 % + »; click
 * on the percentage → menu (zoom in / out, 100 % ⌘0, Fit all ⇧1, Fit
 * selection ⇧2, Wheel: scroll / zoom — `spacesWheel` setting), then the « Fit » button.
 */
import { Maximize, Minus, Plus } from 'lucide-react'
import { Menu, Tooltip } from '../../../../components/ui'
import { tr } from '../../../../i18n'
import { pct } from '../../../../lib/format'
import { usePrefs } from '../../../../state/prefs'
import { fitAll, fitSelection, zoomStep, zoomTo } from '../actions'
import { useCamera } from '../store/spaceStore'

/**
 * Displayed percentage: only this text follows the camera, and only when the rounded value
 * changes (the cluster, its tooltips and its menu are not re-rendered on every zoom frame).
 */
function ZoomValue() {
  return <>{useCamera((s) => pct(s.camera.zoom))}</>
}

export function ZoomCluster() {
  const wheel = usePrefs((s) => s.prefs.spacesWheel)
  const setWheel = (v: 'scroll' | 'zoom') =>
    void usePrefs
      .getState()
      .update({ spacesWheel: v })
      .catch(() => undefined)
  return (
    <div
      className="absolute bottom-6 left-6 z-20 flex items-center gap-2"
      data-testid="space-zoom"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="sp-float flex h-8 items-center px-0.5">
        <Tooltip content={tr.spacesUi.zoomOut} shortcut={['⌘', '−']} side="top">
          <button
            type="button"
            aria-label={tr.spacesUi.zoomOut}
            data-testid="zoom-out"
            className="flex h-7 w-7 items-center justify-center rounded-full text-fg-muted hover:bg-[var(--hover)] hover:text-fg"
            onClick={() => zoomStep(-1)}
          >
            <Minus size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>
        <Menu.Dropdown.Root>
          <Menu.Dropdown.Trigger asChild>
            <button
              type="button"
              data-testid="zoom-value"
              aria-label={tr.spacesUi.zoomMenu}
              className="h-7 min-w-[52px] rounded-full px-1 text-center text-caption font-medium text-fg tnum hover:bg-[var(--hover)]"
            >
              <ZoomValue />
            </button>
          </Menu.Dropdown.Trigger>
          <Menu.Dropdown.Content side="top" align="start" data-testid="zoom-menu">
            <Menu.Dropdown.Item onSelect={() => zoomStep(1)}>
              {tr.spacesUi.zoomIn}
              <span className="ml-auto pl-6 text-fg-faint">⌘+</span>
            </Menu.Dropdown.Item>
            <Menu.Dropdown.Item onSelect={() => zoomStep(-1)}>
              {tr.spacesUi.zoomOut}
              <span className="ml-auto pl-6 text-fg-faint">⌘−</span>
            </Menu.Dropdown.Item>
            <Menu.Dropdown.Item onSelect={() => zoomTo(1)}>
              {tr.spacesUi.zoom100}
              <span className="ml-auto pl-6 text-fg-faint">⌘0</span>
            </Menu.Dropdown.Item>
            <Menu.Dropdown.Item onSelect={fitAll}>
              {tr.spacesUi.fitAll}
              <span className="ml-auto pl-6 text-fg-faint">⇧1</span>
            </Menu.Dropdown.Item>
            <Menu.Dropdown.Item onSelect={fitSelection}>
              {tr.spacesUi.fitSelection}
              <span className="ml-auto pl-6 text-fg-faint">⇧2</span>
            </Menu.Dropdown.Item>
            <Menu.Dropdown.Separator />
            <Menu.Dropdown.Label>{tr.spacesUi.wheel}</Menu.Dropdown.Label>
            <Menu.Dropdown.CheckboxItem
              checked={wheel === 'scroll'}
              onSelect={() => setWheel('scroll')}
            >
              {tr.spacesUi.wheelScroll}
            </Menu.Dropdown.CheckboxItem>
            <Menu.Dropdown.CheckboxItem
              checked={wheel === 'zoom'}
              onSelect={() => setWheel('zoom')}
            >
              {tr.spacesUi.wheelZoom}
            </Menu.Dropdown.CheckboxItem>
          </Menu.Dropdown.Content>
        </Menu.Dropdown.Root>
        <Tooltip content={tr.spacesUi.zoomIn} shortcut={['⌘', '+']} side="top">
          <button
            type="button"
            aria-label={tr.spacesUi.zoomIn}
            data-testid="zoom-in"
            className="flex h-7 w-7 items-center justify-center rounded-full text-fg-muted hover:bg-[var(--hover)] hover:text-fg"
            onClick={() => zoomStep(1)}
          >
            <Plus size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>
      </div>
      <Tooltip content={tr.spacesUi.fitAll} shortcut={['⇧', '1']} side="top">
        <button
          type="button"
          data-testid="zoom-fit"
          className="sp-float flex h-8 items-center gap-1.5 px-3 text-caption font-medium text-fg-muted hover:text-fg"
          onClick={fitAll}
        >
          <Maximize size={13} strokeWidth={1.75} />
          {tr.spaces.fit}
        </button>
      </Tooltip>
    </div>
  )
}
