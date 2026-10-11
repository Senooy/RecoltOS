/**
 * `SegmentedSmall` (DESIGN §4.3) : petit segmenté pour Réglages (Clair / Sombre / Système) et
 * filtres de période. Radix ToggleGroup `single` (groupe de boutons radio) ; un clic sur le
 * segment actif ne le désélectionne jamais.
 */
import { ToggleGroup } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  icon?: ReactNode
}

export interface SegmentedSmallProps<V extends string> {
  options: readonly SegmentedOption<V>[]
  value: V
  onChange: (value: V) => void
  /** Nom accessible du groupe (FR). */
  label: string
  className?: string
}

export function SegmentedSmall<V extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedSmallProps<V>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={label}
      onValueChange={(v) => {
        const next = options.find((o) => o.value === v)
        if (next) onChange(next.value)
      }}
      className={cn(
        'inline-flex h-8 items-center gap-0.5 rounded-full border border-border bg-bg p-[3px]',
        className,
      )}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            'inline-flex h-[24px] select-none items-center justify-center gap-1.5 rounded-full px-3 text-small font-medium text-fg',
            'transition-[background-color,color] duration-[var(--dur-fast)]',
            'hover:bg-[var(--hover)] data-[state=on]:bg-accent data-[state=on]:text-accent-fg',
            '[&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:[stroke-width:1.75]',
          )}
        >
          {o.icon}
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
