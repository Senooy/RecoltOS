/**
 * Curseur de colonnes (DESIGN §3.1) : 0..6 avec colonnes = 8 − valeur (vers la droite, les cartes
 * grandissent) ; 4 colonnes par défaut place le pouce aux deux tiers.
 */
import { Grid2x2, Square } from 'lucide-react'
import { Slider } from '../../components/ui'
import { fr } from '../../i18n/fr'

export function ColumnSlider({
  columns,
  onChange,
}: {
  columns: number
  onChange: (n: number) => void
}) {
  return (
    <div className="flex items-center gap-2 text-fg-disabled" data-testid="column-slider">
      <Grid2x2 size={12} />
      <Slider
        variant="columns"
        min={0}
        max={6}
        step={1}
        value={8 - columns}
        label={fr.columns.label}
        valueText={fr.libraryUi.columns(columns)}
        onValueChange={(v) => onChange(8 - v)}
      />
      <Square size={11} />
    </div>
  )
}
