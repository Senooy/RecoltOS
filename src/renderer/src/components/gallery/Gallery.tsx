/**
 * UI kit gallery: each component in light AND dark theme, for visual
 * review. Served in dev via `?gallery=1` (see `gallery-entry.tsx`).
 *
 * No Tailwind palette class: tokens only (checked by
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

/** Immersive dark panel (viewer): for components designed for this background. */
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
      <Section title="Buttons">
        <Row>
          <Button variant="primary">Import…</Button>
          <Button variant="secondary">New Library</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Empty Trash Now</Button>
          <Button variant="primary" disabled>
            Disabled
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
            Load
          </Button>
        </Row>
      </Section>

      <Section title="Icon Buttons">
        <Row>
          <IconButton icon={<Compass />} label="Rediscover" shortcut={['⌘', '⇧', 'R']} />
          <IconButton icon={<Settings />} label="Settings" shortcut={['⌘', ',']} />
          <IconButton icon={<Search />} label="Search" tone="outline" />
          <IconButton icon={<Plus />} label="Add" tone="glass" size="lg" />
          <IconButton icon={<Info />} label="Info" size="sm" />
          <IconButton icon={<Trash />} label="Delete" disabled />
        </Row>
        <Immersive>
          <IconButton icon={<X />} label="Close" tone="viewer" size="lg" />
          <IconButton icon={<Download />} label="Download" tone="viewer" />
        </Immersive>
      </Section>

      <Section title="Shortcuts">
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

      <Section title="Switch · Slider · Compact Picker">
        <Row>
          <Switch checked={sw} onCheckedChange={setSw} aria-label="Play videos on hover" />
          <Switch checked={!sw} onCheckedChange={(v) => setSw(!v)} aria-label="Disabled example" />
          <Switch disabled aria-label="Unavailable" />
          <Slider
            variant="columns"
            min={2}
            max={8}
            value={cols}
            onValueChange={setCols}
            label="Column size"
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
            label="Default columns"
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
            label="Theme"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'light', label: 'Clair', icon: <Sun /> },
              { value: 'dark', label: 'Sombre', icon: <Moon /> },
              { value: 'system', label: 'System' },
            ]}
          />
        </Row>
      </Section>

      <Section title="Tooltip (600 ms) · Menu · Popover · Dialog">
        <Row>
          <Tooltip content="Settings" shortcut={['⌘', ',']} defaultOpen side="right">
            <Button variant="secondary" size="sm">
              Tooltip open
            </Button>
          </Tooltip>
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button variant="secondary" size="sm">
                Popover
              </Button>
            </Popover.Trigger>
            <Popover.Content className="w-60 text-small">
              Search filters, collection picker…
            </Popover.Content>
          </Popover.Root>
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <Button variant="secondary" size="sm">
                Dialog
              </Button>
            </Dialog.Trigger>
            <Dialog.Content title="Delete “Dev”?" description="Items stay in your library.">
              <div className="flex justify-end gap-2 p-5 pt-6">
                <Dialog.Close asChild>
                  <Button variant="secondary">Cancel</Button>
                </Dialog.Close>
                <Dialog.Close asChild>
                  <Button variant="primary">Delete</Button>
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
              <Menu.Context.Item icon={<Copy />}>Copy Image</Menu.Context.Item>
              <Menu.Context.Item icon={<Trash />} tone="danger">
                Delete
              </Menu.Context.Item>
            </Menu.Context.Content>
          </Menu.Context.Root>
        </Row>
        <div className="min-h-[300px]">
          <Menu.Dropdown.Root open modal={false}>
            <Menu.Dropdown.Trigger asChild>
              <Button variant="secondary" size="sm">
                Menu open
              </Button>
            </Menu.Dropdown.Trigger>
            <Menu.Dropdown.Content align="start" onInteractOutside={(e) => e.preventDefault()}>
              <Menu.Dropdown.Sub>
                <Menu.Dropdown.SubTrigger icon={<FolderPlus />}>
                  Add to Collection
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
              <Menu.Dropdown.Item icon={<EyeOff />}>Hide from Library</Menu.Dropdown.Item>
              <Menu.Dropdown.Item icon={<Eye />} shortcut={['⌘', 'H']}>
                Unhide
              </Menu.Dropdown.Item>
              <Menu.Dropdown.Item icon={<FolderOpen />}>Show in Finder</Menu.Dropdown.Item>
              <Menu.Dropdown.Item icon={<Download />}>Download</Menu.Dropdown.Item>
              <Menu.Dropdown.Item icon={<Trash />} tone="danger">
                Delete
              </Menu.Dropdown.Item>
            </Menu.Dropdown.Content>
          </Menu.Dropdown.Root>
        </div>
      </Section>

      <Section title="Field · Chip">
        <Row>
          <div className="w-60">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled"
              aria-label="Name"
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
                  label="Open Link"
                  size="sm"
                  tooltip={false}
                  tabIndex={-1}
                />
              }
            />
          </div>
          <div className="w-60">
            <Input invalid defaultValue="Field with an error" aria-label="Error" />
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
          <Chip variant="viewer" label="+ Add" onClick={() => undefined} />
        </Immersive>
      </Section>

      <Section title="Empty State · Loading · Pill · Notification">
        <div className="rounded-xl border border-border-subtle">
          <EmptyState
            icon={<Images />}
            title="Your library is empty"
            description="Drop images here, paste a URL or import your GatherOS library."
            action={
              <>
                <Button variant="primary">Import from GatherOS</Button>
                <Button variant="secondary">Import Files</Button>
              </>
            }
          />
        </div>
        <div className="rounded-xl bg-[var(--shelf-bg)]">
          <EmptyState
            variant="dark"
            icon={<Folder />}
            title="This collection is empty"
            description="Drop items here from your library."
          />
        </div>
        <Row>
          <Spinner />
          <Spinner size={24} />
          <PillBar aria-label="Notification">
            Added to Gaming
            <PillBar.Action>Undo</PillBar.Action>
          </PillBar>
          <PillBar aria-label="Selection">
            3 selected
            <PillBar.Action tone="ghost">Hide</PillBar.Action>
            <PillBar.Action tone="danger">Delete</PillBar.Action>
          </PillBar>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              toast('Added to Gaming', { action: { label: 'Undo', onClick: () => undefined } })
            }
          >
            Show a toast
          </Button>
        </Row>
      </Section>

      <Section title="Avatar · Media Badge · Format Badge · Glyphs">
        <Row>
          <Avatar name="Claude Devs" handle="ClaudeDevs" />
          <Avatar name="GamesLover with a Preference" handle="tofi_lover0930" />
          <Avatar name="Martin G" handle="TurtlesFatherG" size={28} />
          <Avatar name="Broken photo" handle="broken" src="recolt://mock/avatars/missing.jpg" />
          <div className="relative h-24 w-44 rounded-md bg-[var(--skeleton)]">
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

/** Small visual aid: three header icons to judge the 1.75 stroke. */
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
        <span className="text-nav font-semibold">UI kit gallery</span>
        <span className="text-small text-fg-muted">light and dark, side by side</span>
      </div>
      <div className="flex flex-col lg:flex-row">
        <ThemeBlock theme="light" />
        <ThemeBlock theme="dark" />
      </div>
      <Toaster />
    </div>
  )
}
