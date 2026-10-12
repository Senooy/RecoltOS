/**
 * Entrée des fenêtres hors écran (`offscreen.html?render=<route>`, ERRATA §B) : sans preload,
 * jamais `window.recolt`. Routes : `tweet-card` (WP-56), `space-stage` (WP-63). Stub WP-00.
 */
// Avant tout schéma zod : pas de `new Function` sous la CSP (voir le module).
import './lib/zod-jitless'
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/globals.css'
import { TweetCardRender } from './features/sync/TweetCardRender'

const params = new URLSearchParams(window.location.search)
const route = params.get('render') ?? ''
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'

const StageRoot = lazy(() => import('./features/spaces/stage/StageRoot'))

function OffscreenStub() {
  return <div data-render={route} data-ready="1" />
}

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      {route === 'tweet-card' ? (
        <TweetCardRender data={params.get('data')} />
      ) : route === 'space-stage' ? (
        <Suspense fallback={null}>
          <StageRoot />
        </Suspense>
      ) : (
        <OffscreenStub />
      )}
    </StrictMode>,
  )
}
