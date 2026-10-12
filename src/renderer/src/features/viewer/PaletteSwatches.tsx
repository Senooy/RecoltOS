/**
 * Pastilles de la palette, centrées sous l'aperçu : 8 pastilles Ø 22, écart 8 ; clic = recherche
 * par couleur (`ui.openSearch({color})`) ; ⌥-clic = copier l'hex (toast « #3f3fbf
 * copié ») ; infobulle avec l'hex en mono.
 */
import { Tooltip, toast } from '../../components/ui'
import { fr } from '../../i18n/fr'
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
            aria-label={fr.searchUi.colorChip(hex)}
            className="viewer-swatch"
            style={{ background: hex }}
            onClick={(e) => {
              if (e.altKey) {
                void rpc('system.copyText', { text: hex })
                  .then(() => toast(fr.viewer.colorCopied(hex)))
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
