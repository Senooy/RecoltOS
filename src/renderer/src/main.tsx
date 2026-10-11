/**
 * Point d'entrée du renderer. Le thème est posé AVANT le premier rendu (couleur de la première
 * image = `backgroundColor` de la fenêtre, PLAN §1.13).
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initApi } from './api/client'
import './styles/tokens.css'
import './styles/globals.css'

const root = document.documentElement
const flags = window.recolt?.flags
root.dataset.theme =
  flags?.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
if (flags?.e2e) root.dataset.e2e = '1'

const el = document.getElementById('root')
if (!el) throw new Error('#root introuvable')
// La maquette (dev) est chargée avant le premier rendu : `getApi()` reste synchrone.
void initApi().then(() => {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
