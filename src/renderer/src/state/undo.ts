/**
 * Pile d'annulation de l'app (DESIGN §3.13, ERRATA §C) : corbeille, masquer, collections,
 * renommage, Rediscover. Les champs texte gardent l'annulation native (`system.edit`).
 */
import { create } from 'zustand'

export const UNDO_LIMIT = 50

export interface UndoEntry {
  label: string
  undo(): void | Promise<void>
  redo?: () => void | Promise<void>
}

export interface UndoState {
  past: UndoEntry[]
  future: UndoEntry[]
  push(entry: UndoEntry): void
  undo(): Promise<UndoEntry | null>
  redo(): Promise<UndoEntry | null>
  clear(): void
}

export const useUndo = create<UndoState>()((set, get) => ({
  past: [],
  future: [],
  push: (entry) => set((s) => ({ past: [...s.past, entry].slice(-UNDO_LIMIT), future: [] })),
  async undo() {
    const entry = get().past.at(-1)
    if (!entry) return null
    set((s) => ({ past: s.past.slice(0, -1) }))
    await entry.undo()
    if (entry.redo) set((s) => ({ future: [...s.future, entry] }))
    return entry
  },
  async redo() {
    const entry = get().future.at(-1)
    if (!entry?.redo) return null
    set((s) => ({ future: s.future.slice(0, -1) }))
    await entry.redo()
    set((s) => ({ past: [...s.past, entry].slice(-UNDO_LIMIT) }))
    return entry
  },
  clear: () => set({ past: [], future: [] }),
}))
