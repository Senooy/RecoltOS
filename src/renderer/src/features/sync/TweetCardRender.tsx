/**
 * Off-screen route `tweet-card`: the `TweetCard light` card of the grid, 480 px CSS rendered
 * at ×2 (960 px), for the main file of posts without media. Data: `?data=<ItemCard base64url>`.
 * Signals `body[data-ready=1]` when fonts and images are loaded.
 */
import { useEffect } from 'react'
import type { ItemCard } from '../../../../shared/dto/items'
import { TweetCard } from '../grid/cards/TweetCard'

function decode(data: string | null): ItemCard | null {
  if (!data) return null
  try {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as ItemCard
  } catch {
    return null
  }
}

export function TweetCardRender({ data }: { data: string | null }) {
  const card = decode(data)
  useEffect(() => {
    const imgs = [...document.images].map((i) =>
      i.complete
        ? Promise.resolve()
        : new Promise<void>((r) => {
            i.addEventListener('load', () => r(), { once: true })
            i.addEventListener('error', () => r(), { once: true })
          }),
    )
    void Promise.all([document.fonts.ready, ...imgs]).then(() => {
      requestAnimationFrame(() => {
        document.body.dataset.ready = '1'
      })
    })
  }, [])
  if (!card) return <div data-card-root="" />
  return (
    <div data-card-root="" style={{ width: 480, zoom: 2, background: 'var(--bg)' }}>
      <TweetCard card={card} variant="light" />
    </div>
  )
}
