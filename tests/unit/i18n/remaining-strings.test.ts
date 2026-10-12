/**
 * Texts that used to be hard-coded in French: Spaces history labels, colour-filter names, Trash
 * messages. Each one follows the interface language.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mt } from '../../../src/main/i18n'
import { moveToTrash } from '../../../src/main/platform/trash'
import { colorLabel } from '../../../src/renderer/src/features/search/filters'
import { messagesFor, tr } from '../../../src/renderer/src/i18n'
import { NAMED_COLORS } from '../../../src/shared/color'
import { setLang } from '../../../src/shared/i18n/lang'

afterEach(() => setLang('fr'))

describe('Spaces history labels', () => {
  it('French and English, with counts', () => {
    const fr = messagesFor('fr').spacesUi
    const en = messagesFor('en').spacesUi
    expect([fr.move, fr.resize, fr.rotate]).toEqual(['Déplacer', 'Redimensionner', 'Pivoter'])
    expect([en.move, en.resize, en.rotate]).toEqual(['Move', 'Resize', 'Rotate'])
    expect(fr.addImages(3)).toBe('Ajouter 3 images')
    expect(en.addImages(1)).toBe('Add 1 image')
    expect(en.addNodes(2)).toBe('Add 2 items')
  })
})

describe('colour filter names', () => {
  it('every swatch has a name in both languages; the label follows the language', () => {
    for (const lang of ['fr', 'en'] as const) {
      for (const c of NAMED_COLORS) expect(messagesFor(lang).colorUi.names[c.id]).toBeTruthy()
    }
    const blue = NAMED_COLORS.find((c) => c.id === 'bleu')!.hex
    expect(colorLabel(blue)).toBe('Bleu')
    setLang('en')
    expect(tr.colorUi.names.bleu).toBe('Blue')
    expect(colorLabel(blue)).toBe('Blue')
    expect(colorLabel('#123456')).toBe('#123456')
  })
})

describe('Trash messages', () => {
  it('follow the interface language', async () => {
    const run = () => moveToTrash(['relative/path'])
    expect((await run()).failed[0]!.message).toBe(mt('fr').errors.trashAbsolutePath)
    setLang('en')
    expect((await run()).failed[0]!.message).toBe('absolute path expected')
  })
})
