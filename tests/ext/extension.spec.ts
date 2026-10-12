/**
 * Fumée de l'extension (opt-in `pnpm run test:ext`) : Chromium de test Playwright avec un
 * profil JETABLE (`.tmp/`), extension de test chargée, manifest natif écrit DANS ce profil (Chromium lit
 * `<user-data-dir>/NativeMessagingHosts`) qui vise l'exécutable SEA de l'hôte, app Electron
 * de test (`RECOLTOS_BRIDGE=1`).
 * Aucun navigateur ni profil de l'utilisateur n'est touché, aucun appel réel aux plateformes.
 */
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXTENSION_ORIGIN } from '../../src/shared/bridge/constants'
import { launchApp, type AppHandle } from '../helpers/electron-app'
import { REPO_ROOT } from '../helpers/paths'
import { makeTmpDir } from '../helpers/tmpdir'
import { startFakePlatforms, type FakePlatforms } from './fake-platforms'

let srv: FakePlatforms
let handle: AppHandle
let ctx: BrowserContext
let sw: Worker

/** Scripts de build (ESM) lancés par tsx : Playwright charge les tests en CJS. */
function tsx(...args: string[]): void {
  const r = spawnSync(
    process.execPath,
    [join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs'), '--tsconfig', 'tsconfig.node.json', ...args],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 240_000 },
  )
  if (r.status !== 0) throw new Error(`${args[0]} : ${r.stderr || r.stdout}`)
}

test.beforeAll(async () => {
  test.setTimeout(180_000)
  srv = await startFakePlatforms()
  const extOut = makeTmpDir('ext-test-build')
  tsx('scripts/build-host.mts')
  tsx('scripts/build-ext.mts', '--test-base', srv.base, '--out', extOut, '--target', 'chromium')
  handle = await launchApp({ env: { RECOLTOS_BRIDGE: '1' } })
  const profile = makeTmpDir('chromium-profile')
  const hosts = join(profile, 'NativeMessagingHosts')
  mkdirSync(hosts, { recursive: true })
  writeFileSync(
    join(hosts, 'com.recoltos.host.json'),
    JSON.stringify({
      name: 'com.recoltos.host',
      description: 'RecoltOS (test)',
      path: join(REPO_ROOT, 'out/native-host/recolt-host'),
      type: 'stdio',
      allowed_origins: [EXTENSION_ORIGIN],
    }),
  )
  const ext = join(extOut, 'chromium')
  ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    // L'hôte, lancé par Chromium, lit `host.json` dans le userData de l'app de test.
    env: { ...process.env, RECOLTOS_USER_DATA: handle.userData },
  })
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))
})

test.afterAll(async () => {
  await ctx?.close()
  await handle?.close()
  await srv?.close()
})

interface Ack {
  status: string
  saveId?: string
}
interface Hooks {
  bridge: { state: string }
  saveImage(src: string, page: string): Promise<Ack>
  state(): Promise<{ collections: unknown[]; bridge: string }>
}
const hooks = () => (globalThis as unknown as { __recoltos: Hooks }).__recoltos

/** Évalue une expression sur les poignées de test du script d'arrière-plan. */
async function ev<T>(expr: string): Promise<T> {
  const v: unknown = await sw.evaluate(`(${hooks.toString()})()${expr}`)
  return v as T
}

test('identifiant fixe, pont connecté à l’app de test', async () => {
  expect(new URL(sw.url()).host).toBe(EXTENSION_ORIGIN.slice('chrome-extension://'.length, -1))
  await expect.poll(() => ev<string>('.bridge.state'), { timeout: 20_000 }).toBe('app_connected')
})

const saveImage = () =>
  ev<Ack>(
    `.saveImage(${JSON.stringify(`${srv.base}/img.png`)}, ${JSON.stringify(`${srv.base}/page.html`)})`,
  )

test('enregistre une image vers l’app (save.create → item créé)', async () => {
  const ack = await saveImage()
  expect(ack.status).toBe('saved')
  const items: unknown = await handle.page.evaluate(() =>
    window.recolt!.invoke('items.list', { scope: 'library', tab: 'all' }),
  )
  const list = (items as { data: { items: { uuid: string; kind: string }[] } }).data.items
  expect(list.some((i) => i.uuid === ack.saveId && i.kind === 'image')).toBe(true)
  // Ré-enregistrement du même fichier : doublon.
  expect((await saveImage()).status).toBe('duplicate')
})

