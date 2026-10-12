import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { contract } from '../../../src/shared/ipc'
import { AbsPath } from '../../../src/shared/ipc/define'
import { MediaUrl, WebUrl } from '../../../src/shared/enums'
import { PostMetaSchema } from '../../../src/shared/post-meta'

const LIB = 'recolt://default'

describe('MediaUrl (recolt://<libraryId>/<root>/<rel>?v=<n>)', () => {
  it('accepts legitimate forms', () => {
    expect(MediaUrl.safeParse(`${LIB}/thumbs/0d/x.webp?v=1`).success).toBe(true)
    expect(MediaUrl.safeParse(`${LIB}/items/ab/9552f1ec.jpg`).success).toBe(true)
    expect(MediaUrl.safeParse(`recolt://mock/large/a.svg?w=1440&h=806&c=a8dadc`).success).toBe(true)
  })
  it('rejects traversal and roots outside MEDIA_ROOTS', () => {
    expect(MediaUrl.safeParse('recolt://lib/../../etc/passwd').success).toBe(false)
    expect(MediaUrl.safeParse('recolt://lib/items/../../secret.jpg').success).toBe(false)
    expect(MediaUrl.safeParse('recolt://lib/items/./a.jpg').success).toBe(false)
    expect(MediaUrl.safeParse('recolt://lib/etc/passwd').success).toBe(false)
    expect(MediaUrl.safeParse('recolt://lib/items/a.jpg#frag').success).toBe(false)
    expect(MediaUrl.safeParse('recolt://lib/items\\..\\x').success).toBe(false)
    expect(MediaUrl.safeParse('recolt://lib/').success).toBe(false)
  })
  it('rejects %2e, %2f, %5c encodings (case-insensitive) and empty segments', () => {
    for (const bad of [
      'recolt://lib/items/%2e%2e/%2e%2e/etc/passwd',
      'recolt://lib/items/..%2f..%2fetc',
      'recolt://lib/items/%2E%2E%5Cx.jpg',
      'recolt://lib/items//etc/passwd',
      'recolt://lib/items/a.jpg/',
    ])
      expect(MediaUrl.safeParse(bad).success, bad).toBe(false)
  })
})

describe('AbsPath', () => {
  it('accepts a normal absolute path and rejects . and .. segments', () => {
    expect(AbsPath.safeParse('/Users/me/Photos/a.jpg').success).toBe(true)
    expect(AbsPath.safeParse('/Users/me/../etc/passwd').success).toBe(false)
    expect(AbsPath.safeParse('/Users/me/./a.jpg').success).toBe(false)
    expect(AbsPath.safeParse('relatif.jpg').success).toBe(false)
  })
  it('rejects the NUL byte, « // » and the bare root', () => {
    expect(AbsPath.safeParse('/a\u0000b').success).toBe(false)
    expect(AbsPath.safeParse('/').success).toBe(false)
    expect(AbsPath.safeParse('//etc').success).toBe(false)
    expect(AbsPath.safeParse('/Users/me//Photos').success).toBe(false)
  })
})

describe('URL web (post-meta)', () => {
  it('WebUrl only accepts http(s)', () => {
    expect(WebUrl.safeParse('https://pbs.twimg.com/media/a.jpg').success).toBe(true)
    expect(WebUrl.safeParse('javascript:alert(1)').success).toBe(false)
    expect(WebUrl.safeParse('file:///etc/passwd').success).toBe(false)
  })
  it('PostMetaSchema rejects javascript: and file: in avatar URLs', () => {
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

describe('validation messages in French', () => {
  it('items.list with an unknown scope returns a French message', () => {
    const r = contract['items.list'].input.safeParse({ scope: 'nope' })
    expect(r.success).toBe(false)
    if (!r.success) {
      const msg = z.prettifyError(r.error)
      expect(msg).not.toMatch(/Invalid|expected/)
    }
  })
  it('libraries.remove rejects deleteFiles:true with a French message', () => {
    const r = contract['libraries.remove'].input.safeParse({ id: 'default', deleteFiles: true })
    expect(r.success).toBe(false)
    if (!r.success) expect(z.prettifyError(r.error)).not.toMatch(/Invalid input|expected/)
  })
})
