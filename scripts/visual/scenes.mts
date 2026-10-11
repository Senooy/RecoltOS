/**
 * Scènes de la boucle de fidélité visuelle (QA §7.2-7.3) : les 13 de départ (une par référence
 * `ref-map.json`) plus celles du lot R / WP-70. Navigation DÉCLARATIVE par `data-testid` (QA §6.2) :
 * une scène dont les composants n'existent pas encore est signalée « indisponible » au lieu d'échouer ;
 * elle devient disponible quand le lot UI correspondant livre ses `data-testid`.
 */
import type { ElectronApplication, Page } from '@playwright/test'

export type Step =
  | { click: string; optional?: boolean }
  /** Clique la première cible présente parmi `clickFirst` (ex. « Dev », sinon la 1re collection). */
  | { clickFirst: string[] }
  | { clickNth: string; nth: number }
  | { rightClick: string }
  | { hover: string }
  | { key: string }
  | { menu: string }
  | { type: string; text: string }
  | { wait: string }
  | { sleep: number }

export interface Scene {
  id: string
  /** Nom de scène dans `ref-map.json` (plusieurs ids peuvent partager une référence). */
  ref: string
  title: string
  steps: Step[]
  /** Fenêtre de test à laisser sans bibliothèque (état vide). */
  empty?: boolean
}

const t = (id: string): string => `[data-testid="${id}"]`
const settings = (section: string): Step[] => [
  { click: t('btn-settings') },
  { wait: t('settings') },
  { click: t(`settings-nav-${section}`) },
]

/** Les 13 scènes de départ. */
export const START_SCENES: Scene[] = [
  {
    id: 'library-all',
    ref: 'library-all',
    title: 'Bibliothèque, onglet Tout',
    steps: [
      { click: t('seg-library'), optional: true },
      { wait: `${t('grid')}, ${t('grid-skeleton')}` },
    ],
  },
  {
    id: 'detail-video',
    ref: 'detail-video',
    title: 'Vue détail d’une vidéo',
    steps: [{ click: `${t('card')}[data-kind="video"]` }, { wait: t('detail') }],
  },
  {
    id: 'palette',
    ref: 'palette',
    title: 'Palette ⌘K',
    steps: [{ menu: 'palette' }, { wait: t('palette') }],
  },
  {
    id: 'collections-shelf',
    ref: 'collections-shelf',
    title: 'Étagère Collections',
    steps: [{ click: t('seg-collections') }, { wait: t('shelf-cover') }, { sleep: 600 }],
  },
  {
    id: 'rediscover',
    ref: 'rediscover',
    title: 'Redécouvrir',
    steps: [{ click: t('btn-rediscover') }, { wait: t('rediscover') }],
  },
  {
    id: 'context-menu',
    ref: 'context-menu',
    title: 'Menu contextuel d’une carte',
    steps: [{ rightClick: t('card') }, { wait: t('ctx-menu') }],
  },
  {
    id: 'collection-dev',
    ref: 'collection-dev',
    title: 'Vue d’une collection',
    steps: [
      { click: t('seg-collections') },
      { wait: t('shelf-cover') },
      { clickFirst: [`${t('shelf-cover')}[data-name="Dev"]`, t('shelf-cover')] },
      { wait: t('grid') },
      { sleep: 400 },
    ],
  },
  {
    id: 'search',
    ref: 'search',
    title: 'Recherche',
    steps: [{ click: t('seg-search') }, { wait: t('search-input') }, { sleep: 300 }],
  },
  {
    id: 'spaces-empty',
    ref: 'spaces-empty',
    title: 'Spaces, état vide',
    empty: true,
    steps: [{ click: t('seg-spaces') }, { wait: t('space-empty-cta') }],
  },
  {
    id: 'settings-modal',
    ref: 'settings-modal',
    title: 'Réglages, coque de la modale',
    steps: [{ click: t('btn-settings') }, { wait: t('settings') }],
  },
  {
    id: 'settings-syncing',
    ref: 'settings-syncing',
    title: 'Réglages › Synchronisation',
    steps: settings('sync'),
  },
  {
    id: 'settings-capture',
    ref: 'settings-capture',
    title: 'Réglages › Capture',
    steps: settings('capture'),
  },
  { id: 'settings-ai', ref: 'settings-ai', title: 'Réglages › IA', steps: settings('ai') },
]

