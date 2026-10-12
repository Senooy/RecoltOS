/**
 * `Toaster`: sonner as a pill (centred, `bottom: 24`, 40 px, `--surface` background).
 * `unstyled`: everything comes from the tokens (light and dark), the "Cancel" action is a black pill.
 * Reduced motion: fade only (`ui.css`). Mount ONCE at the app root.
 *
 *   import { toast } from './Toaster'
 *   toast('Ajouté à Gaming', { action: { label: 'Annuler', onClick: undo } })
 */
import { Toaster as Sonner, toast } from 'sonner'
import { cn } from '../../lib/cn'
import { UI_LABELS } from './labels'
import { PILL_CLASS, pillActionVariants } from './PillBar'
import './ui.css'

export { toast }

export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      offset={24}
      mobileOffset={24}
      visibleToasts={3}
      gap={8}
      duration={4000}
      closeButton={false}
      hotkey={[]}
      containerAriaLabel={UI_LABELS.notifications}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: cn(
            PILL_CLASS,
            'left-0 right-0 mx-auto w-fit min-w-[200px] max-w-[min(560px,calc(100vw-48px))]',
          ),
          title: 'truncate text-small text-fg',
          description: 'text-caption text-fg-muted',
          actionButton: cn(pillActionVariants({ tone: 'primary' }), 'ml-auto'),
          cancelButton: pillActionVariants({ tone: 'ghost' }),
          icon: 'text-fg-subtle',
        },
      }}
    />
  )
}
