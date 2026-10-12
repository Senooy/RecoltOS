/** Test library for the Spaces domain (real database, fixed clock). */
import { libraryPaths } from '../../../src/main/library/paths'
import type { LibraryContext } from '../../../src/main/library/library-context'
import type { SpaceNode } from '../../../src/shared/spaces-schema'
import { defaultNoteStyle } from '../../../src/shared/spaces-defaults'
import { openTestLib, type TestLib } from '../db/helpers'

export interface SpacesLib {
  t: TestLib
  lib: LibraryContext
  cleanup(): void
}

export function makeSpacesLib(): SpacesLib {
  const t = openTestLib()
  const lib: LibraryContext = {
    id: 'ltest',
    name: 'Test',
    root: t.root,
    paths: libraryPaths(t.root),
    db: t.db,
    repos: t.repos,
  }
  return { t, lib, cleanup: () => t.cleanup() }
}

let seq = 0
export function nodeUuid(): string {
  seq++
  return `11111111-2222-4333-8444-${String(seq).padStart(12, '0')}`
}

export function note(over: Partial<Extract<SpaceNode, { type: 'note' }>> = {}): SpaceNode {
  return {
    uuid: nodeUuid(),
    type: 'note',
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    rotation: 0,
    z: 0,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    content: 'bonjour',
    style: defaultNoteStyle(),
    ...over,
  }
}
