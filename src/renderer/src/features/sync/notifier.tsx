/**
 * Sync pills: "3 new X favorites" when a sync adds items,
 * "N older posts retrieved · Review" after a backfill (batch review).
 * Wired once at the root (`App.tsx`); nothing on the first state received (no replay at launch).
 */
import { createRoot, type Root } from 'react-dom/client'
import type { SyncStatus } from '../../../../shared/dto/sync'
import { toast } from '../../components/ui'
import { tr } from '../../i18n'
import { subscribe } from '../../lib/rpc'
import { RecoveredDialog } from './SyncDialogs'

let reviewRoot: Root | null = null

export function openRecoveredReview(): void {
  const host = document.createElement('div')
  document.body.appendChild(host)
  reviewRoot?.unmount()
  const root = createRoot(host)
  reviewRoot = root
  root.render(
    <RecoveredDialog
      onClose={() => {
        root.unmount()
        host.remove()
        if (reviewRoot === root) reviewRoot = null
      }}
    />,
  )
}

export function syncNotices(
  prev: SyncStatus | null,
  next: SyncStatus,
): { text: string; review: boolean }[] {
  if (!prev) return []
  const out: { text: string; review: boolean }[] = []
  for (const s of next.sources) {
    const before = prev.sources.find((x) => x.source === s.source)
    if (!before) continue
    if (s.lastSuccessAt && s.lastSuccessAt !== before.lastSuccessAt && s.lastNewCount > 0) {
      out.push({
        text: tr.syncUi.toast.newItems(s.lastNewCount, s.source),
        review: false,
      })
    }
  }
  const rec = (st: SyncStatus) => st.sources.reduce((n, s) => n + s.recovered, 0)
  const r = rec(next)
  if (r > rec(prev) && next.sources.every((s) => !s.running)) {
    out.push({ text: tr.syncUi.toast.recovered(r), review: true })
  }
  return out
}

export function installSyncNotifier(): () => void {
  let prev: SyncStatus | null = null
  return subscribe('sync.status', (next) => {
    for (const n of syncNotices(prev, next)) {
      if (n.review) {
        toast(n.text, { action: { label: tr.syncUi.toast.review, onClick: openRecoveredReview } })
      } else toast(n.text)
    }
    prev = next
  })
}
