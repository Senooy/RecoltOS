/**
 * Dialogues de confirmation et de saisie (window.prompt / confirm n'existent pas dans Electron) :
 * `askConfirm` et `askName` renvoient une promesse ; `shell/Dialogs.tsx` les affiche.
 */
import { create } from 'zustand'

export interface ConfirmRequest {
  kind: 'confirm'
  title: string
  body?: string
  confirmLabel: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

export interface NameRequest {
  kind: 'name'
  title: string
  initial: string
  confirmLabel: string
  resolve: (name: string | null) => void
}

interface DialogsState {
  current: ConfirmRequest | NameRequest | null
  set: (r: ConfirmRequest | NameRequest | null) => void
}

export const useDialogs = create<DialogsState>()((set) => ({
  current: null,
  set: (current) => set({ current }),
}))

export function askConfirm(r: Omit<ConfirmRequest, 'kind' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useDialogs.getState().set({ kind: 'confirm', ...r, resolve }))
}

export function askName(r: Omit<NameRequest, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => useDialogs.getState().set({ kind: 'name', ...r, resolve }))
}
