/**
 * Langue active du renderer : `tr` est le catalogue courant (liaison ES vivante, relue à chaque
 * rendu), `setUiLang` le change et notifie `useUiLang` (la racine remonte la coque avec
 * `key={lang}` : tout le texte suit sans redémarrage). Les formats (`lib/format.ts`) et zod
 * suivent la même langue (`shared/i18n/lang`).
 *
 * Règle : un texte lu à l'import d'un module (constante de module) ne suit PAS le changement ;
 * lire `tr` dans le rendu ou dans une fonction.
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

/** Catalogue d'une langue donnée (tests, aperçus). */
export function messagesFor(lang: Lang): Messages {
  return CATALOGS[lang]
}

export function getUiLang(): Lang {
  return getLang()
}

export function setUiLang(lang: Lang): void {
  setLang(lang)
}

/** Langue active, réactive (re-rendu au changement). */
export function useUiLang(): Lang {
  return useSyncExternalStore(onLangChange, getLang, getLang)
}

/**
 * Nom affiché d'une bibliothèque : la bibliothèque par défaut jamais renommée (« Bibliothèque »
 * ou « Library », selon la langue de sa création) prend le libellé de la langue active.
 */
export function libraryDisplayName(l: { id: string; name: string }): string {
  return l.id === 'default' && (l.name === 'Bibliothèque' || l.name === 'Library')
    ? tr.nav.library
    : l.name
}
