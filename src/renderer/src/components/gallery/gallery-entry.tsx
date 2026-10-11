/**
 * Entrée autonome de la galerie (dev) : `/src/components/gallery/index.html` sur le serveur
 * Vite du renderer. Équivalent de `?gallery=1` tant que `App.tsx` n'est pas câblé (voir
 * `docs/contrats/CHANGELOG.md`). Absente du build de production (hors `rollupOptions.input`).
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../styles/tokens.css'
import '../../styles/globals.css'
import Gallery from './Gallery'

const el = document.getElementById('root')
if (!el) throw new Error('#root introuvable')
createRoot(el).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
)