test('menus contextuels : collections reçues de l’app', async () => {
  const st = await ev<{ collections: unknown[]; bridge: string }>('.state()')
  expect(Array.isArray(st.collections)).toBe(true)
  expect(st.bridge).toBe('app_connected')
})

test('sync en arrière-plan sans onglet : cookies de session, CSRF et Origin réécrit (faux serveur)', async () => {
  const url = srv.base
  await ctx.addCookies([
    { name: 'ct0', value: 'csrf-test', url, sameSite: 'Lax' },
    // SameSite=None exige https : en http local, Lax (le comportement Lax est le plus strict).
    { name: 'auth_token', value: 'session-test', url, sameSite: 'Lax' },
    { name: 'csrftoken', value: 'csrf-ig', url, sameSite: 'Lax' },
    { name: 'sessionid', value: 'session-ig', url, sameSite: 'Lax' },
  ])
  const pagesBefore = ctx.pages().length
  const x = await ev<{ kind: string; json: { data?: unknown } }>(`.fetchPage('x', null)`)
  expect(x.kind).toBe('page')
  const bm = srv.log.find((l) => l.path.includes('/bookmarksQuery?'))!
  expect(bm.csrf).toBe('csrf-test')
  expect(bm.cookie).toContain('ct0=csrf-test')
  expect(bm.cookie).toContain('auth_token=session-test')
  expect(bm.origin).toBe(srv.base)
  // Identifiant persisté découvert dans les extraits x-web (accueil → entrée → routes → chunk).
  expect(bm.path).toContain('/DemoQueryId00000001/bookmarksQuery')
  // Découverte du client web sans cookie.
  const entry = srv.log.find((l) => l.path.includes('/entry-client-'))!
  expect(entry.cookie).toBe('')
  // Cosmos : jeton par /api/refresh-token (cookies du site), puis GraphQL avec Authorization.
  const cos = await ev<{ kind: string }>(`.fetchPage('cosmos', null)`)
  expect(cos.kind).toBe('page')
  expect(srv.log.some((l) => l.path === '/cosmos/api/refresh-token')).toBe(true)
  const gql = srv.log.find((l) => l.path === '/cosmos/graphql')!
  expect(gql.auth).toBe('présent')
  expect(gql.origin).toBe(srv.base)
  const ig = await ev<{ kind: string }>(`.fetchPage('instagram', 'QVFD')`)
  expect(ig.kind).toBe('page')
  const igLog = srv.log.find((l) =>
    l.path.startsWith('/instagram/api/v1/feed/saved/posts/?max_id='),
  )!
  expect(igLog.igCsrf).toBe('csrf-ig')
  expect(igLog.cookie).toContain('sessionid=session-ig')
  // Aucun onglet ouvert par la sync.
  expect(ctx.pages().length).toBe(pagesBefore)
})

test('aucun cookie ni jeton dans les journaux ni la base de l’app', async () => {
  const { lstatSync, readdirSync, readFileSync } = await import('node:fs')
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n)
      const st = lstatSync(p)
      if (st.isSymbolicLink()) return []
      return st.isDirectory() ? walk(p) : st.size < 50 * 1024 * 1024 ? [p] : []
    })
  const files = walk(handle.userData).filter((f) => /\.(log|db|db-wal|json|txt)$/.test(f))
  expect(files.length).toBeGreaterThan(0)
  for (const f of files) {
    const s = readFileSync(f).toString('latin1')
    expect(s, f).not.toMatch(/csrf-test|session-test|csrf-ig|session-ig|Bearer [A-Za-z0-9]/)
  }
})

test('popup 360×520 : état connecté, textes en français (tutoiement)', async () => {
  const extId = EXTENSION_ORIGIN.slice('chrome-extension://'.length, -1)
  const page = await ctx.newPage()
  await page.setViewportSize({ width: 360, height: 560 })
  await page.goto(`chrome-extension://${extId}/popup.html`)
  await expect(page.locator('#status')).toContainText('Connecté à RecoltOS')
  await expect(page.locator('#savePage')).toHaveText('Enregistrer la page')
  await expect(page.locator('body')).toContainText('tant que ce navigateur est ouvert')
  await expect(page.locator('body')).not.toContainText(/\bvous\b|\bvotre\b/)
  mkdirSync(join(REPO_ROOT, '.tmp/m5-shots'), { recursive: true })
  await page.screenshot({ path: join(REPO_ROOT, '.tmp/m5-shots/popup.png') })
  await page.close()
})
