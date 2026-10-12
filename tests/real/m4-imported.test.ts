/**
 * IA (sans appel réel) sur une COPIE APFS d'un `userData` RecoltOS réel (jamais l'app installée) :
 * `RECOLT_TEST_IMPORTED_USERDATA=<repo>/.tmp/m3-real pnpm exec vitest run --project real`.
 * Aucun appel IA réel ici : estimation, préparation des médias, aperçu.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildAiInput } from '../../src/main/ai/input'
import { AiService } from '../../src/main/ai/service'
import type { MediaCaller } from '../../src/main/jobs/handlers/types'
import { resetLibraryContextForTests } from '../../src/main/library/library-context'
import { createLibraryManager, type LibraryManager } from '../../src/main/library/library-manager'
import { runMediaOp } from '../../src/main/workers/media/ops'
import { PrefsSchema } from '../../src/shared/prefs'
import type { MediaArgs, MediaOp, MediaResult } from '../../src/shared/worker-protocol'
import { FFMPEG, FFPROBE, SIPS } from '../fixtures/media/generate'

const SRC = process.env.RECOLT_TEST_IMPORTED_USERDATA ?? ''
const media: MediaCaller = <O extends MediaOp>(op: O, args: MediaArgs<O>) =>
  runMediaOp(op, args, { tools: { ffmpeg: FFMPEG, ffprobe: FFPROBE, sips: SIPS } }) as Promise<
    MediaResult<O>
  >

describe.skipIf(!SRC)('M4 sur la bibliothèque importée', () => {
  let base: string
  let ud: string
  let m: LibraryManager
  let svc: AiService
  beforeAll(async () => {
    if (/application support/i.test(SRC)) throw new Error('dossier vivant refusé : passe une copie')
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-m4real-'))
    ud = path.join(base, 'userData')
    fs.mkdirSync(ud)
    for (const f of ['libraries', 'libraries.json']) {
      const r = spawnSync('cp', ['-cR', path.join(SRC, f), path.join(ud, f)])
      if (r.status !== 0) fs.cpSync(path.join(SRC, f), path.join(ud, f), { recursive: true })
    }
    resetLibraryContextForTests()
    m = createLibraryManager({ userData: ud })
    await m.open()
    const lib = m.active()!
    const prefs = PrefsSchema.parse({})
    svc = new AiService({
      userData: ud,
      prefs: () => prefs,
      setPrefs: () => prefs,
      emit: () => undefined,
      services: () => ({
        lib,
        media,
        fetch: () => Promise.reject(new Error('réseau interdit')),
        prefs: () => prefs,
        changed: () => undefined,
        hasTool: (n) => Boolean(n === 'ffmpeg' ? FFMPEG : FFPROBE),
        kick: () => undefined,
        log: console,
      }),
      queue: () => null,
      log: console,
    })
  })
  afterAll(async () => {
    svc?.dispose()
    await m?.close()
    resetLibraryContextForTests()
    if (base) fs.rmSync(base, { recursive: true, force: true })
  })

  it('ai.estimate{missingDescription} = valeur recalculée depuis la base, 0 job créé', () => {
    const db = m.active()!.db
    const expected = (
      db
        .prepare(
          `SELECT count(*) AS n FROM items i WHERE i.deleted_at IS NULL AND i.ai_excluded = 0
           AND coalesce(i.ai_description, '') = '' AND NOT EXISTS (SELECT 1 FROM collection_items ci
           JOIN collections c ON c.id = ci.collection_id WHERE ci.item_id = i.id AND c.ai_excluded = 1)`,
        )
        .get() as { n: number }
    ).n
    const byKind = db
      .prepare(
        `SELECT kind, count(*) AS n FROM items WHERE deleted_at IS NULL AND coalesce(ai_description,'') = '' GROUP BY kind ORDER BY kind`,
      )
      .all()
    console.warn('[m4-real] sans description :', expected, byKind)
    const jobs0 = (
      db.prepare("SELECT count(*) AS n FROM jobs WHERE type LIKE 'ai.%'").get() as { n: number }
    ).n
    expect(svc.estimate({ missingDescription: true }).count).toBe(expected)
    const regen = svc.batchCreate('regenerate-fr')
    expect(regen.estimate.count).toBeGreaterThan(0)
    expect(
      (db.prepare("SELECT count(*) AS n FROM jobs WHERE type LIKE 'ai.%'").get() as { n: number })
        .n,
    ).toBe(jobs0)
  })

  it.skipIf(!FFMPEG)('3 vidéos réelles → 3 images clés chacune, ≤ 1024 px, sans EXIF', async () => {
    const lib = m.active()!
    const rows = lib.db
      .prepare(
        `SELECT i.* FROM items i JOIN item_media m ON m.item_id = i.id AND m.position = 0
         WHERE i.deleted_at IS NULL AND i.kind = 'video' AND m.status = 'ok' AND m.file_rel IS NOT NULL
         ORDER BY i.id LIMIT 3`,
      )
      .all() as Parameters<typeof buildAiInput>[1][]
    expect(rows).toHaveLength(3)
    for (const item of rows) {
      const dir = path.join(base, 'jobs', item.uuid)
      const { input } = await buildAiInput(
        { lib, media, hasTool: () => true, framesDir: path.join(ud, 'cache', 'frames') },
        item,
        dir,
        'analyze',
      )
      expect(input.media).toHaveLength(3)
      expect(input.context.videoDurationSec).toBeGreaterThan(0)
      for (const f of input.media) {
        const meta = await sharp(f.path).metadata()
        expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(1024)
        expect(meta.exif).toBeUndefined()
      }
      // Jamais l'URL complète : hôte seul.
      expect(JSON.stringify(input.context)).not.toMatch(/https?:\/\//)
    }
  })

  it('aperçu : JPEG exacts et prompt complet pour un post texte', async () => {
    const lib = m.active()!
    const tweet = lib.db
      .prepare(
        `SELECT uuid FROM items WHERE deleted_at IS NULL AND kind = 'tweet' AND post_meta ->> '$.text' <> '' LIMIT 1`,
      )
      .get() as { uuid: string }
    const pv = await svc.previewPayload(tweet.uuid, 'analyze')
    expect(pv.files).toHaveLength(0)
    expect(pv.prompt).toContain('Voici un post sauvegardé')
  })
})
