/**
 * Réglages › Tags (DESIGN §3.10) : filtre, liste (`#` + nom renommable en ligne + compteur + menu
 * Renommer / Fusionner avec… / Supprimer), « Nouveau tag ».
 */
import { Ellipsis, GitMerge, Pencil, Plus, Trash } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TagInfo } from '../../../../../shared/dto/collections'
import { Button, Menu, toast } from '../../../components/ui'
import { fr } from '../../../i18n/fr'
import { RpcError, rpc, subscribe } from '../../../lib/rpc'
import { askConfirm, askName } from '../../../state/dialogs'
import { SettingsTitle } from '../SettingsDialog'

function fail(err: unknown) {
  toast(err instanceof RpcError ? err.message : fr.errors.generic)
}

function TagRow({
  tag,
  others,
  onChanged,
}: {
  tag: TagInfo
  others: readonly TagInfo[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(tag.name)
  useEffect(() => setDraft(tag.name), [tag.name])
  const commit = async () => {
    setEditing(false)
    const name = draft.trim()
    if (!name || name === tag.name) {
      setDraft(tag.name)
      return
    }
    try {
      await rpc('tags.rename', { uuid: tag.uuid, name })
      onChanged()
    } catch (err) {
      setDraft(tag.name)
      fail(err)
    }
  }
  const merge = async (target: TagInfo) => {
    try {
      await rpc('tags.merge', { sourceUuids: [tag.uuid], targetUuid: target.uuid })
      toast(fr.settingsMoreUi.tagMergeDone(target.name))
      onChanged()
    } catch (err) {
      fail(err)
    }
  }
  const remove = async () => {
    const ok = await askConfirm({
      title: fr.settingsMoreUi.tagDeleteTitle(tag.name),
      body: fr.settingsMoreUi.tagDeleteBody,
      confirmLabel: fr.confirm.delete,
      danger: true,
    })
    if (!ok) return
    try {
      await rpc('tags.delete', { uuid: tag.uuid })
      onChanged()
    } catch (err) {
      fail(err)
    }
  }
  return (
    <div
      data-testid="settings-tag-row"
      className="flex h-11 items-center gap-2 border-b border-[#ececec] dark:border-border-subtle"
    >
      <span className="text-fg-disabled">#</span>
      {editing ? (
        <input
          autoFocus
          data-testid="settings-tag-input"
          className="h-7 min-w-0 flex-1 rounded-[6px] bg-[var(--hover)] px-1.5 text-[14.5px] outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') void commit()
            if (e.key === 'Escape') {
              setDraft(tag.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-[14.5px] text-fg"
          onClick={() => setEditing(true)}
        >
          {tag.name}
        </button>
      )}
      <span className="text-[12.5px] text-[#959595] tnum">
        {fr.settingsMoreUi.tagCount(tag.count)}
      </span>
      <Menu.Dropdown.Root>
        <Menu.Dropdown.Trigger asChild>
          <button
            type="button"
            aria-label={fr.settingsMoreUi.tagActions(tag.name)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-[var(--hover)]"
          >
            <Ellipsis size={16} />
          </button>
        </Menu.Dropdown.Trigger>
        <Menu.Dropdown.Content align="end">
          <Menu.Dropdown.Item icon={<Pencil />} onSelect={() => setEditing(true)}>
            {fr.settings.tags.rename}
          </Menu.Dropdown.Item>
          {others.length > 0 ? (
            <Menu.Dropdown.Sub>
              <Menu.Dropdown.SubTrigger icon={<GitMerge />}>
                {fr.settings.tags.merge}
              </Menu.Dropdown.SubTrigger>
              <Menu.Dropdown.SubContent className="max-h-[300px] overflow-y-auto">
                {others.map((o) => (
                  <Menu.Dropdown.Item key={o.uuid} onSelect={() => void merge(o)}>
                    #{o.name}
                  </Menu.Dropdown.Item>
                ))}
              </Menu.Dropdown.SubContent>
            </Menu.Dropdown.Sub>
          ) : null}
          <Menu.Dropdown.Item tone="danger" icon={<Trash />} onSelect={() => void remove()}>
            {fr.settings.tags.delete}
          </Menu.Dropdown.Item>
        </Menu.Dropdown.Content>
      </Menu.Dropdown.Root>
    </div>
  )
}

export function TagsSection() {
  const [tags, setTags] = useState<TagInfo[]>([])
  const [filter, setFilter] = useState('')
  const load = useCallback(() => {
    void rpc('tags.list')
      .then((r) => setTags(r.tags))
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    load()
    const offs = [subscribe('items.changed', load), subscribe('library.switched', load)]
    return () => offs.forEach((o) => o())
  }, [load])
  const q = filter.trim().toLowerCase()
  const shown = useMemo(
    () => (q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags),
    [tags, q],
  )
  const create = async () => {
    const name = await askName({
      title: fr.settingsMoreUi.tagNewTitle,
      initial: '',
      confirmLabel: fr.shell.create,
    })
    if (!name) return
    try {
      const t = await rpc('tags.create', { name })
      toast(fr.settingsMoreUi.tagCreated(t.name))
      load()
    } catch (err) {
      fail(err)
    }
  }
  return (
    <>
      <SettingsTitle description={fr.settingsMoreUi.tagsDesc}>{fr.settings.nav.tags}</SettingsTitle>
      <div className="mt-5 flex items-center gap-2">
        <input
          data-testid="settings-tags-filter"
          className="h-[34px] min-w-0 flex-1 rounded-[10px] border border-[#e9e9e9] bg-bg px-3 text-ui outline-none focus:border-border-strong dark:border-border"
          placeholder={fr.settings.tags.filter}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Button
          variant="secondary"
          icon={<Plus size={15} />}
          data-testid="settings-tag-new"
          onClick={() => void create()}
        >
          {fr.settings.tags.new}
        </Button>
      </div>
      <div className="mt-3">
        {shown.map((t) => (
          <TagRow
            key={t.uuid}
            tag={t}
            others={tags.filter((o) => o.uuid !== t.uuid)}
            onChanged={load}
          />
        ))}
        {shown.length === 0 ? (
          <p className="py-6 text-center text-small text-fg-faint">
            {tags.length === 0 ? fr.settingsMoreUi.tagsEmpty : fr.settingsMoreUi.tagsNoMatch}
          </p>
        ) : null}
      </div>
    </>
  )
}
