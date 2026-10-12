/**
 * M4 avec les FAUX CLI (`tests/helpers/fake-bin/{claude,codex}`), jamais les vrais :
 * consentement exigé avant tout appel, feuille « Changer », génération sur une image depuis le
 * panneau Détails (description, tags en chips, OCR), aperçu de l'envoi, journal.
 */
import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '../helpers/e2e-fixtures'
import { REPO_ROOT } from '../helpers/paths'

const t = (id: string) => `[data-testid="${id}"]`
const FAKE_CLAUDE = path.join(REPO_ROOT, 'tests/helpers/fake-bin/claude')
const FAKE_CODEX = path.join(REPO_ROOT, 'tests/helpers/fake-bin/codex')

const invoke = (page: Page, channel: string, input: unknown) =>
  page.evaluate(
    ([c, i]) =>
      (
        window as unknown as { recolt: { invoke: (c: string, i: unknown) => Promise<unknown> } }
      ).recolt.invoke(c, i),
    [channel, input] as const,
  ) as Promise<{ ok: boolean; data?: unknown; error?: { code: string } }>

test.describe('IA avec faux CLI', () => {
  test.use({ demoLibrary: { count: 12, collections: 2 } })

  test('consentement, génération, aperçu et journal', async ({ page, openDbReadonly }) => {
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    // Jamais les vrais binaires : chemins forcés vers les faux CLI.
    const set = await invoke(page, 'prefs.set', {
      patch: { ai: { claude: { path: FAKE_CLAUDE }, codex: { path: FAKE_CODEX } } },
    })
    expect(set.ok).toBe(true)
    const db = openDbReadonly()
    const calls = () => (db.prepare('SELECT count(*) AS n FROM ai_calls').get() as { n: number }).n

    // Aucun appel possible sans moteur ni consentement.
    const card = page.locator(`${t('grid')} ${t('card')}[data-kind="image"]`).first()
    const uuid = await card.getAttribute('data-uuid')
    const refused = await invoke(page, 'ai.enqueue', { itemUuids: [uuid], task: 'analyze' })
    expect(refused.ok).toBe(false)
    expect(refused.error?.code).toBe('ai_disabled')

    // Activer un interrupteur sans moteur ouvre la feuille « Changer ».
    await page.locator(t('btn-settings')).click()
    await page.locator(t('settings-nav-ai')).click()
    await page.locator(t('ai-autoname')).click()
    await expect(page.locator(t('ai-sheet'))).toBeVisible()
    await expect(page.locator(t('ai-consent'))).toBeVisible()
    expect(calls()).toBe(0)
    await expect(page.locator(t('ai-choice-claude'))).toContainText('plan Max')
    await page.locator(t('ai-sheet-confirm')).click()
    await expect(page.locator(t('ai-sheet'))).toBeHidden()
    await expect(page.locator(t('ai-engine-title'))).toContainText('Claude')
    await expect(page.locator(t('ai-engine-status'))).toContainText('Connecté · plan Max')
    expect(calls()).toBe(0)
    await page.keyboard.press('Escape')
    await expect(page.locator(t('settings'))).toBeHidden()

    // Génération depuis le panneau Détails.
    await card.click()
    await expect(page.locator(t('details-panel'))).toBeVisible()
    await page.locator(t('detail-ai-generate')).click()
    await expect(page.locator(t('detail-ai-description'))).toHaveText(
      'Description synthétique en français.',
      { timeout: 20_000 },
    )
    await expect(page.locator(t('detail-tag')).filter({ hasText: 'affiche' })).toBeVisible()
    await expect(page.locator(t('detail-name'))).toHaveValue(/./)
    await expect(page.locator(t('detail-ai-via'))).toContainText('Claude')
    const row = db
      .prepare('SELECT provider, outcome, task FROM ai_calls ORDER BY id DESC LIMIT 1')
      .get() as { provider: string; outcome: string; task: string }
    expect(row).toEqual({ provider: 'claude', outcome: 'ok', task: 'analyze' })
    const item = db
      .prepare('SELECT ai_state, ai_lang, ocr_text FROM items WHERE uuid = ?')
      .get(uuid) as { ai_state: string; ai_lang: string; ocr_text: string }
    expect(item).toEqual({ ai_state: 'done', ai_lang: 'fr', ocr_text: 'TEXTE' })
    await page.keyboard.press('Escape')

    // Recherche plein texte sur la description générée.
    const found = (await invoke(page, 'search.query', { q: 'synthétique', limit: 20 })) as {
      ok: boolean
      data: { items: { uuid: string }[] }
    }
    expect(found.data.items.map((i) => i.uuid)).toContain(uuid)

    // Aperçu exact et journal.
    await page.locator(t('btn-settings')).click()
    await page.locator(t('settings-nav-ai')).click()
    await page.locator(t('ai-privacy')).click()
    await expect(page.locator(t('ai-call'))).toHaveCount(1)
    await page.locator(t('ai-preview')).click()
    await expect(page.locator(t('ai-preview-dialog'))).toBeVisible()
    await expect(page.locator(`${t('ai-preview-files')} img`).first()).toBeVisible()
    await expect(page.locator(t('ai-preview-prompt'))).toContainText('Produis l')
    expect(calls()).toBe(1)
  })
})
