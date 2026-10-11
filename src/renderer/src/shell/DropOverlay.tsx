/**
 * Calque de dépôt (DESIGN §2.8) : SEUL gestionnaire `drop` de la fenêtre. Fichiers venus de
 * l'extérieur → `ingest.files` (chemins via `recolt.pathForFile`) ; ignoré pendant un glisser
 * interne (`ui.internalDrag`) ou si tous les chemins sont déjà dans la bibliothèque (main les ignore).
 */
import { Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from '../components/ui'
import { fr } from '../i18n/fr'
import { RpcError, rpc } from '../lib/rpc'
import { useUi } from '../state/ui'

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

export function DropOverlay({ collection }: { collection: { uuid: string; name: string } | null }) {
  const [visible, setVisible] = useState(false)
  const depth = useRef(0)
  const collectionRef = useRef(collection)
  collectionRef.current = collection
  useEffect(() => {
    const external = (e: DragEvent) => hasFiles(e) && !useUi.getState().internalDrag
    const onEnter = (e: DragEvent) => {
      if (!external(e)) return
      depth.current++
      setVisible(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!external(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setVisible(false)
    }
    const onOver = (e: DragEvent) => {
      if (!external(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent) => {
      depth.current = 0
      setVisible(false)
      if (!external(e)) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? [])
      const paths = files
        .map((f) => window.recolt?.pathForFile(f) ?? '')
        .filter((p) => p.startsWith('/'))
      if (paths.length === 0) return
      const col = collectionRef.current
      void rpc('ingest.files', { paths, ...(col ? { collectionUuid: col.uuid } : {}) })
        .then((r) => {
          if (r.added.length > 0) toast(fr.toast.importDone(r.added.length))
          else if (r.failed.length > 0) toast(r.failed[0]!.message)
        })
        .catch((err: unknown) => toast(err instanceof RpcError ? err.message : fr.errors.generic))
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])
  if (!visible) return null
  return (
    <div
      data-testid="drop-overlay"
      className="overlay pointer-events-none fixed inset-0 z-[70] flex items-center justify-center"
      style={{ background: 'color-mix(in srgb, var(--bg) 85%, transparent)' }}
    >
      <div className="absolute inset-3 rounded-2xl border-2 border-dashed border-[var(--fg-subtle)]" />
      <div className="relative flex flex-col items-center gap-2 text-center">
        <Upload size={28} strokeWidth={1.75} />
        <div className="text-[16px] font-medium">{fr.drop.title}</div>
        {collection ? (
          <div className="text-small text-fg-muted">{fr.drop.alsoIn(collection.name)}</div>
        ) : null}
      </div>
    </div>
  )
}
