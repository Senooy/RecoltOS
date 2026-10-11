/**
 * App PACKAGÉE (`pnpm run pack`) : hôte natif SEA embarqué, manifests Firefox + Chromium écrits dans un
 * HOME de test (`RECOLTOS_HOME`, jamais `~/Library`), aller-retour `ping` → `pong` puis `hello` →
 * `hello.ack` à travers l'exécutable `Contents/Resources/native-host/recolt-host` jusqu'à l'app,
 * désinstallation qui laisse `co.gatheros.host.json` intact (WP-5F, SYNC §8 critère 10).
 */
import { expect, test } from '@playwright/test'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXTENSION_ORIGIN, GECKO_ID } from '../../src/shared/bridge/constants'
import { encodeFrame, FrameDecoder } from '../../src/host/framing'
import { REPO_ROOT } from '../helpers/paths'
import { makeTmpDir } from '../helpers/tmpdir'

const APP = join(REPO_ROOT, 'dist/mac-arm64/RecoltOS.app')
const BIN = join(APP, 'Contents/MacOS/RecoltOS')
const HOST = join(APP, 'Contents/Resources/native-host/recolt-host')
const AS = (home: string, ...p: string[]) => join(home, 'Library', 'Application Support', ...p)

test.skip(!existsSync(BIN), 'app packagée absente (pnpm run pack)')

let app: ChildProcess | null = null
test.afterEach(() => {
  app?.kill('SIGTERM')
  app = null
})

async function until(pred: () => boolean, ms = 30_000): Promise<void> {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('délai dépassé')
    await new Promise((r) => setTimeout(r, 100))
  }
}

test('hôte natif packagé : ping → pong, hello → hello.ack ; manifests de test ; désinstallation propre', async () => {
  test.setTimeout(120_000)
  const userData = makeTmpDir('pkg-ud')
  const home = makeTmpDir('pkg-home')
  for (const d of ['Firefox', 'Google/Chrome', 'BraveSoftware/Brave-Browser'])
    mkdirSync(AS(home, d), { recursive: true })
  const gatheros = AS(home, 'Google/Chrome/NativeMessagingHosts/co.gatheros.host.json')
  mkdirSync(join(gatheros, '..'), { recursive: true })
  writeFileSync(gatheros, '{"ne":"pas toucher"}')
  const env = {
    PATH: '/usr/bin:/bin',
    HOME: process.env.HOME ?? '',
    RECOLTOS_USER_DATA: userData,
    RECOLTOS_HOME: home,
    RECOLTOS_E2E: '1',
    RECOLTOS_BRIDGE: '1',
  }
  app = spawn(BIN, [], { env, stdio: 'ignore' })
  await until(() => existsSync(join(userData, 'host.json')))
  await until(() => existsSync(AS(home, 'Mozilla/NativeMessagingHosts/com.recoltos.host.json')))
  const ff = JSON.parse(
    readFileSync(AS(home, 'Mozilla/NativeMessagingHosts/com.recoltos.host.json'), 'utf8'),
  ) as Record<string, unknown>
  expect(ff).toMatchObject({
    name: 'com.recoltos.host',
    path: HOST,
    allowed_extensions: [GECKO_ID],
  })
  const cr = JSON.parse(
    readFileSync(AS(home, 'Google/Chrome/NativeMessagingHosts/com.recoltos.host.json'), 'utf8'),
  ) as Record<string, unknown>
  expect(cr).toMatchObject({ path: HOST, allowed_origins: [EXTENSION_ORIGIN] })

  // L'hôte tel qu'un navigateur le lance : environnement minimal, origine en argument.
  const host = spawn(HOST, [EXTENSION_ORIGIN], {
    env: { PATH: '/usr/bin:/bin', RECOLTOS_USER_DATA: userData },
  })
  const got: { type: string; re?: string; payload?: Record<string, unknown> }[] = []
  const dec = new FrameDecoder(1024 * 1024)
  host.stdout.on('data', (c: Buffer) => {
    for (const ev of dec.push(c))
      if (ev.kind === 'message') got.push(ev.value as (typeof got)[number])
  })
  const send = (m: unknown) => host.stdin.write(encodeFrame(m, 64 * 1024 * 1024))
  const pingId = crypto.randomUUID()
  send({ v: 1, id: pingId, type: 'ping' })
  await until(() => got.some((m) => m.type === 'pong' && m.re === pingId), 5_000)
  await until(
    () => got.some((m) => m.type === 'app.status' && m.payload?.connected === true),
    10_000,
  )
  const helloId = crypto.randomUUID()
  send({
    v: 1,
    id: helloId,
    type: 'hello',
    payload: {
      extVersion: '1.0.0',
      protocol: 1,
      target: 'firefox',
      browser: { name: 'Firefox', version: '157.0.1' },
      profileId: null,
      platforms: {
        x: { loggedIn: false },
        instagram: { loggedIn: false },
        cosmos: { loggedIn: false },
      },
      openTabs: { x: 0, instagram: 0, cosmos: 0 },
    },
  })
  await until(() => got.some((m) => m.type === 'hello.ack' && m.re === helloId), 10_000)
  const ack = got.find((m) => m.type === 'hello.ack')!
  expect(ack.payload).toMatchObject({ protocol: 1, needsReload: false, bundledExtVersion: '1.0.0' })
  host.stdin.end()
  app.kill('SIGTERM')
  await new Promise((r) => app?.once('exit', r))
  app = null

  // Désinstallation : nos manifests retirés, celui de GatherOS intact.
  const r = spawnSync(BIN, ['--uninstall-native-hosts'], { env, timeout: 60_000 })
  expect(r.status).toBe(0)
  expect(existsSync(AS(home, 'Mozilla/NativeMessagingHosts/com.recoltos.host.json'))).toBe(false)
  expect(existsSync(AS(home, 'Google/Chrome/NativeMessagingHosts/com.recoltos.host.json'))).toBe(
    false,
  )
  expect(readFileSync(gatheros, 'utf8')).toBe('{"ne":"pas toucher"}')
})
