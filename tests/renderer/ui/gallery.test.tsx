// @vitest-environment happy-dom
import './_setup'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import Gallery from '../../../src/renderer/src/components/gallery/Gallery'
import { isGalleryRequested } from '../../../src/renderer/src/components/gallery/request'
import { Toaster, toast } from '../../../src/renderer/src/components/ui/Toaster'

const COMPONENTS_DIR = resolve(process.cwd(), 'src/renderer/src/components')

/** Default Tailwind palette (disabled by `--color-*: initial`): forbidden, tokens only. */
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

describe('gallery: tokens only', () => {
  it('renders each component in light and dark', () => {
    const { container } = render(<Gallery />)
    expect(container.querySelector('[data-gallery-theme="light"]')).toBeTruthy()
    expect(container.querySelector('[data-gallery-theme="dark"]')).toBeTruthy()
    for (const theme of ['light', 'dark']) {
      const block = container.querySelector(`[data-gallery-theme="${theme}"]`) as HTMLElement
      expect(block.getAttribute('data-theme')).toBe(theme)
      // one representative of each component family
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

  it('no Tailwind palette class (bg-gray = 0) nor hex colour in the rendered DOM', () => {
    const { container } = render(<Gallery />)
    const classes = [...container.querySelectorAll('[class]')]
      .map((e) => e.getAttribute('class') ?? '')
      .join(' ')
    expect(classes.length).toBeGreaterThan(1000)
    expect(PALETTE_CLASS.test(classes)).toBe(false)
    expect(/\bbg-gray/.test(classes)).toBe(false)
    expect(HEX_CLASS.test(classes)).toBe(false)
  })

  it('no palette class, hex or `focus:` variant in the component sources', () => {
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

  it('no inline style in hex colour (tokens only)', () => {
    const { container } = render(<Gallery />)
    const inline = [...container.querySelectorAll('[style]')].map(
      (e) => e.getAttribute('style') ?? '',
    )
    expect(inline.length).toBeGreaterThan(0)
    expect(inline.filter((st) => /#[0-9a-fA-F]{3,8}\b/.test(st))).toEqual([])
    const gallerySource = readFileSync(resolve(COMPONENTS_DIR, 'gallery/Gallery.tsx'), 'utf8')
    expect(/#[0-9a-fA-F]{3,8}\b/.test(gallerySource)).toBe(false)
  })

  it('all buttons without text have a non-empty French aria-label; every slider is named', () => {
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
    // No common English accessible name in the icon controls.
    const names = iconOnly.map((b) => b.getAttribute('aria-label') ?? '')
    expect(names.join('|')).not.toMatch(/\b(Close|Settings|Delete|Search)\b/)
  })
})

describe('Toaster: pill', () => {
  it('shows a toast with the "Annuler" action', async () => {
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

describe('isGalleryRequested: ?gallery=1 in development only', () => {
  it('true only with ?gallery=1 in dev', () => {
    expect(isGalleryRequested('?gallery=1', true)).toBe(true)
    expect(isGalleryRequested('?foo=1&gallery=1', true)).toBe(true)
  })
  it('false in production, even with ?gallery=1', () => {
    expect(isGalleryRequested('?gallery=1', false)).toBe(false)
  })
  it('false without parameter, with another value or without the parameter', () => {
    expect(isGalleryRequested('', true)).toBe(false)
    expect(isGalleryRequested('?gallery=0', true)).toBe(false)
    expect(isGalleryRequested('?gallery=true', true)).toBe(false)
    expect(isGalleryRequested('?other=1', true)).toBe(false)
  })
})
