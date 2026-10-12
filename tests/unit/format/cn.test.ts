import { describe, expect, it } from 'vitest'
import { TEXT_SIZES, cn } from '../../../src/renderer/src/lib/cn'

describe('cn(): tailwind-merge extended to text sizes', () => {
  it('keeps a size AND a color', () => {
    expect(cn('text-caption', 'text-fg-faint')).toBe('text-caption text-fg-faint')
  })

  it('a size replaces another size', () => {
    expect(cn('text-ui', 'text-caption')).toBe('text-caption')
  })

  it('a color replaces another color', () => {
    expect(cn('text-fg', 'text-fg-muted')).toBe('text-fg-muted')
  })

  it.each(TEXT_SIZES)('text-%s is not taken for a color', (size) => {
    expect(cn(`text-${size}`, 'text-fg-subtle')).toBe(`text-${size} text-fg-subtle`)
    expect(cn('text-fg-subtle', `text-${size}`)).toBe(`text-fg-subtle text-${size}`)
  })

  it('handles clsx conditional values', () => {
    const off = false as boolean
    expect(cn('px-2', off && 'px-4', undefined, ['py-1', { 'font-medium': true }])).toBe(
      'px-2 py-1 font-medium',
    )
  })
})
