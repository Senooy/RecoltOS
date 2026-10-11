import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectCli, fallbackDirs } from '../../../src/main/ai/cli/resolve'

describe('detectCli', () => {
  let home: string
  const prevHome = process.env.HOME

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'recolt-resolve-'))
    process.env.HOME = home
  })
  afterEach(() => {
    process.env.HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  })

  it('trouve un CLI installé dans un dossier ajouté au PATH par .zshrc (shell de login muet)', async () => {
    const dir = join(home, '.hermes/node/bin')
    mkdirSync(dir, { recursive: true })
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\necho 2.1.300\n')
    chmodSync(bin, 0o755)

    const found = await detectCli('claude', {
      shell: () => Promise.resolve(''),
      version: () => Promise.resolve('2.1.300'),
      searchDirs: fallbackDirs(home),
    })

    expect(found.map((c) => c.path)).toContain(bin)
    expect(found[0]?.version).toBe('2.1.300')
  })

  it('liste les dossiers courants sous le HOME donné', () => {
    expect(fallbackDirs('/Users/x')).toContain('/Users/x/.hermes/node/bin')
    expect(fallbackDirs('/Users/x')).toContain('/Users/x/.local/bin')
  })
})
