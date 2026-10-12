/**
 * Scenes for the app screenshots (`pnpm run shots`): 13 default scenes plus extra scenes.
 * DECLARATIVE navigation by `data-testid`: a scene whose components are missing is reported
 * as "unavailable" instead of failing.
 */
import type { ElectronApplication, Page } from '@playwright/test'

export type Step =
  | { click: string; optional?: boolean }
  /** Clicks the first target present among `clickFirst` (e.g. "Dev", otherwise the 1st collection). */
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
  title: string
  steps: Step[]
  /** Test window to leave without a library (empty state). */
  empty?: boolean
}

const t = (id: string): string => `[data-testid="${id}"]`
const settings = (section: string): Step[] => [
  { click: t('btn-settings') },
  { wait: t('settings') },
  { click: t(`settings-nav-${section}`) },
]

/** The 13 default scenes. */
export const START_SCENES: Scene[] = [
  {
    id: 'library-all',
    title: 'Bibliothèque, onglet Tout',
    steps: [
      { click: t('seg-library'), optional: true },
      { wait: `${t('grid')}, ${t('grid-skeleton')}` },
    ],
  },
  {
    id: 'detail-video',
    title: 'Vue détail d’une vidéo',
    steps: [{ click: `${t('card')}[data-kind="video"]` }, { wait: t('detail') }],
  },
  {
    id: 'palette',
    title: 'Palette ⌘K',
    steps: [{ menu: 'palette' }, { wait: t('palette') }],
  },
  {
    id: 'collections-shelf',
    title: 'Étagère Collections',
    steps: [{ click: t('seg-collections') }, { wait: t('shelf-cover') }, { sleep: 600 }],
  },
  {
    id: 'rediscover',
    title: 'Redécouvrir',
    steps: [{ click: t('btn-rediscover') }, { wait: t('rediscover') }],
  },
  {
    id: 'context-menu',
    title: 'Menu contextuel d’une carte',
    steps: [{ rightClick: t('card') }, { wait: t('ctx-menu') }],
  },
  {
    id: 'collection-dev',
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
    title: 'Recherche',
    steps: [{ click: t('seg-search') }, { wait: t('search-input') }, { sleep: 300 }],
  },
  {
    id: 'spaces-empty',
    title: 'Spaces, état vide',
    empty: true,
    steps: [{ click: t('seg-spaces') }, { wait: t('space-empty-cta') }],
  },
  {
    id: 'settings-modal',
    title: 'Réglages, coque de la modale (section Bibliothèques)',
    steps: settings('libraries'),
  },
  {
    id: 'settings-syncing',
    title: 'Réglages › Synchronisation',
    steps: settings('sync'),
  },
  {
    id: 'settings-capture',
    title: 'Réglages › Capture',
    steps: settings('capture'),
  },
  { id: 'settings-ai', title: 'Réglages › IA', steps: settings('ai') },
]

/** Extra scenes (on demand: `--scene a,b`). */
export const EXTRA_SCENES: Scene[] = [
  {
    id: 'detail-image',
    title: 'Vue détail d’une image',
    steps: [{ click: `${t('card')}[data-kind="image"]` }, { wait: t('detail') }],
  },
  {
    id: 'detail-tweet',
    title: 'Vue détail d’un post',
    steps: [{ click: `${t('card')}[data-kind="tweet"]` }, { wait: t('detail') }],
  },
  {
    id: 'search-results',
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
    title: 'Sélecteur de bibliothèque',
    // Grid first: otherwise the menu opens before the screen is mounted (empty background).
    steps: [
      { wait: t('grid') },
      { click: t('library-picker') },
      { wait: t('library-picker-menu') },
    ],
  },
  ...['appearance', 'libraries', 'tags', 'storage', 'data', 'about'].map((s): Scene => ({
    id: `settings-${s}`,
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

/** Plays the steps; stops at the first missing target (`ok: false` + reason). */
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
      // Menu accelerators do not receive synthetic CDP events:
      // so we trigger the menu item by its id.
      const clicked = await app.evaluate(({ Menu }, id) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById(id)
        if (!item) return false
        // MenuItem.click is typed `Function` in electron.d.ts.
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

/** Freezes the page before capture: fonts loaded, videos frozen on their poster, cursor out of frame. */
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
