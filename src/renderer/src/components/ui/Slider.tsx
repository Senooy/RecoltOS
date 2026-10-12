/**
 * `Slider`, variantes :
 * - `columns` : piste fine sans remplissage, pouce Ø 14 (sous-barre, 2 à 8 colonnes) ;
 * - `zoom` : sur fond sombre du viewer, piste `--viewer-track`, remplissage clair, 110 px ;
 * - `settings` : piste + remplissage `--accent`, pouce Ø 16 (Réglages).
 * Valeur unique (number). Le pouce porte le nom accessible.
 */
import { cva } from 'class-variance-authority'
import { Slider as SliderPrimitive } from 'radix-ui'
import { cn } from '../../lib/cn'

export type SliderVariant = 'columns' | 'zoom' | 'settings'

const track = cva('relative grow overflow-hidden rounded-full', {
  variants: {
    variant: {
      columns: 'h-[3px] bg-[var(--slider-track)]',
      zoom: 'h-[3px] bg-[var(--viewer-track)]',
      settings: 'h-1 bg-[var(--slider-track)]',
    },
  },
})
const range = cva('absolute h-full rounded-full', {
  variants: {
    variant: {
      columns: 'bg-transparent',
      zoom: 'bg-[var(--viewer-fg)]',
      settings: 'bg-accent',
    },
  },
})
const thumb = cva(
  'block rounded-full shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-transform duration-[var(--dur-fast)] hover:scale-110 data-[disabled]:opacity-40',
  {
    variants: {
      variant: {
        columns: 'h-[14px] w-[14px] bg-[var(--slider-thumb)]',
        zoom: 'h-[14px] w-[14px] bg-white',
        settings: 'h-4 w-4 bg-[var(--slider-thumb)]',
      },
    },
  },
)
const root = cva('relative flex h-5 touch-none select-none items-center', {
  variants: {
    variant: { columns: 'w-[90px]', zoom: 'w-[110px]', settings: 'w-[180px]' },
  },
})

export interface SliderProps {
  value: number
  min: number
  max: number
  step?: number
  variant?: SliderVariant
  /** Nom accessible FR (obligatoire : un slider sans nom est inutilisable au lecteur d'écran). */
  label: string
  /** Texte annoncé pour la valeur (« 4 colonnes », « 100 % »). */
  valueText?: string
  onValueChange?: (value: number) => void
  /** Fin du geste (clavier ou relâchement du pouce). */
  onValueCommit?: (value: number) => void
  /** Piste inversée (le minimum à droite). */
  inverted?: boolean
  disabled?: boolean
  className?: string
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  variant = 'settings',
  label,
  valueText,
  onValueChange,
  onValueCommit,
  inverted,
  disabled,
  className,
}: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn(root({ variant }), className)}
      value={[value]}
      min={min}
      max={max}
      step={step}
      inverted={inverted}
      disabled={disabled}
      onValueChange={(v) => {
        const n = v[0]
        if (n !== undefined) onValueChange?.(n)
      }}
      onValueCommit={(v) => {
        const n = v[0]
        if (n !== undefined) onValueCommit?.(n)
      }}
    >
      <SliderPrimitive.Track className={track({ variant })}>
        <SliderPrimitive.Range className={range({ variant })} />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        aria-valuetext={valueText}
        className={thumb({ variant })}
      />
    </SliderPrimitive.Root>
  )
}
