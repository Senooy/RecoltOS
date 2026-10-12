/**
 * M7 (7, 10, 12) : PARCOURS COMPLET et SÉCURITÉ, en un seul lancement.
 *
 * Bibliothèque : clone APFS (`cp -c`) de la vraie bibliothèque importée `.tmp/m7-real` (sinon
 * `.tmp/m3-real`, ou `RECOLTOS_E2E_REAL=<dossier>`), jamais un dossier de données vivant
 * (`~/Library/Application Support/…`) ; à défaut, bibliothèque de démo (60 éléments). Le clone
 * reçoit avant lancement : `storage.downloadRemoteMedia = false`, faux CLI `claude` / `codex`
 * (`tests/helpers/fake-bin`, aussi en tête du PATH), capture sans masquage de l'app.
 *
 * Parcours : lancement, grille, 5 onglets, menu contextuel (Masquer puis ⌘Z), étagère et vue
 * Collection, Recherche, ⌘K (menu), vue détail image / vidéo (lecture et seek) / post / carrousel
 * (⌥→), Redécouvrir, Réglages (9 sections), menus de l'app (tous les ids présents, entrées sans
 * dialogue cliquées), capture (faux `screencapture`), import par glisser (fichiers réels avec chemin),
 * sync X (faux hôte natif sur le socket de l'app), Spaces (création, note, élément, export PNG),
 * IA (faux CLI uniquement).
 *
 * Sécurité, mesurée sur tout le parcours :
 *  - 0 requête externe : `webRequest.onBeforeRequest` posé depuis le test sur la session par défaut
 *    et sur toute session créée ensuite (partitions hors écran) ; est « externe » tout ce qui n'est
 *    ni `file:`, `recolt:`, `data:`, `blob:`, `devtools:`, `chrome:`, `about:`, ni la boucle locale ;
 *    renderer (webContentsId connu) ET main (net.fetch) ;
 *  - 0 violation CSP : la fixture d'erreurs console (y compris celles retenues avant la pose des
 *    écouteurs) et un compteur `securitypolicyviolation` injecté avant chaque chargement ;
 *  - après fermeture : aucun `ct0=`, `sessionid=`, `Bearer <jeton>`, ni jeton d'extension GatherOS
 *    dans les fichiers texte de l'app (journaux, prefs, host.json, extension recopiée, spaces) ni
 *    dans les lignes de la base (tables lues par SQLite, WAL compris) ; les manifests
 *    `co.gatheros.host.json` plantés dans le HOME de test sont intacts (octet pour octet).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { socketPath } from '../../src/main/bridge/paths'
import { EXTENSION_ORIGIN, EXTENSION_VERSION } from '../../src/shared/bridge/constants'
import { MENU_COMMANDS } from '../../src/shared/shortcuts'
import { libraryDbPath, openDbReadonly, type TestDb } from '../helpers/db'
import { makeDemoLibrary } from '../helpers/demo-library'
import { launchApp, type AppHandle } from '../helpers/electron-app'
import { REPO_ROOT } from '../helpers/paths'
import { makeImage } from '../helpers/synthetic-media'
import { makeTmpDir, removeTmpDir } from '../helpers/tmpdir'

const t = (id: string) => `[data-testid="${id}"]`
const FAKE_BIN = path.join(REPO_ROOT, 'tests/helpers/fake-bin')
const fx = (p: string) =>
  JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tests/fixtures/sync', p), 'utf8')) as unknown

/** Littéral assemblé (clé du jeton de l'ancienne app, jamais recopiée par l'import). */
const GATHEROS_TOKEN = 'extension' + 'Token'
const SECRET_RE = new RegExp(`ct0=|sessionid=|Bearer [A-Za-z0-9]|${GATHEROS_TOKEN}`)

function realSource(): string | null {
  const candidates = [
    process.env.RECOLTOS_E2E_REAL,
    path.join(REPO_ROOT, '.tmp/m7-real'),
    path.join(REPO_ROOT, '.tmp/m3-real'),
  ]
  for (const c of candidates) {
    if (!c) continue
    // Jamais la bibliothèque GatherOS ni le dossier réel de l'app.
    if (/GatherOS|Application Support\/RecoltOS/.test(c)) continue
    if (fs.existsSync(path.join(c, 'libraries/default/recolt.db'))) return c
  }
  return null
}

