/**
 * Standalone gallery entry (dev): `/src/components/gallery/index.html` on the renderer's
 * Vite server. Equivalent of `?gallery=1` without going through `App.tsx`.
 * Absent from the production build (outside `rollupOptions.input`).
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
