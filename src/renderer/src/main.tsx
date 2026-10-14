/**
 * Renderer entry point. The theme is set BEFORE the first render (colour of the first
 * frame = window `backgroundColor`).
 */
// Before any zod schema: no `new Function` under the CSP (see the module).
import './lib/zod-jitless'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initApi } from './api/client'
import { setUiLang } from './i18n'
import { installVideoGuard } from './lib/video-guard'
import { routes } from './shell/routes'
import { useUi } from './state/ui'
import './styles/tokens.css'
import './styles/globals.css'

const root = document.documentElement
const flags = window.recolt?.flags
root.dataset.theme =
  flags?.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
if (flags?.e2e) root.dataset.e2e = '1'

installVideoGuard()

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')
// The mock (dev) is loaded before the first render: `getApi()` stays synchronous. The initial
// screen is loaded at the same time: it renders without suspending (see `shell/routes.tsx`).
void Promise.all([initApi(), routes[useUi.getState().route.name].preload()]).then(() => {
  // Language resolved by main (setting or Mac language): first render in the right language.
  const lang = window.recolt?.flags.lang
  if (lang) setUiLang(lang)
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
