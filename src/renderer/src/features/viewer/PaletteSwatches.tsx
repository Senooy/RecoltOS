/**
 * Pastilles de la palette (DESIGN §3.7, point 9) : 8 pastilles Ø 20, écart 6 ; clic = recherche
 * par couleur (`ui.openSearch({color})`, ERRATA §B) ; ⌥-clic = copier l'hex (toast « #3f3fbf
 * copié ») ; infobulle avec l'hex en mono.
 */
import { Tooltip, toast } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { rpc } from '../../lib/rpc'
import { useUi } from '../../state/ui'

export function PaletteSwatches({ palette }: { palette: readonly string[] }) {
  return (
    <div data-testid="palette-swatches" className="flex flex-wrap gap-1.5">
      {palette.slice(0, 8).map((hex, i) => (
        <Tooltip key={`${hex}-${i}`} content={<span className="font-mono">{hex}</span>} side="top">
          <button
            type="button"
            data-hex={hex}
            aria-label={fr.searchUi.colorChip(hex)}
            className="h-5 w-5 rounded-full border border-[rgba(255,255,255,.12)] transition-transform duration-[var(--dur-fast)] hover:scale-110"
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
