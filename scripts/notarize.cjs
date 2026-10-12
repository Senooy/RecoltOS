const { execFile } = require('node:child_process')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')

const run = promisify(execFile)
const profile = 'RecoltOS-notary'

async function submitAndStaple(archive, target) {
  const { stdout } = await run('xcrun', [
    'notarytool',
    'submit',
    archive,
    '--keychain-profile',
    profile,
    '--wait',
    '--output-format',
    'json',
  ])
  const result = JSON.parse(stdout)
  if (result.status !== 'Accepted') {
    throw new Error(
      `Apple notarization ${result.status}: ${result.id}. Retrieve the notarytool log.`,
    )
  }
  await run('xcrun', ['stapler', 'staple', target])
  await run('xcrun', ['stapler', 'validate', target])
}

exports.notarizeApp = async (context) => {
  if (process.env.RECOLTOS_NOTARIZE !== '1') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  await run('codesign', ['--verify', '--deep', '--strict', app])
  const { stderr } = await run('codesign', ['--display', '--verbose=4', app])
  if (!stderr.includes(`TeamIdentifier=${process.env.APPLE_TEAM_ID?.trim()}\n`)) {
    throw new Error('APPLE_TEAM_ID does not match the signed application.')
  }
  const work = await mkdtemp(path.join(tmpdir(), 'recoltos-notary-'))
  try {
    const archive = path.join(work, 'RecoltOS.zip')
    await run('ditto', ['-c', '-k', '--keepParent', app, archive])
    await submitAndStaple(archive, app)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

exports.notarizeDmg = async (context) => {
  if (process.env.RECOLTOS_NOTARIZE !== '1') return []
  for (const artifact of context.artifactPaths.filter((file) => file.endsWith('.dmg'))) {
    await run('codesign', ['--verify', '--strict', artifact])
    await submitAndStaple(artifact, artifact)
  }
  return []
}
