/**
 * "Save to RecoltOS" buttons injected into a synthetic DOM of x.com and
 * instagram.com: one button per post, idempotent, correct identifier and DOM fallback.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { extFr, setExtLang } from '../../../extension/src/lib/i18n'
import { buttonLabel, injectInto, type PostRef } from '../../../extension/src/lib/inject'

beforeAll(() => setExtLang('fr'))

describe('injection X', () => {
  it('one button per tweet, next to the actions group; idempotent', async () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name">Studio Lumen@studiolumen</div>
        <a href="/studiolumen/status/1870000000000000001"><time>1 h</time></a>
        <div data-testid="tweetText">Une grille modulaire</div>
        <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/A.jpg"></div>
        <div role="group"><button data-testid="bookmark"></button></div>
      </article>
      <article data-testid="tweet"><div role="group"></div></article>`
    const saved: PostRef[] = []
    const save = (r: PostRef) => {
      saved.push(r)
      return Promise.resolve({ status: 'saved' })
    }
    expect(injectInto(document, 'x.com', 'https://x.com', save)).toBe(1)
    expect(injectInto(document, 'x.com', 'https://x.com', save)).toBe(0)
    const btn = document.querySelector<HTMLButtonElement>(`[aria-label="${buttonLabel()}"]`)!
    btn.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(saved[0]).toEqual({
      platform: 'x',
      externalId: '1870000000000000001',
      url: 'https://x.com/studiolumen/status/1870000000000000001',
      dom: {
        text: 'Une grille modulaire',
        authorName: 'Studio Lumen',
        authorHandle: 'studiolumen',
        imageUrls: ['https://pbs.twimg.com/media/A.jpg'],
      },
    })
  })
})

describe('injection Instagram', () => {
  it('button in the Save icon bar, short link code', () => {
    document.body.innerHTML = `
      <article>
        <a href="/p/DSyNtH00001/"><img src="https://scontent.cdninstagram.com/a.jpg"></a>
        <section><span><svg aria-label="Enregistrer"></svg></span></section>
      </article>`
    const saved: PostRef[] = []
    expect(
      injectInto(document, 'www.instagram.com', 'https://www.instagram.com', (r) => {
        saved.push(r)
        return Promise.resolve({ status: 'duplicate' })
      }),
    ).toBe(1)
    document.querySelector<HTMLButtonElement>(`[aria-label="${buttonLabel()}"]`)!.click()
    expect(saved[0]?.externalId).toBe('DSyNtH00001')
    expect(saved[0]?.url).toBe('https://www.instagram.com/p/DSyNtH00001/')
  })
})

describe('button language', () => {
  it('English label when the app (or the browser) is in English', () => {
    setExtLang('en')
    try {
      document.body.innerHTML = `
        <article data-testid="tweet">
          <a href="/a/status/1"><time>1 h</time></a>
          <div role="group"></div>
        </article>`
      injectInto(document, 'x.com', 'https://x.com', () => Promise.resolve({ status: 'saved' }))
      expect(document.querySelector('[aria-label="Save to RecoltOS"]')).not.toBeNull()
      expect(buttonLabel()).not.toBe(extFr.menu.save)
    } finally {
      setExtLang('fr')
    }
  })
})
