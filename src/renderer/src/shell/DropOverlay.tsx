/**
 * Calque de dépôt : SEUL gestionnaire `drop` de la fenêtre. Fichiers et dossiers
 * venus de l'extérieur → `ingest.files` (chemins via `recolt.pathForFile`, dossiers parcourus par
 * main), lien d'un navigateur → `ingest.url` ; rapport « N ajoutés · M doublons · 0 échec ».
 * Ignoré pendant un glisser interne (`ui.internalDrag`) et dans l'éditeur d'espace.
 */
import { Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from '../components/ui'
import { fr } from '../i18n/fr'
import { RpcError } from '../lib/rpc'
import { useUi } from '../state/ui'
import { importPaths, importUrl, reportImport } from '../features/import/import-actions'
import { isExternalDrag, readDrop } from '../features/import/walk'

function hasFiles(e: DragEvent): boolean {
  return (
    isExternalDrag(Array.from(e.dataTransfer?.types ?? [])) &&
    useUi.getState().route.name !== 'space'
  )
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
      const drop = readDrop(e.dataTransfer, (f) => window.recolt?.pathForFile(f) ?? '')
      const col = collectionRef.current
      if (drop.paths.length > 0) void importPaths(drop.paths, col?.uuid)
      else if (drop.url)
        void importUrl(drop.url, col?.uuid)
          .then(reportImport)
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
