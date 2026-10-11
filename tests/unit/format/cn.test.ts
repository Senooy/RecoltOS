import { describe, expect, it } from 'vitest'
import { TEXT_SIZES, cn } from '../../../src/renderer/src/lib/cn'

describe('cn() : tailwind-merge étendu aux tailles de texte', () => {
  it('conserve une taille ET une couleur', () => {
    expect(cn('text-caption', 'text-fg-faint')).toBe('text-caption text-fg-faint')
  })

  it('une taille remplace une autre taille', () => {
    expect(cn('text-ui', 'text-caption')).toBe('text-caption')
  })

  it('une couleur remplace une autre couleur', () => {
    expect(cn('text-fg', 'text-fg-muted')).toBe('text-fg-muted')
  })

  it.each(TEXT_SIZES)('text-%s n’est pas pris pour une couleur', (size) => {
    expect(cn(`text-${size}`, 'text-fg-subtle')).toBe(`text-${size} text-fg-subtle`)
    expect(cn('text-fg-subtle', `text-${size}`)).toBe(`text-fg-subtle text-${size}`)
  })

  it('gère les valeurs conditionnelles de clsx', () => {
    const off = false as boolean
    expect(cn('px-2', off && 'px-4', undefined, ['py-1', { 'font-medium': true }])).toBe(
      'px-2 py-1 font-medium',
    )
  })
})
