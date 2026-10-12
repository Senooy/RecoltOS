/**
 * `Slider`, variants:
 * - `columns`: thin track without fill, Ø 14 thumb (sub-bar, 2 to 8 columns);
 * - `zoom`: on the viewer's dark background, `--viewer-track` track, light fill, 110 px;
 * - `settings`: track + `--accent` fill, Ø 16 thumb (Settings).
 * Single value (number). The thumb carries the accessible name.
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
  /** Accessible name (required: a slider without a name is unusable for screen readers). */
  label: string
  /** Text announced for the value (e.g. « 4 colonnes », « 100 % »). */
  valueText?: string
  onValueChange?: (value: number) => void
  /** End of the gesture (keyboard or thumb release). */
  onValueCommit?: (value: number) => void
  /** Inverted track (minimum on the right). */
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