type Json = Record<string, unknown>
const asObj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})

/** Prefs du clone : aucun média distant, faux CLI, capture sans masquage de l'app. */
function patchPrefs(userData: string, dropFolder: string): void {
  const file = path.join(userData, 'prefs.json')
  const prefs = fs.existsSync(file) ? asObj(JSON.parse(fs.readFileSync(file, 'utf8'))) : {}
  const ai = asObj(prefs.ai)
  prefs.storage = { ...asObj(prefs.storage), downloadRemoteMedia: false }
  prefs.ai = {
    ...ai,
    provider: 'off',
    claude: { ...asObj(ai.claude), path: path.join(FAKE_BIN, 'claude') },
    codex: { ...asObj(ai.codex), path: path.join(FAKE_BIN, 'codex') },
  }
  prefs.capture = { ...asObj(prefs.capture), dropFolder, hideApp: false, notify: false }
  fs.writeFileSync(file, `${JSON.stringify(prefs, null, 2)}\n`)
}

const sha = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')

const invoke = <T = unknown>(page: Page, channel: string, input?: unknown) =>
  page.evaluate(
    ([c, i]) =>
      (
        window as unknown as { recolt: { invoke: (c: string, i: unknown) => Promise<unknown> } }
      ).recolt.invoke(c, i),
    [channel, input] as const,
  ) as Promise<{ ok: boolean; data: T; error?: { code: string; message: string } }>

async function clickMenu(app: ElectronApplication, id: string): Promise<boolean> {
  return app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    if (!item) return false
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    item.click()
    return true
  }, id)
}

interface NetHit {
  url: string
  wc: number | null
  partition: string
}

/** Pose le compteur de requêtes dans main (session par défaut + sessions créées ensuite). */
async function installNetProbe(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp, session }) => {
    const g = globalThis as unknown as { __recoltNet?: NetHit[] }
    g.__recoltNet = []
    const local = /^(file|recolt|data|blob|devtools|chrome|chrome-extension|about):/i
    const loopback = /^(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//i
    const hook = (ses: Electron.Session, partition: string) => {
      ses.webRequest.onBeforeRequest((details, cb) => {
        if (!local.test(details.url) && !loopback.test(details.url)) {
          g.__recoltNet!.push({ url: details.url, wc: details.webContentsId ?? null, partition })
        }
        cb({})
      })
    }
    hook(session.defaultSession, 'default')
    electronApp.on('session-created', (ses) => hook(ses, 'créée'))
  })
}

const netHits = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __recoltNet?: NetHit[] }).__recoltNet ?? [])

