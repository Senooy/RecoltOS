/**
 * Palette swatches, centered under the preview: 8 swatches Ø 22, gap 8; click = search
 * by color (`ui.openSearch({color})`); ⌥-click = copy the hex (toast "#3f3fbf
 * copied"); tooltip with the hex in mono.
 */
import { Tooltip, toast } from '../../components/ui'
import { tr } from '../../i18n'
import { rpc } from '../../lib/rpc'
import { useUi } from '../../state/ui'

export function PaletteSwatches({ palette }: { palette: readonly string[] }) {
  return (
    <div data-testid="palette-swatches" className="flex flex-wrap justify-center gap-2">
      {palette.slice(0, 8).map((hex, i) => (
        <Tooltip key={`${hex}-${i}`} content={<span className="font-mono">{hex}</span>} side="top">
          <button
            type="button"
            data-hex={hex}
            aria-label={tr.searchUi.colorChip(hex)}
            className="viewer-swatch"
            style={{ background: hex }}
            onClick={(e) => {
              if (e.altKey) {
                void rpc('system.copyText', { text: hex })
                  .then(() => toast(tr.viewer.colorCopied(hex)))
                  .catch(() => undefined)
                return
              }
              useUi.getState().openSearch({ color: hex })
            }}
          />
        </Tooltip>
      ))}
    </div>
  )
}
