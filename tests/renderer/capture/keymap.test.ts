import { describe, expect, it } from 'vitest'
import { accelToCaps, eventToAccelerator } from '../../../src/renderer/src/features/capture/keymap'
import { readDrop } from '../../../src/renderer/src/features/import/walk'
import { isWebUrl } from '../../../src/renderer/src/features/import/UrlPopover'

const ev = (
  code: string,
  key: string,
  mods: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>> = {},
) => ({
  code,
  key,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
})

describe('shortcut recorder (positional)', () => {
  it('⇧⌘S QWERTY → CommandOrControl+Shift+S, caps ⌘ ⇧ S', () => {
    const r = eventToAccelerator(
      ev('KeyS', 'S', { meta: true, shift: true }),
      new Map([['KeyS', 's']]),
    )
    expect(r).toEqual({ accel: 'CommandOrControl+Shift+S', label: 'S' })
    expect(accelToCaps('CommandOrControl+Shift+S', 'S')).toEqual(['⌘', '⇧', 'S'])
  })
  it('AZERTY: printed key "A" = KeyQ → accelerator …+Q, key cap "A"', () => {
    const azerty = new Map([
      ['KeyQ', 'a'],
      ['KeyA', 'q'],
    ])
    const r = eventToAccelerator(ev('KeyQ', 'a', { meta: true, shift: true }), azerty)
    expect(r).toEqual({ accel: 'CommandOrControl+Shift+Q', label: 'A' })
    expect(accelToCaps('CommandOrControl+Shift+Q', 'A')).toEqual(['⌘', '⇧', 'A'])
  })
  it('digits and special keys; lone modifier incomplete; punctuation not supported', () => {
    expect(eventToAccelerator(ev('Digit2', 'é', { alt: true, meta: true }))).toEqual({
      accel: 'CommandOrControl+Alt+2',
      label: '2',
    })
    expect(eventToAccelerator(ev('ArrowUp', 'ArrowUp', { ctrl: true }))).toEqual({
      accel: 'Control+Up',
      label: '↑',
    })
    expect(eventToAccelerator(ev('ShiftLeft', 'Shift', { shift: true }))).toEqual({
      error: 'incomplete',
    })
    expect(eventToAccelerator(ev('Semicolon', ';', { meta: true }))).toEqual({
      error: 'unsupported',
    })
  })
})

describe('drop and URL', () => {
  it('paths (files and folders), otherwise http(s) link', () => {
    const files = [{ name: 'a.png' }, { name: 'Dossier' }] as unknown as File[]
    const dt = {
      files,
      getData: () => '',
    } as unknown as DataTransfer
    const paths = readDrop(dt, (f) => `/Users/x/${f.name}`)
    expect(paths).toEqual({ paths: ['/Users/x/a.png', '/Users/x/Dossier'], url: null })
    const link = {
      files: [],
      getData: (t: string) =>
        t === 'text/uri-list' ? '# commentaire\nhttps://exemple.fr/a.jpg' : '',
    } as unknown as DataTransfer
    expect(readDrop(link, () => '')).toEqual({ paths: [], url: 'https://exemple.fr/a.jpg' })
    expect(isWebUrl('https://x.com/a')).toBe(true)
    expect(isWebUrl('ftp://x.com')).toBe(false)
    expect(isWebUrl('pas une url')).toBe(false)
  })
})
