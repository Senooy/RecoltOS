/**
 * Fumée de l'extension (WP-53, opt-in `pnpm run test:ext`) : Chromium de test Playwright avec un
 * profil JETABLE (`.tmp/`), extension de test chargée, manifest natif écrit DANS ce profil (Chromium lit
 * `<user-data-dir>/NativeMessagingHosts`, spike S4) qui vise l'exécutable SEA de l'hôte, app Electron
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
