/**
 * happy-dom shims for Radix / floating-ui (to import at the top of each UI kit test):
 * ResizeObserver, pointer capture, scrollIntoView, matchMedia, DOMRect.
 */
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const proto = Element.prototype as unknown as Record<string, unknown>
proto.hasPointerCapture ??= () => false
proto.setPointerCapture ??= () => undefined
proto.releasePointerCapture ??= () => undefined
proto.scrollIntoView ??= () => undefined

if (typeof window.matchMedia !== 'function') {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }))
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  delete document.documentElement.dataset.reduceMotion
  delete document.documentElement.dataset.theme
  vi.useRealTimers()
})
