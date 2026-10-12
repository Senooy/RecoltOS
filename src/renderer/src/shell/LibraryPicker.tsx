/**
 * `LibraryPicker` : logo 28 px à `left: 18`, nom de la bibliothèque (ellipse à
 * 160 px), menu de 260 px : une ligne par bibliothèque (coche sur l'active), « Nouvelle
 * bibliothèque… », « Gérer les bibliothèques… ».
 */
import { Check, ChevronsUpDown, FolderCog, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { RecoltLogo } from '../components/icons'
import { Menu, toast } from '../components/ui'
import { libraryDisplayName, tr } from '../i18n'
import { isNotImplemented, rpc, RpcError, subscribe } from '../lib/rpc'
import { askName } from '../state/dialogs'
import { useUi } from '../state/ui'

interface LibInfo {
  id: string
  name: string
  path: string | null
  itemCount: number
}

export function useLibraries() {
  const [state, setState] = useState<{ active: string | null; libraries: LibInfo[] }>({
    active: null,
    libraries: [],
  })
  useEffect(() => {
    const load = () =>
      void rpc('libraries.list')
        .then((r) => setState({ active: r.active, libraries: r.libraries }))
        .catch((err: unknown) => {
          if (!isNotImplemented(err)) console.warn('[libraries] lecture impossible', err)
        })
    load()
    const offs = [
      subscribe('library.switched', load),
      subscribe('items.changed', (p) => {
        if (p.reason === 'created' || p.reason === 'purged') load()
      }),
    ]
    return () => offs.forEach((o) => o())
  }, [])
  return state
}

export function LibraryPicker() {
  const { active, libraries } = useLibraries()
  const current = libraries.find((l) => l.id === active)
  const openOverlay = useUi((s) => s.openOverlay)
  const create = async () => {
    const name = await askName({
      title: tr.shell.newLibraryTitle,
      initial: tr.shell.newLibraryDefault,
      confirmLabel: tr.shell.create,
    })
    if (!name?.trim()) return
    try {
      await rpc('libraries.create', { name: name.trim() })
    } catch (err) {
      toast(err instanceof RpcError ? err.message : tr.errors.generic)
    }
  }
  return (
    <Menu.Dropdown.Root>
      <Menu.Dropdown.Trigger asChild>
        <button
          type="button"
          data-testid="library-picker"
          className="app-no-drag absolute left-[14px] top-[37px] flex h-9 items-center gap-[14px] rounded-lg px-1 hover:bg-[var(--hover)]"
        >
          <RecoltLogo size={28} />
          <span className="flex items-center gap-2 text-nav font-semibold tracking-[-0.01em]">
            <span className="max-w-[160px] truncate">
              {current ? libraryDisplayName(current) : tr.nav.library}
            </span>
            <ChevronsUpDown size={14} className="text-fg-subtle" />
          </span>
        </button>
      </Menu.Dropdown.Trigger>
      <Menu.Dropdown.Content data-testid="library-picker-menu" align="start" className="w-[260px]">
        {libraries.map((l) => (
          <Menu.Dropdown.Item
            key={l.id}
            icon={<RecoltLogo size={20} />}
            onSelect={() => {
              if (l.id !== active)
                void rpc('libraries.switch', { id: l.id }).catch((e: unknown) =>
                  toast(e instanceof RpcError ? e.message : tr.errors.generic),
                )
            }}
          >
            <span className="flex w-full items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{libraryDisplayName(l)}</span>
              <span className="text-caption text-fg-faint tnum">{l.itemCount}</span>
              {l.id === active ? (
                <Check size={14} className="text-fg" />
              ) : (
                <span className="w-[14px]" />
              )}
            </span>
          </Menu.Dropdown.Item>
        ))}
        <Menu.Dropdown.Separator />
        <Menu.Dropdown.Item icon={<Plus />} onSelect={() => void create()}>
          {tr.libraryPicker.newLibrary}
        </Menu.Dropdown.Item>
        <Menu.Dropdown.Item
          icon={<FolderCog />}
          onSelect={() => openOverlay({ type: 'settings', section: 'libraries' })}
        >
          {tr.libraryPicker.manage}
        </Menu.Dropdown.Item>
      </Menu.Dropdown.Content>
    </Menu.Dropdown.Root>
  )
}
