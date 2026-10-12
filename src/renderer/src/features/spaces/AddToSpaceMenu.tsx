/**
 * "Add to a space ›" submenu of the cards' context menu (RecoltOS extension): list of spaces +
 * "New space…". Items are placed in a grid to the right of the space's content, without opening
 * it (toast "5 items added to “X” · Open").
 */
import { ChartPie, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Menu } from '../../components/ui'
import { tr } from '../../i18n'
import { rpc } from '../../lib/rpc'
import { addItemsToNewSpace, addItemsToSpace } from './space-actions'

function SpacesList({ uuids }: { uuids: string[] }) {
  const [spaces, setSpaces] = useState<{ uuid: string; name: string }[] | null>(null)
  useEffect(() => {
    let alive = true
    void rpc('spaces.list')
      .then((l) => alive && setSpaces(l.map((s) => ({ uuid: s.uuid, name: s.name }))))
      .catch(() => alive && setSpaces([]))
    return () => {
      alive = false
    }
  }, [])
  return (
    <Menu.Context.SubContent className="max-h-[360px] overflow-y-auto" data-testid="menu-spaces">
      {spaces && spaces.length === 0 ? (
        <Menu.Context.Label>{tr.spacesUi.noSpaces}</Menu.Context.Label>
      ) : null}
      {(spaces ?? []).map((s) => (
        <Menu.Context.Item
          key={s.uuid}
          data-testid="menu-space"
          data-uuid={s.uuid}
          onSelect={() => void addItemsToSpace(s, uuids)}
        >
          {s.name || tr.spaces.untitled}
        </Menu.Context.Item>
      ))}
      <Menu.Context.Item icon={<Plus />} onSelect={() => void addItemsToNewSpace(uuids)}>
        {tr.spacesUi.newSpaceEllipsis}
      </Menu.Context.Item>
    </Menu.Context.SubContent>
  )
}

export function AddToSpaceSub({ uuids }: { uuids: string[] }) {
  return (
    <Menu.Context.Sub>
      <Menu.Context.SubTrigger icon={<ChartPie />} data-testid="menu-add-to-space">
        {tr.spacesUi.addToSpace}
      </Menu.Context.SubTrigger>
      <SpacesList uuids={uuids} />
    </Menu.Context.Sub>
  )
}