/** Compteur `securitypolicyviolation`, posé avant tout script de la page (puis rechargement). */
async function installCspProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp?: string[] }
    w.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp!.push(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}:${e.columnNumber} ${location.href} ${e.sample}`,
      )
    })
  })
}
const cspHits = (page: Page) =>
  page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? null)

/** Fichiers texte de l'app (sans octet NUL dans les 8 premiers Ko), hors dossiers de médias. */
function textFiles(dir: string, skip: Set<string>, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) {
      if (!skip.has(e.name)) textFiles(p, skip, out)
      continue
    }
    if (/\.(db|db-wal|db-shm|png|jpe?g|webp|gif|mp4|mov|webm|avif|heic|ico|woff2?)$/i.test(e.name))
      continue
    const fd = fs.openSync(p, 'r')
    const head = Buffer.alloc(8192)
    const n = fs.readSync(fd, head, 0, head.length, 0)
    fs.closeSync(fd)
    if (head.subarray(0, n).includes(0)) continue
    out.push(p)
  }
  return out
}

/** Lignes de la base contenant un secret (`table: extrait`). */
function secretsInDb(db: TestDb): string[] {
  const hits: string[] = []
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]
  for (const { name } of tables) {
    for (const row of db.prepare(`SELECT * FROM "${name}"`).iterate() as Iterable<Json>) {
      for (const v of Object.values(row)) {
        if (typeof v === 'string' && SECRET_RE.test(v)) {
          hits.push(`${name}: ${v.slice(0, 80)}`)
        }
      }
    }
  }
  return hits
}

/** Faux hôte natif : NDJSON sur le socket de l'app, comme `recolt-host`. */
class FakeHost {
  sock: net.Socket
  got: { type: string; re?: string; payload?: Json }[] = []
  private acc = ''
  constructor(socket: string) {
    this.sock = net.createConnection(socket)
    this.sock.setEncoding('utf8')
    this.sock.on('data', (d: string) => {
      this.acc += d
      for (let i = this.acc.indexOf('\n'); i >= 0; i = this.acc.indexOf('\n')) {
        this.got.push(JSON.parse(this.acc.slice(0, i)) as { type: string })
        this.acc = this.acc.slice(i + 1)
      }
    })
  }
  send(type: string, payload: unknown, re?: string): string {
    const id = globalThis.crypto.randomUUID()
    const m = { v: 1, id, type, ts: Date.now(), payload, ...(re ? { re } : {}) }
    this.sock.write(`${JSON.stringify(m)}\n`)
    return id
  }
  async waitFor(pred: (m: { type: string; re?: string }) => boolean, ms = 15_000) {
    const t0 = Date.now()
    for (;;) {
      const hit = this.got.find(pred)
      if (hit) return hit
      if (Date.now() - t0 > ms) throw new Error('faux hôte : délai dépassé')
      await new Promise((r) => setTimeout(r, 25))
    }
  }
}

interface Card {
  uuid: string
  kind: string
  mediaCount: number
}

test.describe('parcours complet et sécurité', () => {
  test('parcours de bout en bout, 0 requête externe, 0 secret', async () => {
    test.setTimeout(240_000)
    const src = realSource()
    const root = makeTmpDir('parcours')
    const userData = path.join(root, 'ud')
    const home = path.join(root, 'home')
    const drop = path.join(root, 'depot')
    const files = path.join(root, 'fichiers')
    fs.mkdirSync(drop, { recursive: true })
    fs.mkdirSync(files, { recursive: true })
    if (src) {
      // Clone APFS : quasi instantané, aucun octet de la source n'est modifié.
      execFileSync('cp', ['-c', '-R', src, userData])
      for (const f of ['window-state.json', 'host.json'])
        fs.rmSync(path.join(userData, f), { force: true })
    } else {
      fs.mkdirSync(userData, { recursive: true })
      await makeDemoLibrary(userData, { count: 60, collections: 6 })
    }
    patchPrefs(userData, drop)

    // Manifests GatherOS plantés dans le HOME de test : ils doivent rester intacts.
    const support = path.join(home, 'Library/Application Support')
    const decoys = ['Mozilla/NativeMessagingHosts', 'Google/Chrome/NativeMessagingHosts'].map(
      (d) => {
        const f = path.join(support, d, 'co.gatheros.host.json')
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f, `${JSON.stringify({ name: 'co.gatheros.host', path: '/x' })}\n`)
        return { f, sum: sha(f) }
      },
    )

    let h: AppHandle | null = null
    let host: FakeHost | null = null
    try {
      h = await launchApp({
        userData,
        home,
        env: {
          RECOLTOS_BRIDGE: '1',
          RECOLTOS_SCREENCAPTURE_BIN: path.join(FAKE_BIN, 'screencapture'),
          RECOLTOS_SCREEN_ACCESS: 'granted',
          FAKE_SCREENCAPTURE_SALT: `parcours-${Date.now()}`,
          PATH: `${FAKE_BIN}:${process.env.PATH ?? ''}`,
        },
      })
      const { app } = h
      let page = h.page
      await installNetProbe(app)
      await installCspProbe(page)
      // Rechargement : le compteur CSP et la sonde réseau voient le chargement complet.
      await page.reload()
      page = app.windows().find((w) => !w.isClosed()) ?? page
      const db = openDbReadonly(libraryDbPath(userData))
      const count = (sql: string, ...args: unknown[]) =>
        (db.prepare(sql).get(...args) as { n: number }).n

      await test.step('lancement et grille', async () => {
        expect(await app.evaluate(({ app: a }) => a.getName())).toBe('RecoltOS')
        expect(await app.evaluate(({ app: a }) => a.getPath('userData'))).toBe(userData)
        const cards = page.locator(`${t('grid')} ${t('card')}`)
        await expect(cards.first()).toBeVisible({ timeout: 20_000 })
        const total = count(
          'SELECT count(*) n FROM items WHERE deleted_at IS NULL AND hidden_at IS NULL',
        )
        // Fenêtrage : bien moins de nœuds que d'éléments sur une vraie bibliothèque.
        if (total > 200) expect(await cards.count()).toBeLessThan(total / 2)
        await expect
          .poll(() =>
            page.evaluate(() =>
              Array.from(document.querySelectorAll<HTMLImageElement>('[data-testid="grid"] img'))
                .filter((i) => i.getBoundingClientRect().top < window.innerHeight && i.complete)
                .every((i) => i.naturalWidth > 0),
            ),
          )
          .toBe(true)
        // Aucune URL http(s) dans le DOM des médias (DTO sans URL distante).
        const remote = await page.evaluate(() =>
          Array.from(document.querySelectorAll('img, video, source'))
            .map((e) => e.getAttribute('src') ?? '')
            .filter((s) => /^https?:/i.test(s)),
        )
        expect(remote).toEqual([])
      })

      await test.step('onglets de la Bibliothèque', async () => {
        const counts = (await invoke<Record<string, number>>(page, 'items.counts', {})).data
        for (const tab of ['saved', 'unsorted', 'trash', 'hidden', 'all'] as const) {
          await page.locator(t(`tab-${tab}`)).click()
          await expect(page.locator(t(`tab-${tab}`))).toHaveAttribute('aria-selected', 'true')
          const cards = page.locator(`${t('grid')} ${t('card')}`)
          if ((counts[tab] ?? 0) > 0) await expect(cards.first()).toBeVisible()
          else await expect(cards).toHaveCount(0)
        }
      })

      await test.step('menu contextuel : Masquer puis ⌘Z', async () => {
        const card = page.locator(`${t('grid')} ${t('card')}[data-kind="image"]`).first()
        const uuid = await card.getAttribute('data-uuid')
        await card.click({ button: 'right' })
        await expect(page.locator(t('ctx-menu'))).toBeVisible()
        await page.getByRole('menuitem', { name: 'Masquer de la bibliothèque' }).click()
        const hidden = () =>
          (
            db.prepare('SELECT hidden_at h FROM items WHERE uuid = ?').get(uuid) as {
              h: number | null
            }
          ).h
        await expect.poll(hidden).not.toBeNull()
        expect(await clickMenu(app, 'undo')).toBe(true)
        await expect.poll(hidden).toBeNull()
      })

      await test.step('étagère et vue Collection', async () => {
        await page.locator(t('seg-collections')).click()
        await expect(page.locator(t('shelf'))).toBeVisible()
        await page.locator(t('shelf-cover')).first().click()
        await expect(page.locator(t('collection-title'))).toBeVisible()
        await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
        await page.locator(t('collection-back')).click()
        await expect(page.locator(t('shelf'))).toBeVisible()
        await page.locator(t('seg-library')).click()
      })

      await test.step('Recherche', async () => {
        await page.locator(t('seg-search')).click()
        const input = page.locator(t('search-input'))
        await expect(input).toBeVisible()
        await input.fill('a')
        await expect(page.locator(`${t('search-results')} ${t('card')}`).first()).toBeVisible()
        await input.fill('zzqxwv-introuvable')
        await expect(page.locator(`${t('search-results')} ${t('card')}`)).toHaveCount(0)
        await page.locator(t('seg-library')).click()
      })

      await test.step('palette ⌘K (menu)', async () => {
        expect(await clickMenu(app, 'palette')).toBe(true)
        await expect(page.locator(t('palette'))).toBeVisible()
        await page.locator(t('palette-input')).fill('>')
        await expect(page.locator(t('palette-command')).first()).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.locator(t('palette'))).toHaveCount(0)
      })

      await test.step('vue détail : image, vidéo (seek), post, carrousel', async () => {
        const byUuid = new Map<string, Card>()
        let cursor: string | null = null
        do {
          const r: { ok: boolean; data: { items: Card[]; nextCursor: string | null } } =
            await invoke(page, 'items.list', {
              scope: 'library',
              tab: 'all',
              limit: 200,
              ...(cursor ? { cursor } : {}),
            })
          expect(r.ok).toBe(true)
          for (const c of r.data.items) byUuid.set(c.uuid, c)
          cursor = r.data.nextCursor
        } while (cursor)
        const want = new Set(['image', 'video', 'tweet', 'carousel'])
        await page
          .locator(`${t('grid')} ${t('card')}`)
          .first()
          .click()
        const detail = page.locator(t('detail'))
        await expect(detail).toBeVisible()
        for (let step = 0; step < 150 && want.size > 0; step++) {
          const uuid = (await detail.getAttribute('data-uuid')) ?? ''
          const card = byUuid.get(uuid)
          if (card && want.has(card.kind)) {
            want.delete(card.kind)
            if (card.kind === 'image') await expect(page.locator(t('viewer-media'))).toBeVisible()
            if (card.kind === 'video') {
              const video = page.locator(`${t('viewer-video')} video, video${t('viewer-video')}`)
              await expect(video.first()).toBeVisible()
              // Lecture et seek : le protocole `recolt:` sert les plages (Range).
              const seeked = await video.first().evaluate(async (v: HTMLVideoElement) => {
                if (v.readyState < 1)
                  await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }))
                const target = Math.max(0.1, (v.duration || 1) / 2)
                v.currentTime = target
                await new Promise((r) => v.addEventListener('seeked', r, { once: true }))
                return { src: v.currentSrc, at: v.currentTime }
              })
              expect(seeked.src).toMatch(/^recolt:/)
              expect(seeked.at).toBeGreaterThan(0)
            }
            if (card.kind === 'tweet') await expect(detail.locator('[data-tweet]')).toBeVisible()
          }
          if (card && card.mediaCount > 1 && want.has('carousel')) {
            want.delete('carousel')
            const dots = page.locator(`${t('slide-indicator')} .viewer-dot`)
            await expect(dots).toHaveCount(card.mediaCount)
            await expect(dots.nth(0)).toHaveClass(/is-active/)
            await page.keyboard.press('Alt+ArrowRight')
            await expect(dots.nth(1)).toHaveClass(/is-active/)
            await page.keyboard.press('Alt+ArrowLeft')
            await expect(dots.nth(0)).toHaveClass(/is-active/)
          }
          if (want.size === 0) break
          const before = uuid
          await page.keyboard.press('ArrowRight')
          await expect(detail).not.toHaveAttribute('data-uuid', before)
        }
        // Démo : pas de carrousel garanti ; bibliothèque réelle : les quatre sont vus.
        if (src) expect([...want]).toEqual([])
        await page.keyboard.press('Escape')
        await expect(detail).toHaveCount(0)
      })

      await test.step('Redécouvrir', async () => {
        await page.locator(t('btn-rediscover')).click()
        await expect(page.locator(t('rediscover'))).toBeVisible()
        await expect(page.locator(t('rd-counter'))).toHaveText(/^1 \/ \d+$/)
        await page.keyboard.press('ArrowRight')
        await expect(page.locator(t('rd-counter'))).toHaveText(/^2 \//)
        await page.keyboard.press('Escape')
        await expect(page.locator(t('rediscover'))).toHaveCount(0)
      })

      await test.step('Réglages : les 9 sections', async () => {
        await page.locator(t('btn-settings')).click()
        await expect(page.locator(t('settings'))).toBeVisible()
        for (const key of [
          'appearance',
          'libraries',
          'ai',
          'tags',
          'capture',
          'sync',
          'storage',
          'data',
          'about',
        ]) {
          await page.locator(t(`settings-nav-${key}`)).click()
          await expect(page.locator(t(`settings-section-${key}`))).toBeVisible()
        }
        await page.keyboard.press('Escape')
        await expect(page.locator(t('settings'))).toHaveCount(0)
      })

      await test.step('menus de l’app', async () => {
        // Tous les ids de commande existent dans le menu natif.
        const missing = await app.evaluate(
          ({ Menu }, ids) => ids.filter((id) => !Menu.getApplicationMenu()?.getMenuItemById(id)),
          [...MENU_COMMANDS].filter((id) => id !== 'pasteUrl'),
        )
        expect(missing).toEqual([])
        // Dialogues natifs neutralisés : « Annuler » partout.
        await app.evaluate(({ dialog }) => {
          const d = dialog as unknown as Record<string, unknown>
          d.showOpenDialog = () => Promise.resolve({ canceled: true, filePaths: [] })
          d.showSaveDialog = () => Promise.resolve({ canceled: true })
        })
        await clickMenu(app, 'goCollections')
        await expect(page.locator(t('shelf'))).toBeVisible()
        await clickMenu(app, 'goSpaces')
        await expect(
          page.locator(`${t('space-empty-cta')}, ${t('spaces-list')}`).first(),
        ).toBeVisible()
        await clickMenu(app, 'search')
        await expect(page.locator(t('search-input'))).toBeVisible()
        await clickMenu(app, 'goLibrary')
        await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
        await clickMenu(app, 'settings')
        await expect(page.locator(t('settings'))).toBeVisible()
        await page.keyboard.press('Escape')
        await clickMenu(app, 'rediscover')
        await expect(page.locator(t('rediscover'))).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.locator(t('rediscover'))).toHaveCount(0)
        for (const id of ['zoomIn', 'zoomOut', 'zoomReset', 'importFiles', 'importFolder']) {
          expect(await clickMenu(app, id)).toBe(true)
        }
        await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
      })

      await test.step('capture (faux screencapture)', async () => {
        const before = count("SELECT count(*) n FROM items WHERE source = 'capture'")
        expect(await clickMenu(app, 'capture')).toBe(true)
        await expect
          .poll(() => count("SELECT count(*) n FROM items WHERE source = 'capture'"))
          .toBe(before + 1)
        await expect
          .poll(() => fs.readdirSync(drop).filter((f) => f.startsWith('Capture RecoltOS')).length)
          .toBe(1)
      })

      await test.step('import par glisser (fichiers avec chemin)', async () => {
        const paths: string[] = []
        for (const [i, color] of ['#c0392b', '#2e86c1'].entries()) {
          const f = path.join(files, `glisse-${i}.png`)
          fs.writeFileSync(f, await makeImage({ width: 48, height: 36, color, format: 'png' }))
          paths.push(f)
        }
        const before = count('SELECT count(*) n FROM items')
        // Des `File` adossés à de vrais fichiers (sélecteur de fichiers de Chromium) : le preload
        // retrouve leur chemin (`webUtils.getPathForFile`), comme pour un glisser depuis le Finder.
        await page.evaluate(() => {
          const input = document.createElement('input')
          input.type = 'file'
          input.multiple = true
          input.id = 'e2e-drop-files'
          input.style.display = 'none'
          document.body.append(input)
        })
        await page.locator('#e2e-drop-files').setInputFiles(paths)
        await page.evaluate(() => {
          const input = document.getElementById('e2e-drop-files') as HTMLInputElement
          const dt = new DataTransfer()
          for (const f of Array.from(input.files ?? [])) dt.items.add(f)
          const fire = (type: string) =>
            window.dispatchEvent(
              new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }),
            )
          fire('dragenter')
          fire('dragover')
        })
        await expect(page.locator(t('drop-overlay'))).toBeVisible()
        await page.evaluate(() => {
          const input = document.getElementById('e2e-drop-files') as HTMLInputElement
          const dt = new DataTransfer()
          for (const f of Array.from(input.files ?? [])) dt.items.add(f)
          window.dispatchEvent(
            new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
          )
          input.remove()
        })
        await expect(page.locator(t('drop-overlay'))).toHaveCount(0)
        await expect.poll(() => count('SELECT count(*) n FROM items')).toBe(before + 2)
      })

      await test.step('synchronisation X (faux hôte natif)', async () => {
        host = new FakeHost(socketPath(userData))
        const sock = host.sock
        await new Promise<void>((r) => sock.once('connect', () => r()))
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
            cosmos: { loggedIn: false, permission: true },
          },
          openTabs: { x: 0, instagram: 0, cosmos: 0 },
        })
        await host.waitFor((m) => m.type === 'hello.ack' && m.re === helloId)
        await page.locator(t('btn-settings')).click()
        await page.locator(t('settings-nav-sync')).click()
        await expect(page.locator(t('sync-ext-state'))).toContainText('Connectée — Firefox')
        await page.locator(t('sync-switch-x')).click()
        await page.locator(t('sync-activate-confirm')).click()
        const run = (await host.waitFor((m) => m.type === 'sync.run')) as { payload?: Json }
        const runId = String(run.payload?.runId)
        for (const [i, file] of ['x/curseur-page1.json', 'x/curseur-fin.json'].entries()) {
          const id = host.send('sync.page', {
            runId,
            platform: 'x',
            pageIndex: i,
            origin: 'replay',
            status: 200,
            json: fx(file),
            target: 'background',
          })
          await host.waitFor((m) => m.type === 'sync.ack' && m.re === id)
        }
        host.send('sync.finished', { runId, status: 'ok', pages: 2, target: 'background' })
        await expect(page.locator(t('sync-line-x'))).toContainText('nouveaux')
        expect(
          count("SELECT count(*) n FROM items WHERE source = 'x' AND origin = 'sync'"),
        ).toBeGreaterThan(0)
        await page.keyboard.press('Escape')
        await expect(page.locator(t('settings'))).toHaveCount(0)
      })

      await test.step('Spaces : création, nœuds, export PNG', async () => {
        await page.locator(t('seg-spaces')).click()
        const cta = page.locator(t('space-empty-cta'))
        await expect(cta.or(page.locator(t('space-new-card'))).first()).toBeVisible()
        if (await cta.isVisible()) await cta.click()
        else await page.locator(t('space-new-card')).click()
        await expect(page.locator(t('space-viewport'))).toBeVisible()
        const title = page.locator(t('collection-title-input'))
        await title.fill('Parcours')
        await title.press('Enter')
        const box = (await page.locator(t('space-viewport')).boundingBox())!
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2
        await page.keyboard.press('n')
        await page.mouse.click(cx - 200, cy - 80)
        await page.locator(t('note-editor')).fill('Note du parcours')
        await page.mouse.click(cx + 260, cy + 160)
        await expect(page.locator('.space-node[data-type="note"]')).toContainText(
          'Note du parcours',
        )
        // Un élément de la bibliothèque, par le tiroir (type de glisser interne).
        await page.locator(t('tool-library')).click()
        const drawerCard = page.locator(t('drawer-card')).first()
        await expect(drawerCard).toBeVisible()
        const itemUuid = await drawerCard.getAttribute('data-uuid')
        await page.evaluate(
          ([u, x, y]) => {
            const dt = new DataTransfer()
            dt.setData('application/x-recoltos-items', JSON.stringify([u]))
            const target = document.querySelector('[data-testid="space-editor"]')!
            for (const type of ['dragover', 'drop']) {
              target.dispatchEvent(
                new DragEvent(type, {
                  dataTransfer: dt,
                  clientX: x,
                  clientY: y,
                  bubbles: true,
                  cancelable: true,
                }),
              )
            }
          },
          [itemUuid!, cx + 120, cy] as const,
        )
        await expect(page.locator('.space-node[data-type="item"]')).toHaveCount(1)
        const list = await invoke<{ uuid: string; name: string }[]>(page, 'spaces.list')
        const space = list.data.find((s) => s.name === 'Parcours')!
        await expect
          .poll(
            async () =>
              (await invoke<{ nodes: unknown[] }>(page, 'spaces.get', { uuid: space.uuid })).data
                .nodes.length,
          )
          .toBe(2)
        const out = path.join(root, 'export.png')
        await app.evaluate(({ dialog }, file) => {
          ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = () =>
            Promise.resolve({ canceled: false, filePath: file })
        }, out)
        const r = await invoke<{ path: string }>(page, 'spaces.exportPng', {
          uuid: space.uuid,
          scope: 'all',
          scale: 1,
          background: 'light',
          name: 'Parcours',
        })
        expect(r.ok, r.error?.message).toBe(true)
        expect(fs.readFileSync(out).subarray(0, 4).toString('hex')).toBe('89504e47')
        await page.locator(t('space-back')).click()
        await page.locator(t('seg-library')).click()
      })

      await test.step('IA (faux CLI uniquement)', async () => {
        const set = await invoke(page, 'prefs.set', {
          patch: {
            ai: {
              provider: 'claude',
              autoNameOnSave: false,
              autoAnalyzeOnSave: false,
              claude: { path: path.join(FAKE_BIN, 'claude') },
              codex: { path: path.join(FAKE_BIN, 'codex') },
            },
          },
        })
        expect(set.ok, set.error?.message).toBe(true)
        const consent = await invoke(page, 'ai.consent', { version: 1 })
        expect(consent.ok, consent.error?.message).toBe(true)
        // Une image dont le fichier est local (les images synchronisées restent distantes ici :
        // `downloadRemoteMedia` coupé) ; l'UI de génération est couverte par m4-ai.spec.ts.
        const { uuid } = db
          .prepare(
            `SELECT i.uuid FROM items i JOIN item_media m ON m.item_id = i.id AND m.position = 0
             WHERE i.kind = 'image' AND i.media_count = 1 AND m.status = 'ok'
               AND i.deleted_at IS NULL ORDER BY i.created_at DESC LIMIT 1`,
          )
          .get() as { uuid: string }
        const calls = () => count('SELECT count(*) n FROM ai_calls')
        const before = calls()
        const queued = await invoke<{ queued: number }>(page, 'ai.enqueue', {
          itemUuids: [uuid],
          task: 'analyze',
          force: true,
        })
        expect(queued.ok, queued.error?.message).toBe(true)
        const state = () =>
          (db.prepare('SELECT ai_state s FROM items WHERE uuid = ?').get(uuid) as { s: string }).s
        await expect.poll(state, { timeout: 30_000 }).toBe('done')
        expect(calls()).toBe(before + 1)
        const row = db
          .prepare('SELECT provider, outcome FROM ai_calls ORDER BY id DESC LIMIT 1')
          .get() as { provider: string; outcome: string }
        expect(row).toEqual({ provider: 'claude', outcome: 'ok' })
        const found = await invoke<{ items: { uuid: string }[] }>(page, 'search.query', {
          q: 'synthétique',
          limit: 50,
        })
        expect(found.data.items.map((i) => i.uuid)).toContain(uuid)
        await invoke(page, 'prefs.set', { patch: { ai: { provider: 'off' } } })
      })

      await test.step('sécurité : 0 requête externe, 0 violation CSP, 0 erreur console', async () => {
        const hits = await netHits(app)
        expect(
          hits.filter((x) => x.wc !== null),
          'requêtes externes du renderer',
        ).toEqual([])
        expect(hits, 'requêtes externes (main compris)').toEqual([])
        for (const w of app.windows()) {
          if (w.isClosed()) continue
          const v = await cspHits(w).catch(() => null)
          if (v) expect(v, 'violations CSP').toEqual([])
        }
        expect(await cspHits(page)).toEqual([])
        expect(await h!.flushErrors(), 'erreurs console / pageerror').toEqual([])
      })
      db.close()
    } finally {
      ;(host as FakeHost | null)?.sock.end()
      if (h) await h.app.close().catch(() => undefined)
    }

    // Après fermeture (base consolidée) : aucun secret, manifests GatherOS intacts.
    const media = new Set([
      'items',
      'large',
      'thumbs',
      'posters',
      'previews',
      'avatars',
      'remote',
      'display',
      'derived',
      'Cache',
      'Code Cache',
      'GPUCache',
      'DawnGraphiteCache',
      'DawnWebGPUCache',
      'GraphiteDawnCache',
      'GPUPersistentCache',
      'shared_proto_db',
      'VideoDecodeStats',
      'blob_storage',
    ])
    const leaks = [...textFiles(userData, media), ...textFiles(home, new Set())].filter((f) =>
      SECRET_RE.test(fs.readFileSync(f, 'latin1')),
    )
    expect.soft(leaks, 'secrets dans les fichiers de l’app').toEqual([])
    const after = openDbReadonly(libraryDbPath(userData))
    try {
      expect.soft(secretsInDb(after), 'secrets dans la base').toEqual([])
    } finally {
      after.close()
    }
    for (const d of decoys) expect(sha(d.f), d.f).toBe(d.sum)
    removeTmpDir(root)
  })
})
