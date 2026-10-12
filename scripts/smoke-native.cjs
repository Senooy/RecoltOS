/**
 * Smoke test of the native modules INSIDE the Electron main process (criterion 3):
 * better-sqlite3 opens `:memory:`, runs `0001_init.sql` (user_version = 1), does an FTS5 MATCH,
 * then sharp resizes a 1×1 image. Exit 0 if everything passes, 1 otherwise.
 * Launch: `pnpm run smoke:native` (= `electron scripts/smoke-native.cjs`).
 */
'use strict'
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.disableHardwareAcceleration()

async function main() {
  const versions = {
    electron: process.versions.electron,
    node: process.versions.node,
    abi: process.versions.modules,
  }
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'db', 'migrations', '0001_init.sql'),
    'utf8',
  )
  db.transaction(() => {
    db.exec(sql)
    db.pragma('user_version = 1')
  })()
  const userVersion = db.pragma('user_version', { simple: true })
  if (userVersion !== 1) throw new Error(`user_version = ${userVersion}`)
  const now = Date.now()
  db.prepare(
    "INSERT INTO items(uuid, kind, title, created_at, updated_at) VALUES (?, 'image', ?, ?, ?)",
  ).run('00000000-0000-4000-8000-000000000001', 'Café crème', now, now)
  const hits = db.prepare('SELECT rowid FROM items_fts WHERE items_fts MATCH ?').all('"cafe"*')
  if (hits.length !== 1) throw new Error(`FTS5 MATCH : ${hits.length} result(s)`)
  const sqliteVersion = db.prepare('SELECT sqlite_version() AS v').get().v
  const integrity = db.pragma('integrity_check', { simple: true })
  db.close()

  const sharp = require('sharp')
  const one = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fafafa' } })
    .png()
    .toBuffer()
  const out = await sharp(one).resize(8, 8).webp().toBuffer({ resolveWithObject: true })
  if (out.info.width !== 8 || out.info.height !== 8) throw new Error('sharp: unexpected resize')

  console.log(
    JSON.stringify({
      ok: true,
      ...versions,
      sqlite: sqliteVersion,
      userVersion,
      ftsHits: hits.length,
      integrity,
      vips: sharp.versions.vips,
      webp: `${out.info.width}x${out.info.height}`,
    }),
  )
}

app
  .whenReady()
  .then(main)
  .then(
    () => app.exit(0),
    (err) => {
      console.error('[smoke:native] failed:', err)
      app.exit(1)
    },
  )
