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

describe('zoom ⌘+ / ⌘- (par e.key, sans repli positionnel)', () => {
  it('QWERTY', () => {
    expect(zoom(press('=', 'Equal'))).toEqual({ in: true, out: false })
    expect(zoom(press('+', 'Equal', { shiftKey: true }))).toEqual({ in: true, out: false })
    expect(zoom(press('-', 'Minus'))).toEqual({ in: false, out: true })
    expect(zoom(press('_', 'Minus', { shiftKey: true }))).toEqual({ in: false, out: true })
  })
  it('AZERTY : ⌘- → zoom arrière seul (la touche « - » a code Equal)', () => {
    expect(zoom(press('-', 'Equal'))).toEqual({ in: false, out: true })
  })
  it('AZERTY : ⌘= → zoom avant seul', () => {
    expect(zoom(press('=', 'Slash'))).toEqual({ in: true, out: false })
  })
  it('AZERTY : ⌘) (code Minus) ne déclenche aucun zoom', () => {
    expect(zoom(press(')', 'Minus'))).toEqual({ in: false, out: false })
  })
  it('pavé numérique', () => {
    expect(zoom(press('+', 'NumpadAdd'))).toEqual({ in: true, out: false })
    expect(zoom(press('-', 'NumpadSubtract'))).toEqual({ in: false, out: true })
  })
  it('sans ⌘ : aucun zoom', () => {
    expect(zoom(press('=', 'Equal', { metaKey: false }))).toEqual({ in: false, out: false })
  })
})
