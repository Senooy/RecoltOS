/**
 * Column slider: 0..6 with columns = 8 − value (towards the right, the cards
 * grow); 4 columns by default places the thumb at two thirds.
 */
import { Grid2x2, Square } from 'lucide-react'
import { Slider } from '../../components/ui'
import { tr } from '../../i18n'

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
        label={tr.columns.label}
        valueText={tr.libraryUi.columns(columns)}
        onValueChange={(v) => onChange(8 - v)}
      />
      <Square size={11} />
    </div>
  )
}
