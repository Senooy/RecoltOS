/**
 * M5 (WP-56/57) : Réglages › Synchronisation et sync de bout en bout CÔTÉ APP, avec un FAUX hôte
 * natif branché sur le socket de l'app (`RECOLTOS_BRIDGE=1`) qui rejoue les fixtures synthétiques :
 * activation (feuille de risques), `sync.run` → pages → `sync.ack`, ingestion, ligne d'état, carte de
 * post rendue en WebP 960 px, pilule « nouveaux favoris ». Aucun réseau, aucun compte.
 */
import { readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { socketPath } from '../../src/main/bridge/paths'
import { EXTENSION_ORIGIN, EXTENSION_VERSION } from '../../src/shared/bridge/constants'
import { expect, test } from '../helpers/e2e-fixtures'
import { REPO_ROOT } from '../helpers/paths'

const t = (id: string) => `[data-testid="${id}"]`
const fx = (p: string) =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'tests/fixtures/sync', p), 'utf8')) as unknown
const id = () => globalThis.crypto.randomUUID()

type Msg = { v: 1; id: string; re?: string; type: string; payload?: Record<string, unknown> }

/** Faux hôte : parle NDJSON au socket de l'app comme `recolt-host` le ferait. */
class FakeHost {
  sock: net.Socket
  got: Msg[] = []
  private acc = ''
  constructor(socket: string) {
    this.sock = net.createConnection(socket)
    this.sock.setEncoding('utf8')
    this.sock.on('data', (d: string) => {
      this.acc += d
      for (let i = this.acc.indexOf('\n'); i >= 0; i = this.acc.indexOf('\n')) {
        this.got.push(JSON.parse(this.acc.slice(0, i)) as Msg)
        this.acc = this.acc.slice(i + 1)
      }
    })
  }
  send(type: string, payload: unknown, re?: string): string {
    const m = { v: 1, id: id(), type, ts: Date.now(), payload, ...(re ? { re } : {}) }
    this.sock.write(`${JSON.stringify(m)}\n`)
    return m.id
  }
  async waitFor(pred: (m: Msg) => boolean, ms = 10_000): Promise<Msg> {
    const t0 = Date.now()
    for (;;) {
      const hit = this.got.find(pred)
      if (hit) return hit
      if (Date.now() - t0 > ms) throw new Error('délai dépassé')
      await new Promise((r) => setTimeout(r, 25))
    }
  }
}

const invoke = (page: Page, channel: string, input: unknown) =>
  page.evaluate(
    ([c, i]) =>
      (
        window as unknown as { recolt: { invoke: (c: string, i: unknown) => Promise<unknown> } }
      ).recolt.invoke(c, i),
    [channel, input] as const,
  ) as Promise<{ ok: boolean; data?: unknown }>

