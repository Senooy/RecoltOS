/**
 * `Toaster` (DESIGN §2.7) : sonner en pilule (centrée, `bottom: 24`, 40 px, fond `--surface`).
 * `unstyled` : tout vient des tokens (clair et sombre), l'action « Annuler » est une pilule noire.
 * Mouvement réduit : fondu seul (`ui.css`). Monter UNE fois à la racine de l'app.
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
