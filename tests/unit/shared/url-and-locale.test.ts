import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { contract } from '../../../src/shared/ipc'
import { AbsPath } from '../../../src/shared/ipc/define'
import { MediaUrl, WebUrl } from '../../../src/shared/enums'
import { PostMetaSchema } from '../../../src/shared/post-meta'

const LIB = 'recolt://default'

describe('MediaUrl (PLAN §1.7 : recolt://<libraryId>/<root>/<rel>?v=<n>)', () => {
  it('accepte les formes légitimes', () => {
    expect(MediaUrl.safeParse(`${LIB}/thumbs/0d/x.webp?v=1`).success).toBe(true)
    expect(MediaUrl.safeParse(`${LIB}/items/ab/9552f1ec.jpg`).success).toBe(true)
    expect(MediaUrl.safeParse(`recolt://mock/large/a.svg?w=1440&h=806&c=a8dadc`).success).toBe(true)
  })
  it('refuse le traversal et les racines hors MEDIA_ROOTS', () => {
    expect(MediaUrl.safeParse('recolt://lib/../../etc/passwd').success).toBe(false)
    expect(MediaUrl.safeParse('recolt://lib/items/../../secret.jpg').success).toBe(false)
    expect(MediaUrl.safeParse('recolt://lib/items/./a.jpg').success).toBe(false)
    expect(MediaUrl.safeParse('recolt://lib/etc/passwd').success).toBe(false)
    expect(MediaUrl.safeParse('recolt://lib/items/a.jpg#frag').success).toBe(false)
    expect(MediaUrl.safeParse('recolt://lib/items\\..\\x').success).toBe(false)
    expect(MediaUrl.safeParse('recolt://lib/').success).toBe(false)
  })
})

describe('AbsPath', () => {
  it('accepte un chemin absolu normal et refuse les segments . et ..', () => {
    expect(AbsPath.safeParse('/Users/me/Photos/a.jpg').success).toBe(true)
    expect(AbsPath.safeParse('/Users/me/../etc/passwd').success).toBe(false)
    expect(AbsPath.safeParse('/Users/me/./a.jpg').success).toBe(false)
    expect(AbsPath.safeParse('relatif.jpg').success).toBe(false)
  })
})

describe('URL web (post-meta)', () => {
  it('WebUrl n’accepte que http(s)', () => {
    expect(WebUrl.safeParse('https://pbs.twimg.com/media/a.jpg').success).toBe(true)
    expect(WebUrl.safeParse('javascript:alert(1)').success).toBe(false)
    expect(WebUrl.safeParse('file:///etc/passwd').success).toBe(false)
  })
  it('PostMetaSchema refuse javascript: et file: dans les URL d’avatar', () => {
    const base = {
      v: 1 as const,
      platform: 'x' as const,
      author: { name: 'x', handle: 'x', avatarUrl: null },
      text: null,
      url: null,
      postedAt: null,
    }
    expect(PostMetaSchema.safeParse(base).success).toBe(true)
    const bad = PostMetaSchema.safeParse({
      ...base,
      author: { ...base.author, avatarUrl: 'javascript:alert(1)' },
    })
    expect(bad.success).toBe(false)
    const badFile = PostMetaSchema.safeParse({
      ...base,
      author: { ...base.author, avatarUrl: 'file:///etc/passwd' },
    })
    expect(badFile.success).toBe(false)
    const badPost = PostMetaSchema.safeParse({ ...base, url: 'javascript:alert(1)' })
    expect(badPost.success).toBe(false)
  })
})

describe('messages de validation en français (règle §2.6)', () => {
  it('items.list avec un scope inconnu renvoie un message français', () => {
    const r = contract['items.list'].input.safeParse({ scope: 'nope' })
    expect(r.success).toBe(false)
    if (!r.success) {
      const msg = z.prettifyError(r.error)
      expect(msg).not.toMatch(/Invalid|expected/)
    }
  })
  it('libraries.remove refuse deleteFiles:true avec un message français', () => {
    const r = contract['libraries.remove'].input.safeParse({ id: 'default', deleteFiles: true })
    expect(r.success).toBe(false)
    if (!r.success) expect(z.prettifyError(r.error)).not.toMatch(/Invalid input|expected/)
  })
})
