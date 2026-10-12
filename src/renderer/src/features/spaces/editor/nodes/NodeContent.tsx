/** Content of a node according to its type (shared by the editor, the list thumbnail and the stage). */
import type { ItemCard } from '../../../../../../shared/dto/items'
import type { SpaceNode } from '../../../../../../shared/spaces-schema'
import { ImageNodeView, ItemNodeView } from './MediaNodes'
import { NoteNodeView, ShapeNodeView, TextNodeView } from './TextNodes'

export function NodeContent({
  node,
  card,
  editing,
  screenScale,
  videoActive,
}: {
  node: SpaceNode
  card: ItemCard | undefined
  editing: boolean
  screenScale: number
  videoActive: boolean
}) {
  switch (node.type) {
    case 'item':
      return (
        <ItemNodeView node={node} card={card} screenScale={screenScale} videoActive={videoActive} />
      )
    case 'image':
      return <ImageNodeView node={node} screenScale={screenScale} videoActive={videoActive} />
    case 'note':
      return <NoteNodeView node={node} editing={editing} />
    case 'shape':
      return <ShapeNodeView node={node} editing={editing} />
    case 'text':
      return <TextNodeView node={node} editing={editing} />
  }
}
