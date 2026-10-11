/**
 * Réglages (DESIGN §3.10, WP-16) : modale 750×570 (rayon 14), barre latérale de 196 px (9 sections,
 * sans Compte / Abonnement / Mises à jour), gabarit `SettingsRow`. Sections livrées en M1 :
 * Apparence, Bibliothèques (avec l'import GatherOS), À propos ; M2 (WP-24) : Tags, Stockage, Données.
 * IA, Capture et Synchronisation affichent un message jusqu'à leurs jalons.
 */
import {
  Camera,
  Database,
  Hash,
  HardDrive,
  Info,
  Library,
  Palette,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { usePortalContainer } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { cn } from '../../lib/cn'
import { useUi, type SettingsSection } from '../../state/ui'
import { AboutSection } from './sections/About'
import { AppearanceSection } from './sections/Appearance'
import { DataSection } from './sections/Data'
import { LibrariesSection } from './sections/Libraries'
import { StorageSection } from './sections/Storage'
import { TagsSection } from './sections/Tags'

const NAV: { key: SettingsSection; label: string; Icon: typeof Palette }[] = [
  { key: 'appearance', label: fr.settings.nav.appearance, Icon: Palette },
  { key: 'libraries', label: fr.settings.nav.libraries, Icon: Library },
  { key: 'ai', label: fr.settings.nav.ai, Icon: Sparkles },
  { key: 'tags', label: fr.settings.nav.tags, Icon: Hash },
  { key: 'capture', label: fr.settings.nav.capture, Icon: Camera },
  { key: 'sync', label: fr.settings.nav.sync, Icon: RefreshCw },
  { key: 'storage', label: fr.settings.nav.storage, Icon: HardDrive },
  { key: 'data', label: fr.settings.nav.data, Icon: Database },
  { key: 'about', label: fr.settings.nav.about, Icon: Info },
]

export function SettingsTitle({
  children,
  description,
}: {
  children: ReactNode
  description?: ReactNode
}) {
  return (
    <>
      <h2 className="text-display font-bold">{children}</h2>
      {description ? (
        <p className="mt-2.5 max-w-[470px] text-[13.5px] leading-[19.5px] text-fg-muted">
          {description}
        </p>
      ) : null}
    </>
  )
}

export function SettingsRow({
  label,
  description,
  control,
}: {
  label: ReactNode
  description?: ReactNode
  control?: ReactNode
}) {
  return (
    <div className="flex min-h-[58px] items-center gap-4 border-b border-[#ececec] py-2 dark:border-border-subtle">
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] text-fg">{label}</div>
        {description ? <div className="text-[12.5px] text-[#959595]">{description}</div> : null}
      </div>
      {control ? <div className="shrink-0">{control}</div> : null}
    </div>
  )
}

function Placeholder({ title }: { title: string }) {
  return (
    <>
      <SettingsTitle description={fr.settingsUi.placeholder}>{title}</SettingsTitle>
    </>
  )
}

export default function SettingsDialog() {
  const overlay = useUi((s) => s.overlay)
  const close = useUi((s) => s.closeOverlay)
  const openOverlay = useUi((s) => s.openOverlay)
  const container = usePortalContainer()
  const section: SettingsSection = (overlay?.type === 'settings' && overlay.section) || 'appearance'
  const setSection = (s: SettingsSection) => openOverlay({ type: 'settings', section: s })
  const current = NAV.find((n) => n.key === section)!
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && close()}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay className="ui-scrim ui-scrim-modal overlay fixed inset-0 z-50" />
        <DialogPrimitive.Content
          data-testid="settings"
          aria-describedby={undefined}
          className="ui-dialog app-no-drag fixed left-1/2 top-1/2 z-50 flex h-[570px] max-h-[calc(100vh-80px)] w-[750px] max-w-[calc(100vw-48px)] overflow-hidden rounded-2xl bg-bg text-fg shadow-[var(--shadow-modal)]"
        >
          <VisuallyHidden.Root asChild>
            <DialogPrimitive.Title>{fr.settings.title}</DialogPrimitive.Title>
          </VisuallyHidden.Root>
          <nav
            aria-label={fr.settings.title}
            className="absolute bottom-[11px] left-[11px] top-[11px] flex w-[196px] flex-col rounded-xl border border-[#eeeeee] px-2 py-3 dark:border-border"
          >
            <div className="px-2.5 pb-3 pt-2.5 text-[12.5px] text-[#909090]">
              {fr.settings.title}
            </div>
            {NAV.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                data-testid={`settings-nav-${key}`}
                aria-current={section === key ? 'page' : undefined}
                className={cn(
                  'flex h-7 items-center gap-2.5 rounded-lg px-2.5 text-left text-[14.5px]',
                  section === key
                    ? 'bg-[var(--pressed)] text-fg'
                    : 'text-fg-muted hover:bg-[var(--hover)]',
                )}
                onClick={() => setSection(key)}
              >
                <Icon size={16} strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </nav>
          <div
            className="ml-[239px] min-w-0 flex-1 overflow-y-auto pb-8 pr-8 pt-[34px]"
            data-testid={`settings-section-${section}`}
          >
            {section === 'appearance' ? (
              <AppearanceSection />
            ) : section === 'libraries' ? (
              <LibrariesSection />
            ) : section === 'tags' ? (
              <TagsSection />
            ) : section === 'storage' ? (
              <StorageSection />
            ) : section === 'data' ? (
              <DataSection />
            ) : section === 'about' ? (
              <AboutSection />
            ) : (
              <Placeholder title={current.label} />
            )}
          </div>
          <DialogPrimitive.Close
            aria-label={fr.settings.close}
            className="absolute right-[18px] top-4 inline-flex h-7 w-7 items-center justify-center rounded-md text-[#6c6c6c] hover:bg-[var(--hover)]"
          >
            <X size={14} strokeWidth={2} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