test.describe('synchronisation (faux hôte)', () => {
  test.use({ appLaunch: { env: { RECOLTOS_BRIDGE: '1' } } })

  test('Réglages › Synchronisation, activation, run de 2 pages, ingestion et carte de post', async ({
    page,
    userData,
    openDbReadonly,
  }) => {
    // Aucun téléchargement réel des médias synthétiques.
    expect(
      (await invoke(page, 'prefs.set', { patch: { storage: { downloadRemoteMedia: false } } })).ok,
    ).toBe(true)

    await page.locator(t('btn-settings')).click()
    await page.locator(t('settings-nav-sync')).click()
    await expect(page.locator(t('sync-settings'))).toBeVisible()
    await expect(page.locator(t('sync-row-x'))).toContainText('Synchroniser les signets X')
    await expect(page.locator(t('sync-line-x'))).toHaveText('Désactivé')
    await expect(page.locator(t('sync-ext-state'))).toContainText('Non détectée')

    // L'« extension » se connecte (Firefox, sessions X et Cosmos présentes).
    const host = new FakeHost(socketPath(userData))
    await new Promise<void>((r) => host.sock.once('connect', () => r()))
    host.send('host.hello', {
      protocol: 1,
      browser: 'firefox',
      origin: EXTENSION_ORIGIN,
      hostVersion: '1.0.0',
      pid: 1,
    })
    const helloId = host.send('hello', {
      extVersion: EXTENSION_VERSION,
      protocol: 1,
      target: 'firefox',
      browser: { name: 'Firefox', version: '157.0.1' },
      profileId: null,
      platforms: {
        x: { loggedIn: true, accountId: '42', permission: true },
        instagram: { loggedIn: false, permission: true },
        cosmos: { loggedIn: true, permission: true },
      },
      openTabs: { x: 0, instagram: 0, cosmos: 0 },
    })
    const ack = await host.waitFor((m) => m.type === 'hello.ack' && m.re === helloId)
    expect(ack.payload).toMatchObject({ protocol: 1, needsReload: false })
    await expect(page.locator(t('sync-ext-state'))).toContainText('Connectée — Firefox')

    // Première activation : feuille de risques, option onglet DÉCOCHÉE.
    await page.locator(t('sync-switch-x')).click()
    await expect(page.locator(t('sync-activate'))).toBeVisible()
    await expect(page.locator(t('sync-activate-tab'))).not.toBeChecked()
    await page.locator(t('sync-activate-confirm')).click()
    const run = await host.waitFor((m) => m.type === 'sync.run')
    expect(run.payload).toMatchObject({
      platform: 'x',
      mode: 'backfill',
      trigger: 'toggle',
      allowBackgroundTab: false,
    })
    const runId = run.payload!.runId as string

    const p1 = host.send('sync.page', {
      runId,
      platform: 'x',
      pageIndex: 0,
      origin: 'replay',
      status: 200,
      json: fx('x/curseur-page1.json'),
      target: 'background',
    })
    const a1 = await host.waitFor((m) => m.type === 'sync.ack' && m.re === p1)
    expect(a1.payload).toMatchObject({ decision: 'continue', nextCursor: 'Q1VSU09SLXBhZ2Uy' })
    const p2 = host.send('sync.page', {
      runId,
      platform: 'x',
      pageIndex: 1,
      origin: 'replay',
      status: 200,
      json: fx('x/curseur-fin.json'),
      target: 'background',
    })
    const a2 = await host.waitFor((m) => m.type === 'sync.ack' && m.re === p2)
    expect(a2.payload).toMatchObject({ decision: 'stop', outcome: 'ok' })
    host.send('sync.finished', { runId, status: 'ok', pages: 2, target: 'background' })

    await expect(page.locator(t('sync-line-x'))).toContainText('20 nouveaux')
    const db = openDbReadonly()
    expect(
      (
        db
          .prepare("SELECT count(*) AS n FROM items WHERE source = 'x' AND origin = 'sync'")
          .get() as { n: number }
      ).n,
    ).toBe(20)
    await expect
      .poll(
        () =>
          (
            db.prepare('SELECT target FROM sync_runs WHERE id = ?').get(runId) as
              { target: string } | undefined
          )?.target,
      )
      .toBe('background')

    // Posts texte : carte rendue (WebP 960 px, rôle render).
    await expect
      .poll(
        () =>
          (
            db
              .prepare("SELECT count(*) AS n FROM item_media WHERE role = 'render' AND width = 960")
              .get() as { n: number }
          ).n,
        { timeout: 30_000 },
      )
      .toBe(5)

    // Journal : cible arrière-plan.
    await page.locator(t('sync-row-x')).hover()
    await page.locator(t('sync-more-x')).click()
    await page.getByRole('menuitem', { name: 'Voir le journal' }).click()
    await expect(page.locator(t('sync-journal'))).toContainText('arrière-plan')
    await page.screenshot({ path: path.join(REPO_ROOT, '.tmp/m5-shots/journal.png') })
    await page.keyboard.press('Escape')
    await expect(page.locator(t('sync-journal'))).toBeHidden()
    await page.screenshot({
      path: path.join(REPO_ROOT, '.tmp/m5-shots/reglages-synchronisation.png'),
    })
    host.sock.end()
  })
})
