import { describe, expect, it } from 'vitest'
import { matchesShortcut, type KeyboardLike } from '../../../src/renderer/src/lib/shortcuts'
import { SHORTCUTS } from '../../../src/shared/shortcuts'

const def = (id: string) => {
  const d = SHORTCUTS.find((s) => s.id === id)
  if (!d) throw new Error(id)
  return d
}
const press = (key: string, code: string, extra: Partial<KeyboardLike> = {}): KeyboardLike => ({
  key,
  code,
  metaKey: true,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  ...extra,
})
const zoom = (e: KeyboardLike): { in: boolean; out: boolean } => ({
  in: matchesShortcut(e, def('zoomIn')),
  out: matchesShortcut(e, def('zoomOut')),
})

describe('zoom ⌘+ / ⌘- (by e.key, no positional fallback)', () => {
  it('QWERTY', () => {
    expect(zoom(press('=', 'Equal'))).toEqual({ in: true, out: false })
    expect(zoom(press('+', 'Equal', { shiftKey: true }))).toEqual({ in: true, out: false })
    expect(zoom(press('-', 'Minus'))).toEqual({ in: false, out: true })
    expect(zoom(press('_', 'Minus', { shiftKey: true }))).toEqual({ in: false, out: true })
  })
  it('AZERTY: ⌘- → zoom out only (the "-" key has code Equal)', () => {
    expect(zoom(press('-', 'Equal'))).toEqual({ in: false, out: true })
  })
  it('AZERTY: ⌘= → zoom in only', () => {
    expect(zoom(press('=', 'Slash'))).toEqual({ in: true, out: false })
  })
  it('AZERTY: ⌘) (code Minus) triggers no zoom', () => {
    expect(zoom(press(')', 'Minus'))).toEqual({ in: false, out: false })
  })
  it('numeric keypad', () => {
    expect(zoom(press('+', 'NumpadAdd'))).toEqual({ in: true, out: false })
    expect(zoom(press('-', 'NumpadSubtract'))).toEqual({ in: false, out: true })
  })
  it('without ⌘: no zoom', () => {
    expect(zoom(press('=', 'Equal', { metaKey: false }))).toEqual({ in: false, out: false })
  })
})
