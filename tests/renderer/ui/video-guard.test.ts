// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  mustStayQuiet,
  pauseVideo,
  releaseDetached,
  releaseVideo,
} from '../../../src/renderer/src/lib/video-guard'

interface Spied {
  v: HTMLVideoElement
  pause: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
}

function spied(): Spied {
  const v = document.createElement('video')
  v.src = 'recolt://x/a.mp4'
  const pause = vi.fn()
  const load = vi.fn()
  v.pause = pause
  v.load = load
  return { v, pause, load }
}

const video = (): HTMLVideoElement => spied().v

describe('video-guard', () => {
  it('releaseVideo: pause, remove src, load()', () => {
    const { v, pause, load } = spied()
    releaseVideo(v)
    expect(pause).toHaveBeenCalled()
    expect(v.hasAttribute('src')).toBe(false)
    expect(load).toHaveBeenCalled()
  })

  it('pauseVideo does not release the stream', () => {
    const { v, pause } = spied()
    pauseVideo(v)
    expect(pause).toHaveBeenCalled()
    expect(v.hasAttribute('src')).toBe(true)
  })

  it('releaseDetached: releases only if the element has left the document', async () => {
    const attached = video()
    document.body.append(attached)
    const detached = video()
    releaseDetached(attached)
    releaseDetached(detached)
    await Promise.resolve()
    expect(attached.hasAttribute('src')).toBe(true)
    expect(detached.hasAttribute('src')).toBe(false)
    attached.remove()
  })

  it('mustStayQuiet: sound forbidden outside the Viewer or while it closes', () => {
    const root = document.createElement('div')
    root.dataset.testid = 'detail'
    const inside = video()
    root.append(inside)
    document.body.append(root)
    expect(mustStayQuiet(inside)).toBe(false)
    root.setAttribute('data-closing', '')
    expect(mustStayQuiet(inside)).toBe(true)
    inside.muted = true
    expect(mustStayQuiet(inside)).toBe(false)
    const outside = video()
    document.body.append(outside)
    expect(mustStayQuiet(outside)).toBe(true)
    root.remove()
    outside.remove()
  })
})
