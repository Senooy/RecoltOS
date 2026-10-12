/**
 * Entry of the off-screen windows (`offscreen.html?render=<route>`): no preload,
 * never `window.recolt`. Routes: `tweet-card`, `space-stage`. Language: `lang` parameter.
 */
// Before any zod schema: no `new Function` under the CSP (see the module).
import './lib/zod-jitless'
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/globals.css'
import { TweetCardRender } from './features/sync/TweetCardRender'
import { setUiLang } from './i18n'

const params = new URLSearchParams(window.location.search)
const route = params.get('render') ?? ''
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'
// App language passed by main (`offscreenUrl`): text of the cards and exports.
setUiLang(params.get('lang') === 'en' ? 'en' : 'fr')

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
