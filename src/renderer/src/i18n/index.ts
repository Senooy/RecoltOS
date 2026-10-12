/**
 * Active renderer language: `tr` is the current catalog (live ES binding, re-read at each
 * render), `setUiLang` changes it and notifies `useUiLang` (the root remounts the shell with
 * `key={lang}`: all text follows without restart). Formats (`lib/format.ts`) and zod
 * follow the same language (`shared/i18n/lang`).
 *
 * Rule: a text read at module import (module constant) does NOT follow the change;
 * read `tr` in the render or in a function.
 */
import { useSyncExternalStore } from 'react'
import { getLang, onLangChange, setLang, type Lang } from '../../../shared/i18n/lang'
import { en, type Messages } from './en'
import { fr } from './fr'

export type { Messages }

const CATALOGS: Record<Lang, Messages> = { fr, en }

export let tr: Messages = CATALOGS[getLang()]

onLangChange((lang) => {
  tr = CATALOGS[lang]
  if (typeof document !== 'undefined') document.documentElement.lang = lang
})

/** Catalog for a given language (tests, previews). */
export function messagesFor(lang: Lang): Messages {
  return CATALOGS[lang]
}

export function getUiLang(): Lang {
  return getLang()
}

export function setUiLang(lang: Lang): void {
  setLang(lang)
}

/** Active language, reactive (re-renders on change). */
export function useUiLang(): Lang {
  return useSyncExternalStore(onLangChange, getLang, getLang)
}

/**
 * Displayed name of a library: the default library, never renamed ("Bibliothèque"
 * or "Library", depending on the language it was created in), takes the label of the active language.
 */
export function libraryDisplayName(l: { id: string; name: string }): string {
  return l.id === 'default' && (l.name === 'Bibliothèque' || l.name === 'Library')
    ? tr.nav.library
    : l.name
}
