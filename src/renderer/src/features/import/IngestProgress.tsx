/**
 * Progress of an import (`evt:ingest.progress`) in a bottom-centre pill,
 * shown beyond 3 files, hidden at the end.
 */
import { useEffect, useState } from 'react'
import { PILL_CLASS } from '../../components/ui'
import { tr } from '../../i18n'
import { cn } from '../../lib/cn'
import { subscribe } from '../../lib/rpc'

export function IngestProgress() {
  const [p, setP] = useState<{ done: number; total: number } | null>(null)
  useEffect(
    () =>
      subscribe('ingest.progress', ({ done, total, current }) => {
        if (current === null || done >= total || total <= 3) setP(null)
        else setP({ done, total })
      }),
    [],
  )
  if (!p) return null
  return (
    <div
      data-testid="ingest-progress"
      role="status"
      className={cn(PILL_CLASS, 'fixed bottom-6 left-1/2 z-40 -translate-x-1/2 px-4 text-[13px]')}
    >
      {tr.importUiMore.progress(p.done, p.total)}
    </div>
  )
}
