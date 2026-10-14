/** Update state read from main (`updates.getStatus`), then followed through `evt:updates.status`. */
import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../../shared/ipc/updates'
import { rpc, subscribe } from '../../lib/rpc'

export function useUpdateStatus(): [UpdateStatus | null, (s: UpdateStatus) => void] {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    let live = true
    void rpc('updates.getStatus')
      .then((s) => live && setStatus(s))
      .catch(() => undefined)
    const off = subscribe('updates.status', setStatus)
    return () => {
      live = false
      off()
    }
  }, [])
  return [status, setStatus]
}
