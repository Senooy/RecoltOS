/**
 * Sous-menu « Ajouter à un space › » du menu contextuel des cartes (SPACES §1.6.2, extension
 * RecoltOS) : liste des spaces + « Nouveau space… ». Les éléments sont posés en grille à droite du
 * contenu du space, sans l'ouvrir (toast « 5 éléments ajoutés à « X » · Ouvrir »).
 */
import { ChartPie, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Menu } from '../../components/ui'
import { fr } from '../../i18n/fr'
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
        <Menu.Context.Label>{fr.spacesUi.noSpaces}</Menu.Context.Label>
      ) : null}
      {(spaces ?? []).map((s) => (
        <Menu.Context.Item
          key={s.uuid}
          data-testid="menu-space"
          data-uuid={s.uuid}
          onSelect={() => void addItemsToSpace(s, uuids)}
        >
          {s.name || fr.spaces.untitled}
        </Menu.Context.Item>
      ))}
      <Menu.Context.Item icon={<Plus />} onSelect={() => void addItemsToNewSpace(uuids)}>
        {fr.spacesUi.newSpaceEllipsis}
      </Menu.Context.Item>
    </Menu.Context.SubContent>
  )
}

export function AddToSpaceSub({ uuids }: { uuids: string[] }) {
  return (
    <Menu.Context.Sub>
      <Menu.Context.SubTrigger icon={<ChartPie />} data-testid="menu-add-to-space">
        {fr.spacesUi.addToSpace}
      </Menu.Context.SubTrigger>
      <SpacesList uuids={uuids} />
    </Menu.Context.Sub>
  )
}
