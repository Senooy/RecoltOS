import './_setup'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import Gallery from '../../../src/renderer/src/components/gallery/Gallery'
import { Toaster, toast } from '../../../src/renderer/src/components/ui/Toaster'

const COMPONENTS_DIR = resolve(process.cwd(), 'src/renderer/src/components')

/** Palette Tailwind par défaut (désactivée par `--color-*: initial`) : interdite, tokens seulement. */
const PALETTE_CLASS =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|shadow|accent|caret|decoration|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
const HEX_CLASS = /\b(?:bg|text|border|fill|stroke|ring|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/
const FOCUS_VARIANT = /(?:^|[\s"'`:])(?:group-|peer-)?focus:/

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const sources = walk(COMPONENTS_DIR).filter((f) => /\.(tsx?|css)$/.test(f))

describe('galerie : tokens uniquement', () => {
  it('rend chaque composant en clair et en sombre', () => {
    const { container } = render(<Gallery />)
    expect(container.querySelector('[data-gallery-theme="light"]')).toBeTruthy()
    expect(container.querySelector('[data-gallery-theme="dark"]')).toBeTruthy()
    for (const theme of ['light', 'dark']) {
      const block = container.querySelector(`[data-gallery-theme="${theme}"]`) as HTMLElement
      expect(block.getAttribute('data-theme')).toBe(theme)
      // un représentant de chaque famille de composants
      expect(block.querySelector('[role="switch"]')).toBeTruthy()
      expect(block.querySelector('[role="slider"]')).toBeTruthy()
      expect(block.querySelector('[role="radiogroup"]')).toBeTruthy()
      expect(block.querySelector('[role="status"]')).toBeTruthy()
      expect(block.querySelector('kbd')).toBeTruthy()
      expect(block.querySelector('[data-avatar]')).toBeTruthy()
      expect(block.querySelector('[data-format="MP4"]')).toBeTruthy()
      expect(block.querySelector('svg')).toBeTruthy()
    }
  })

  it('aucune classe de palette Tailwind (bg-gray = 0) ni couleur hexadécimale dans le DOM rendu', () => {
    const { container } = render(<Gallery />)
    const classes = [...container.querySelectorAll('[class]')]
      .map((e) => e.getAttribute('class') ?? '')
      .join(' ')
    expect(classes.length).toBeGreaterThan(1000)
    expect(PALETTE_CLASS.test(classes)).toBe(false)
    expect(/\bbg-gray/.test(classes)).toBe(false)
    expect(HEX_CLASS.test(classes)).toBe(false)
  })

  it('aucune classe de palette, hex ou variant `focus:` dans les sources des composants', () => {
    expect(sources.length).toBeGreaterThan(20)
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      expect(PALETTE_CLASS.test(text), `${file} : classe de palette`).toBe(false)
      expect(/\bbg-gray/.test(text), `${file} : bg-gray`).toBe(false)
      expect(HEX_CLASS.test(text), `${file} : couleur hex en classe`).toBe(false)
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        expect(FOCUS_VARIANT.test(text), `${file} : variant focus:`).toBe(false)
      }
    }
  })

  it('tous les boutons sans texte ont un aria-label FR non vide ; tout slider est nommé', () => {
    const { container } = render(<Gallery />)
    const iconOnly = [...container.querySelectorAll('button')].filter(
      (b) => (b.textContent ?? '').trim() === '',
    )
    expect(iconOnly.length).toBeGreaterThan(5)
    for (const b of iconOnly) {
      expect((b.getAttribute('aria-label') ?? '').trim(), b.outerHTML.slice(0, 120)).not.toBe('')
    }
    for (const s of container.querySelectorAll('[role="slider"]')) {
      expect((s.getAttribute('aria-label') ?? '').trim()).not.toBe('')
    }
    // Aucun nom accessible en anglais courant dans les contrôles d'icône.
    const names = iconOnly.map((b) => b.getAttribute('aria-label') ?? '')
    expect(names.join('|')).not.toMatch(/\b(Close|Settings|Delete|Search)\b/)
  })
})

describe('Toaster : pilule §2.7', () => {
  it('affiche un toast avec action « Annuler »', async () => {
    render(<Toaster />)
    act(() => {
      toast('Ajouté à Gaming', { action: { label: 'Annuler', onClick: () => undefined } })
    })
    const text = await screen.findByText('Ajouté à Gaming')
    const pill = text.closest('[data-sonner-toast]') as HTMLElement
    expect(pill.className).toContain('h-10')
    expect(pill.className).toContain('rounded-full')
    expect(pill.className).toContain('bg-surface')
    const action = screen.getByRole('button', { name: 'Annuler' })
    expect(action.className).toContain('bg-accent')
    fireEvent.click(action)
  })
})
