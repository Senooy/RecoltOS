/**
 * `Switch` (DESIGN §3.10) : 34×20, piste `--switch-on` / `--switch-off`, pastille Ø 16, 160 ms.
 */
import { Switch as SwitchPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import './ui.css'

/**
 * Nom accessible OBLIGATOIRE (typage) : `aria-label`, ou `aria-labelledby` quand un `<label>`
 * visible est associé. Le contrôle ne compile pas sans l'un des deux.
 */
export type SwitchProps = Omit<ComponentProps<typeof SwitchPrimitive.Root>, 'children'> &
  (
    | { 'aria-label': string; 'aria-labelledby'?: undefined }
    | { 'aria-labelledby': string; 'aria-label'?: undefined }
  )

export function Switch({ className, ...rest }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-5 w-[34px] shrink-0 items-center rounded-full border',
        'transition-[background-color,border-color] duration-[160ms]',
        'border-border-strong bg-[var(--switch-off)] data-[state=checked]:border-transparent',
        'data-[state=checked]:bg-[var(--switch-on)]',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full',
          'translate-x-px bg-[var(--switch-knob-off)] transition-[transform,background-color] duration-[160ms]',
          'data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-[var(--switch-knob-on)]',
        )}
      />
    </SwitchPrimitive.Root>
  )
}