/** Scènes du lot R (QA §7.1) : sans référence tant que WP-0O n'a pas recapturé (`ref` = leur propre nom). */
export const EXTRA_SCENES: Scene[] = [
  {
    id: 'detail-image',
    ref: 'detail-image',
    title: 'Vue détail d’une image',
    steps: [{ click: `${t('card')}[data-kind="image"]` }, { wait: t('detail') }],
  },
  {
    id: 'detail-tweet',
    ref: 'detail-tweet',
    title: 'Vue détail d’un post',
    steps: [{ click: `${t('card')}[data-kind="tweet"]` }, { wait: t('detail') }],
  },
  {
    id: 'search-results',
    ref: 'search-results',
    title: 'Recherche avec résultats',
    steps: [
      { click: t('seg-search') },
      { type: t('search-input'), text: 'instagram' },
      { wait: t('grid') },
      { sleep: 400 },
    ],
  },
  {
    id: 'collection-menu',
    ref: 'collection-menu',
    title: 'Menu « … » d’une collection',
    steps: [
      { click: t('seg-collections') },
      { wait: t('shelf-cover') },
      { click: t('shelf-cover') },
      { click: t('collection-more') },
      { wait: t('collection-menu') },
    ],
  },
  {
    id: 'library-picker',
    ref: 'library-picker',
    title: 'Sélecteur de bibliothèque',
    steps: [{ click: t('library-picker') }, { wait: t('library-picker-menu') }],
  },
  ...['appearance', 'libraries', 'tags', 'storage', 'data', 'about'].map((s): Scene => ({
    id: `settings-${s}`,
    ref: `settings-${s}`,
    title: `Réglages › ${s}`,
    steps: settings(s),
  })),
]

export const ALL_SCENES: Scene[] = [...START_SCENES, ...EXTRA_SCENES]

export interface SceneResult {
  ok: boolean
  reason?: string
}

const STEP_TIMEOUT = 2500

async function waitFor(page: Page, selector: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: STEP_TIMEOUT })
    return true
  } catch {
    return false
  }
}

/** Joue les étapes ; s'arrête à la première cible absente (`ok: false` + raison). */
export async function playScene(
  scene: Scene,
  page: Page,
  app: ElectronApplication,
): Promise<SceneResult> {
  for (const step of scene.steps) {
    if ('click' in step) {
      if (!(await waitFor(page, step.click))) {
        if (step.optional) continue
        return { ok: false, reason: `cible absente : ${step.click}` }
      }
      await page.locator(step.click).first().click()
    } else if ('clickFirst' in step) {
      let done = false
      for (const sel of step.clickFirst) {
        if ((await page.locator(sel).count()) > 0) {
          await page.locator(sel).first().click()
          done = true
          break
        }
      }
      if (!done) return { ok: false, reason: `cible absente : ${step.clickFirst.join(' | ')}` }
    } else if ('clickNth' in step) {
      if (!(await waitFor(page, step.clickNth)))
        return { ok: false, reason: `cible absente : ${step.clickNth}` }
      await page.locator(step.clickNth).nth(step.nth).click()
    } else if ('rightClick' in step) {
      if (!(await waitFor(page, step.rightClick)))
        return { ok: false, reason: `cible absente : ${step.rightClick}` }
      await page.locator(step.rightClick).first().click({ button: 'right' })
    } else if ('hover' in step) {
      if (!(await waitFor(page, step.hover)))
        return { ok: false, reason: `cible absente : ${step.hover}` }
      await page.locator(step.hover).first().hover()
    } else if ('key' in step) {
      await page.keyboard.press(step.key)
    } else if ('menu' in step) {
      // Les accélérateurs de menu ne reçoivent pas les événements CDP synthétiques (QA §12 n°12) :
      // on déclenche l'item de menu par son id.
      const clicked = await app.evaluate(({ Menu }, id) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById(id)
        if (!item) return false
        // MenuItem.click est typé `Function` dans electron.d.ts.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        item.click()
        return true
      }, step.menu)
      if (!clicked) return { ok: false, reason: `élément de menu absent : ${step.menu}` }
    } else if ('type' in step) {
      if (!(await waitFor(page, step.type)))
        return { ok: false, reason: `cible absente : ${step.type}` }
      await page.locator(step.type).first().fill(step.text)
    } else if ('wait' in step) {
      if (!(await waitFor(page, step.wait)))
        return { ok: false, reason: `cible absente : ${step.wait}` }
    } else {
      await page.waitForTimeout(step.sleep)
    }
  }
  return { ok: true }
}

/** Gèle la page avant capture : polices chargées, vidéos figées sur leur poster, curseur hors champ. */
export async function freezePage(page: Page): Promise<void> {
  await page.evaluate('document.fonts.ready.then(() => true)')
  await page.evaluate(
    "document.querySelectorAll('video').forEach((v) => { v.pause(); try { v.currentTime = 0 } catch (e) {} })",
  )
  await page.mouse.move(2, 2)
  await page.waitForTimeout(100)
}

export function selectScenes(
  ids: readonly string[] | undefined,
  all: readonly Scene[] = ALL_SCENES,
): Scene[] {
  if (!ids || ids.length === 0) return [...START_SCENES]
  const out: Scene[] = []
  for (const id of ids) {
    const s = all.find((x) => x.id === id)
    if (!s)
      throw new Error(`scène inconnue : ${id} (disponibles : ${all.map((x) => x.id).join(', ')})`)
    out.push(s)
  }
  return out
}
