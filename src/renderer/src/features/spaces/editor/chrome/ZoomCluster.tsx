/**
 * Cluster de zoom : bas-gauche, pilule 32 px « − 100 % + » ; clic
 * sur le pourcentage → menu (zoom avant / arrière, 100 % ⌘0, Ajuster tout ⇧1, Ajuster la
 * sélection ⇧2, Molette : défiler / zoomer — réglage `spacesWheel`), puis bouton « Ajuster ».
 */
import { Maximize, Minus, Plus } from 'lucide-react'
import { Menu, Tooltip } from '../../../../components/ui'
import { fr } from '../../../../i18n/fr'
import { pct } from '../../../../lib/format'
import { usePrefs } from '../../../../state/prefs'
import { fitAll, fitSelection, zoomStep, zoomTo } from '../actions'
import { useCamera } from '../store/spaceStore'

export function ZoomCluster() {
  const zoom = useCamera((s) => s.camera.zoom)
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
        <Tooltip content={fr.spacesUi.zoomOut} shortcut={['⌘', '−']} side="top">
          <button
            type="button"
            aria-label={fr.spacesUi.zoomOut}
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
              aria-label={fr.spacesUi.zoomMenu}
              className="h-7 min-w-[52px] rounded-full px-1 text-center text-caption font-medium text-fg tnum hover:bg-[var(--hover)]"
            >
              {pct(zoom)}
            </button>
          </Menu.Dropdown.Trigger>
          <Menu.Dropdown.Content side="top" align="start" data-testid="zoom-menu">
            <Menu.Dropdown.Item onSelect={() => zoomStep(1)}>
              {fr.spacesUi.zoomIn}
              <span className="ml-auto pl-6 text-fg-faint">⌘+</span>
            </Menu.Dropdown.Item>
            <Menu.Dropdown.Item onSelect={() => zoomStep(-1)}>
              {fr.spacesUi.zoomOut}
              <span className="ml-auto pl-6 text-fg-faint">⌘−</span>
            </Menu.Dropdown.Item>
            <Menu.Dropdown.Item onSelect={() => zoomTo(1)}>
              {fr.spacesUi.zoom100}
              <span className="ml-auto pl-6 text-fg-faint">⌘0</span>
            </Menu.Dropdown.Item>
            <Menu.Dropdown.Item onSelect={fitAll}>
              {fr.spacesUi.fitAll}
              <span className="ml-auto pl-6 text-fg-faint">⇧1</span>
            </Menu.Dropdown.Item>
            <Menu.Dropdown.Item onSelect={fitSelection}>
              {fr.spacesUi.fitSelection}
              <span className="ml-auto pl-6 text-fg-faint">⇧2</span>
            </Menu.Dropdown.Item>
            <Menu.Dropdown.Separator />
            <Menu.Dropdown.Label>{fr.spacesUi.wheel}</Menu.Dropdown.Label>
            <Menu.Dropdown.CheckboxItem
              checked={wheel === 'scroll'}
              onSelect={() => setWheel('scroll')}
            >
              {fr.spacesUi.wheelScroll}
            </Menu.Dropdown.CheckboxItem>
            <Menu.Dropdown.CheckboxItem
              checked={wheel === 'zoom'}
              onSelect={() => setWheel('zoom')}
            >
              {fr.spacesUi.wheelZoom}
            </Menu.Dropdown.CheckboxItem>
          </Menu.Dropdown.Content>
        </Menu.Dropdown.Root>
        <Tooltip content={fr.spacesUi.zoomIn} shortcut={['⌘', '+']} side="top">
          <button
            type="button"
            aria-label={fr.spacesUi.zoomIn}
            data-testid="zoom-in"
            className="flex h-7 w-7 items-center justify-center rounded-full text-fg-muted hover:bg-[var(--hover)] hover:text-fg"
            onClick={() => zoomStep(1)}
          >
            <Plus size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>
      </div>
      <Tooltip content={fr.spacesUi.fitAll} shortcut={['⇧', '1']} side="top">
        <button
          type="button"
          data-testid="zoom-fit"
          className="sp-float flex h-8 items-center gap-1.5 px-3 text-caption font-medium text-fg-muted hover:text-fg"
          onClick={fitAll}
        >
          <Maximize size={13} strokeWidth={1.75} />
          {fr.spaces.fit}
        </button>
      </Tooltip>
    </div>
  )
}
