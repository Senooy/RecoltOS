/**
 * Wrappers, manifests natifs (Chromium + Firefox), extension en chemin fixe, coexistence GatherOS
 * Tout se passe dans un HOME temporaire : jamais dans `~/Library`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXTENSION_ORIGIN,
  GECKO_ID,
  NATIVE_HOST_NAME,
  NATIVE_HOST_NAME_DEV,
} from '../../../src/shared/bridge/constants'
import { appSupport, BROWSERS } from '../../../src/main/bridge/browsers'
import { installExtension, readVersion } from '../../../src/main/bridge/extension-installer'
import { blocksInstagram, detectGatherOS } from '../../../src/main/bridge/gatheros-coexistence'
import {
  hostName,
  installNativeHosts,
  isOwnManifest,
  uninstallNativeHosts,
} from '../../../src/main/bridge/native-host-installer'
import { makeTmpDir } from '../../helpers/tmpdir'

function fakeHome(dirs: string[]): string {
  const home = makeTmpDir('home')
  for (const d of dirs) mkdirSync(join(appSupport(home), d), { recursive: true })
  return home
}

const HOST_EXE = '/Applications/RecoltOS.app/Contents/Resources/native-host/recolt-host'
const env = (userData: string) => ({ userData, hostExe: HOST_EXE })

describe('manifests natifs', () => {
  it('Chromium : allowed_origins ; Firefox : allowed_extensions ; seulement si le dossier existe', () => {
    const home = fakeHome(['Google/Chrome', 'Firefox'])
    const userData = makeTmpDir('ud')
    const r = installNativeHosts({ ...env(userData), home, name: hostName(true) })
    expect(r.installed.sort()).toEqual(['chrome', 'firefox'])
    const chrome = JSON.parse(
      readFileSync(
        join(
          appSupport(home),
          'Google/Chrome/NativeMessagingHosts',
          `${NATIVE_HOST_NAME_DEV}.json`,
        ),
        'utf8',
      ),
    ) as Record<string, unknown>
    expect(chrome).toMatchObject({
      name: NATIVE_HOST_NAME_DEV,
      type: 'stdio',
      allowed_origins: [EXTENSION_ORIGIN],
      path: HOST_EXE,
    })
    const ff = JSON.parse(
      readFileSync(
        join(appSupport(home), 'Mozilla/NativeMessagingHosts', `${NATIVE_HOST_NAME_DEV}.json`),
        'utf8',
      ),
    ) as Record<string, unknown>
    expect(ff.allowed_extensions).toEqual([GECKO_ID])
    expect(ff.allowed_origins).toBeUndefined()
    expect(existsSync(join(appSupport(home), 'BraveSoftware'))).toBe(false)
  })

  it('Firefox installé sans dossier Mozilla : le dossier est créé', () => {
    const home = fakeHome([])
    const userData = makeTmpDir('ud')
    const r = installNativeHosts({
      ...env(userData),
      home,
      name: NATIVE_HOST_NAME,
      installedApps: new Set(['firefox']),
    })
    expect(r.installed).toEqual(['firefox'])
  })

  it('plus de wrapper sh : le manifest vise l’exécutable, anciens wrappers retirés', () => {
    const userData = makeTmpDir('ud')
    mkdirSync(join(userData, 'native-host'), { recursive: true })
    writeFileSync(join(userData, 'native-host', 'recoltos-host-chrome'), '#!/bin/sh\n')
    installNativeHosts({
      ...env(userData),
      home: fakeHome(['Google/Chrome']),
      name: NATIVE_HOST_NAME,
    })
    expect(existsSync(join(userData, 'native-host'))).toBe(false)
  })

  it('désinstallation : retire nos manifests, laisse co.gatheros.host.json intact', () => {
    const home = fakeHome(['Google/Chrome', 'BraveSoftware/Brave-Browser', 'Firefox'])
    const userData = makeTmpDir('ud')
    const gatheros: string[] = []
    for (const d of ['Google/Chrome', 'BraveSoftware/Brave-Browser']) {
      const p = join(appSupport(home), d, 'NativeMessagingHosts', 'co.gatheros.host.json')
      mkdirSync(join(p, '..'), { recursive: true })
      writeFileSync(p, '{"contenu":"ne pas toucher"}')
      gatheros.push(p)
    }
    installNativeHosts({ ...env(userData), home, name: NATIVE_HOST_NAME })
    const removed = uninstallNativeHosts({ userData, home })
    expect(removed).toHaveLength(3)
    for (const p of removed) expect(isOwnManifest(p)).toBe(true)
    for (const p of gatheros) expect(readFileSync(p, 'utf8')).toBe('{"contenu":"ne pas toucher"}')
    expect(existsSync(join(userData, 'native-hosts.json'))).toBe(false)
    expect(isOwnManifest('/a/co.gatheros.host.json')).toBe(false)
  })

  it('liste des navigateurs : Firefox, Chrome, Brave, Edge, Vivaldi présents', () => {
    const ids = BROWSERS.map((b) => b.id)
    for (const b of ['firefox', 'chrome', 'brave', 'edge', 'vivaldi']) expect(ids).toContain(b)
  })
})

describe('extension en chemin fixe', () => {
  it('copie si la version change, échange en 3 renommages, reprise après coupure', async () => {
    const bundled = makeTmpDir('ext-src')
    writeFileSync(join(bundled, 'manifest.json'), '{"version":"1.0.0"}')
    writeFileSync(join(bundled, 'background.js'), 'v1')
    const dest = join(makeTmpDir('ext-dst'), 'chromium')
    expect(await installExtension(bundled, dest)).toBe('installed')
    expect(await installExtension(bundled, dest)).toBe('current')
    writeFileSync(join(bundled, 'manifest.json'), '{"version":"1.1.0"}')
    writeFileSync(join(bundled, 'background.js'), 'v2')
    expect(await installExtension(bundled, dest)).toBe('installed')
    expect(readFileSync(join(dest, 'background.js'), 'utf8')).toBe('v2')
    expect(readVersion(dest)).toMatch(/^1\.1\.0\+/)
    expect(existsSync(`${dest}.old`)).toBe(false)
    // Coupure entre le renommage 1 et 2 : CUR absent, OLD présent → restauré au lancement suivant.
    const { renameSync } = await import('node:fs')
    renameSync(dest, `${dest}.old`)
    expect(await installExtension(bundled, dest)).toBe('current')
    expect(existsSync(join(dest, 'manifest.json'))).toBe(true)
    expect(await installExtension(makeTmpDir('vide'), dest)).toBe('missing')
  })
})

describe('coexistence GatherOS', () => {
  it('existence seule des manifests et 3 drapeaux de sync', async () => {
    const home = fakeHome(['Google/Chrome', 'GatherOS'])
    const manifest = join(
      appSupport(home),
      'Google/Chrome/NativeMessagingHosts/co.gatheros.host.json',
    )
    mkdirSync(join(manifest, '..'), { recursive: true })
    writeFileSync(manifest, 'pas du JSON : ne doit jamais être lu')
    writeFileSync(
      join(appSupport(home), 'GatherOS', 'prefs.json'),
      JSON.stringify({ syncXEnabled: true, syncInstagramEnabled: false, autre: 'ignoré' }),
    )
    const p = await detectGatherOS(home, { running: () => Promise.resolve(false) })
    expect(p.hostManifests).toEqual([{ browser: 'chrome', path: manifest }])
    expect(p.syncFlags).toEqual({ x: true, instagram: false, cosmos: null })
    expect(blocksInstagram(p)).toBe(true)
    expect(blocksInstagram({ ...p, hostManifests: [], appInstalled: true })).toBe(false)
    expect(readFileSync(manifest, 'utf8')).toBe('pas du JSON : ne doit jamais être lu')
  })
})
