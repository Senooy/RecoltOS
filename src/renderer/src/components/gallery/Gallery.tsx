/**
 * Galerie du kit UI (WP-04) : chaque composant en thème clair ET sombre, pour la relecture
 * visuelle. Servie en dev par `?gallery=1` (voir `gallery-entry.tsx` et `docs/contrats/CHANGELOG.md`).
 *
 * Aucune classe de palette Tailwind : uniquement des tokens (vérifié par
 * `tests/renderer/ui/gallery.test.tsx`).
 */
import {
  Camera,
  ChartPie,
  Compass,
  Copy,
  Download,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  Images,
  Info,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Trash,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { CosmosGlyph, InstagramGlyph, RecoltLogo, XGlyph } from '../icons'
import {
  Avatar,
  Button,
  Chip,
  Dialog,
  EmptyState,
  FormatBadge,
  IconButton,
  Input,
  Kbd,
  MediaBadge,
  Menu,
  PillBar,
  Popover,
  PortalContainerProvider,
  SegmentedSmall,
  Slider,
  Spinner,
  Switch,
  Toaster,
  Tooltip,
  toast,
} from '../ui'

type Theme = 'light' | 'dark'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-micro uppercase text-fg-faint">{title}</h3>
      {children}
    </section>
  )
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-3 ${className ?? ''}`}>{children}</div>
}

/** Panneau sombre immersif (viewer) : pour les composants conçus pour ce fond. */
function Immersive({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--viewer-base)] p-4 text-[var(--viewer-fg)]">
      {children}
    </div>
  )
}

function Showcase() {
  const [sw, setSw] = useState(true)
  const [cols, setCols] = useState(4)
  const [zoom, setZoom] = useState(100)
  const [pref, setPref] = useState(5)
  const [seg, setSeg] = useState<'light' | 'dark' | 'system'>('light')
  const [checked, setChecked] = useState(true)
  const [chip, setChip] = useState(false)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  return (
    <div className="flex flex-col gap-8">
      <Section title="Button">
        <Row>
          <Button variant="primary">Importer…</Button>
          <Button variant="secondary">Nouvelle bibliothèque</Button>
          <Button variant="ghost">Annuler</Button>
          <Button variant="danger">Vider la corbeille maintenant</Button>
          <Button variant="primary" disabled>
            Désactivé
          </Button>
        </Row>
        <Row>
          <Button size="sm" icon={<Plus size={14} />}>
            sm 28
          </Button>
          <Button size="md" icon={<Plus size={16} />}>
            md 34
          </Button>
          <Button size="lg" variant="primary" icon={<Plus size={16} />}>
            lg 36
          </Button>
          <Button shape="rounded" variant="secondary">
            Rounded
          </Button>
          <Button
            variant="primary"
            loading={loading}
            onClick={() => {
              setLoading(true)
              window.setTimeout(() => setLoading(false), 1500)
            }}
          >
            Charger
          </Button>
        </Row>
      </Section>

      <Section title="IconButton">
        <Row>
          <IconButton icon={<Compass />} label="Redécouvrir" shortcut={['⌘', '⇧', 'R']} />
          <IconButton icon={<Settings />} label="Réglages" shortcut={['⌘', ',']} />
          <IconButton icon={<Search />} label="Rechercher" tone="outline" />
          <IconButton icon={<Plus />} label="Ajouter" tone="glass" size="lg" />
          <IconButton icon={<Info />} label="Informations" size="sm" />
          <IconButton icon={<Trash />} label="Supprimer" disabled />
        </Row>
        <Immersive>
          <IconButton icon={<X />} label="Fermer" tone="viewer" size="lg" />
          <IconButton icon={<Download />} label="Télécharger" tone="viewer" />
        </Immersive>
      </Section>

      <Section title="Kbd">
        <Row>
          <Kbd keys={['⌘', 'K']} />
          <Kbd keys={['esc']} size="sm" />
          <Kbd keys={['⌘', '⇧', 'S']} size="md" />
        </Row>
        <Immersive>
          <Kbd keys={['⌘', 'I']} tone="dark" />
          <Kbd keys={['←', '↑', '→']} tone="rediscover" size="sm" />
        </Immersive>
      </Section>

      <Section title="Switch · Slider · SegmentedSmall">
        <Row>
          <Switch checked={sw} onCheckedChange={setSw} aria-label="Lire les vidéos au survol" />
          <Switch checked={!sw} onCheckedChange={(v) => setSw(!v)} aria-label="Exemple désactivé" />
          <Switch disabled aria-label="Indisponible" />
          <Slider
            variant="columns"
            min={2}
            max={8}
            value={cols}
            onValueChange={setCols}
            label="Taille des colonnes"
            valueText={`${cols} colonnes`}
            inverted
          />
          <span className="tnum text-caption text-fg-muted">{cols}</span>
          <Slider
            variant="settings"
            min={2}
            max={8}
            value={pref}
            onValueChange={setPref}
            label="Colonnes par défaut"
          />
          <span className="tnum text-caption text-fg-muted">{pref}</span>
        </Row>
        <Immersive>
          <Slider
            variant="zoom"
            min={25}
            max={300}
            step={5}
            value={zoom}
            onValueChange={setZoom}
            label="Zoom"
            valueText={`${zoom} %`}
          />
          <span className="tnum text-caption text-[var(--viewer-fg-muted)]">{zoom} %</span>
        </Immersive>
        <Row>
          <SegmentedSmall
            label="Thème"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'light', label: 'Clair', icon: <Sun /> },
              { value: 'dark', label: 'Sombre', icon: <Moon /> },
              { value: 'system', label: 'Système' },
            ]}
          />
        </Row>
      </Section>

      <Section title="Tooltip (600 ms) · Menu · Popover · Dialog">
        <Row>
          <Tooltip content="Réglages" shortcut={['⌘', ',']} defaultOpen side="right">
            <Button variant="secondary" size="sm">
              Infobulle ouverte
            </Button>
          </Tooltip>
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button variant="secondary" size="sm">
                Popover
              </Button>
            </Popover.Trigger>
            <Popover.Content className="w-60 text-small">
              Filtres de recherche, sélecteur de collections…
            </Popover.Content>
          </Popover.Root>
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <Button variant="secondary" size="sm">
                Dialogue
              </Button>
            </Dialog.Trigger>
            <Dialog.Content
              title="Supprimer « Dev » ?"
              description="Les éléments restent dans ta bibliothèque."
            >
              <div className="flex justify-end gap-2 p-5 pt-6">
                <Dialog.Close asChild>
                  <Button variant="secondary">Annuler</Button>
                </Dialog.Close>
                <Dialog.Close asChild>
                  <Button variant="primary">Supprimer</Button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Root>
          <Menu.Context.Root>
            <Menu.Context.Trigger asChild>
              <div className="flex h-9 items-center rounded-lg border border-dashed border-[var(--border-dashed)] px-3 text-small text-fg-muted">
                Clic droit ici (menu contextuel)
              </div>
            </Menu.Context.Trigger>
            <Menu.Context.Content>
              <Menu.Context.Item icon={<Copy />}>Copier l’image</Menu.Context.Item>
              <Menu.Context.Item icon={<Trash />} tone="danger">
                Supprimer
              </Menu.Context.Item>
            </Menu.Context.Content>
          </Menu.Context.Root>
        </Row>
        <div className="min-h-[300px]">
          <Menu.Dropdown.Root open modal={false}>
            <Menu.Dropdown.Trigger asChild>
              <Button variant="secondary" size="sm">
                Menu ouvert
              </Button>
            </Menu.Dropdown.Trigger>
            <Menu.Dropdown.Content align="start" onInteractOutside={(e) => e.preventDefault()}>
              <Menu.Dropdown.Sub>
                <Menu.Dropdown.SubTrigger icon={<FolderPlus />}>
                  Ajouter à une collection
                </Menu.Dropdown.SubTrigger>
                <Menu.Dropdown.SubContent>
                  <Menu.Dropdown.CheckboxItem
                    checked={checked}
                    onCheckedChange={setChecked}
                    icon={<Folder />}
                  >
                    Gaming
                  </Menu.Dropdown.CheckboxItem>
                  <Menu.Dropdown.Item icon={<Folder />}>Dev</Menu.Dropdown.Item>
                </Menu.Dropdown.SubContent>
              </Menu.Dropdown.Sub>
              <Menu.Dropdown.Item icon={<EyeOff />}>Masquer de la bibliothèque</Menu.Dropdown.Item>
              <Menu.Dropdown.Item icon={<Eye />} shortcut={['⌘', 'H']}>
                Ne plus masquer
              </Menu.Dropdown.Item>
              <Menu.Dropdown.Item icon={<FolderOpen />}>Afficher dans le Finder</Menu.Dropdown.Item>
              <Menu.Dropdown.Item icon={<Download />}>Télécharger</Menu.Dropdown.Item>
              <Menu.Dropdown.Item icon={<Trash />} tone="danger">
                Supprimer
              </Menu.Dropdown.Item>
            </Menu.Dropdown.Content>
          </Menu.Dropdown.Root>
        </div>
      </Section>

      <Section title="Input · Chip">
        <Row>
          <div className="w-60">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sans titre"
              aria-label="Nom"
            />
          </div>
          <div className="w-60">
            <Input
              readOnly
              value="https://x.com/…"
              aria-label="URL"
              trailing={
                <IconButton
                  icon={<Info />}
                  label="Ouvrir le lien"
                  size="sm"
                  tooltip={false}
                  tabIndex={-1}
                />
              }
            />
          </div>
          <div className="w-60">
            <Input invalid defaultValue="Champ en erreur" aria-label="Erreur" />
          </div>
        </Row>
        <Row>
          <Chip variant="tag" label="design" />
          <Chip variant="recent" label="instagram" icon={<Search />} onClick={() => undefined} />
          <Chip
            variant="filter"
            label="Images"
            icon={<Images />}
            selected={chip}
            onClick={() => setChip(!chip)}
          />
          <Chip variant="collection" label="Gaming" icon={<Folder />} onRemove={() => undefined} />
        </Row>
        <Immersive>
          <Chip variant="viewer" label="Dev" onRemove={() => undefined} />
          <Chip variant="viewer" label="+ Ajouter" onClick={() => undefined} />
        </Immersive>
      </Section>

      <Section title="EmptyState · Spinner · PillBar · Toaster">
        <div className="rounded-xl border border-border-subtle">
          <EmptyState
            icon={<Images />}
            title="Ta bibliothèque est vide"
            description="Glisse des images ici, colle une URL ou importe ta bibliothèque GatherOS."
            action={
              <>
                <Button variant="primary">Importer depuis GatherOS</Button>
                <Button variant="secondary">Importer des fichiers</Button>
              </>
            }
          />
        </div>
        <div className="rounded-xl bg-[var(--shelf-bg)]">
          <EmptyState
            variant="dark"
            icon={<Folder />}
            title="Cette collection est vide"
            description="Glisse des éléments ici depuis ta bibliothèque."
          />
        </div>
        <Row>
          <Spinner />
          <Spinner size={24} />
          <PillBar>
            Ajouté à Gaming
            <PillBar.Action>Annuler</PillBar.Action>
          </PillBar>
          <PillBar>
            3 sélectionnés
            <PillBar.Action tone="ghost">Masquer</PillBar.Action>
            <PillBar.Action tone="danger">Supprimer</PillBar.Action>
          </PillBar>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              toast('Ajouté à Gaming', { action: { label: 'Annuler', onClick: () => undefined } })
            }
          >
            Lancer un toast
          </Button>
        </Row>
      </Section>

      <Section title="Avatar · MediaBadge · FormatBadge · glyphes">
        <Row>
          <Avatar name="Claude Devs" handle="ClaudeDevs" />
          <Avatar name="GamesLover with a Preference" handle="tofi_lover0930" />
          <Avatar name="Martin G" handle="TurtlesFatherG" size={28} />
          <Avatar name="Photo cassée" handle="broken" src="recolt://mock/avatars/missing.jpg" />
          <div
            className="relative h-24 w-44 rounded-md"
            style={{ background: 'linear-gradient(135deg, #c8b49c, #6f86a3)' }}
          >
            <MediaBadge kind="video" className="absolute right-2 top-2" />
            <MediaBadge kind="carousel" label="1/6" className="absolute left-2 top-2" />
            <MediaBadge kind="gif" className="absolute bottom-2 left-2" />
          </div>
          <FormatBadge format="MP4" />
          <FormatBadge format="WEBP" />
          <FormatBadge format="PAGE" />
        </Row>
        <Row className="text-fg-social">
          <XGlyph />
          <InstagramGlyph />
          <CosmosGlyph />
          <RecoltLogo />
          <RecoltLogo size={56} />
          <GlyphsSample />
        </Row>
      </Section>
    </div>
  )
}

/** Petite aide visuelle : trois icônes de l'en-tête pour juger le trait 1,75. */
function GlyphsSample() {
  return (
    <span className="flex items-center gap-3 text-fg-subtle">
      <Camera size={18} strokeWidth={1.75} />
      <ChartPie size={18} strokeWidth={1.75} />
      <FolderPlus size={18} strokeWidth={1.75} />
    </span>
  )
}

function ThemeBlock({ theme }: { theme: Theme }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  return (
    <div
      ref={setEl}
      data-theme={theme}
      data-gallery-theme={theme}
      className="relative min-w-0 flex-1 bg-bg p-6 text-fg"
    >
      <PortalContainerProvider container={el}>
        <h2 className="mb-6 text-display font-bold">{theme === 'light' ? 'Clair' : 'Sombre'}</h2>
        <Showcase />
      </PortalContainerProvider>
    </div>
  )
}

export default function Gallery() {
  return (
    <div data-testid="ui-gallery" className="h-full overflow-auto bg-bg text-fg">
      <div className="flex items-center gap-3 border-b border-border-subtle px-6 py-3">
        <RecoltLogo />
        <span className="text-nav font-semibold">Galerie du kit UI</span>
        <span className="text-small text-fg-muted">clair et sombre, côte à côte</span>
      </div>
      <div className="flex flex-col lg:flex-row">
        <ThemeBlock theme="light" />
        <ThemeBlock theme="dark" />
      </div>
      <Toaster />
    </div>
  )
}
