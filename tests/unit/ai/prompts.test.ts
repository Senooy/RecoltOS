import { describe, expect, it } from 'vitest'
import type { AiInput } from '../../../src/shared/ai-types'
import {
  SYSTEM_FR,
  buildAnalyzePrompt,
  buildImagePromptPrompt,
  clip,
  contextBlock,
} from '../../../src/main/ai/prompts'

const img = (i: number) => ({
  path: `/ud/ai-sandbox/claude/jobs/7/img${i}.jpg`,
  mime: 'image/jpeg' as const,
  bytes: 1000,
  width: 1568,
  height: 1045,
})
const vocab = ['affiche', 'typographie', 'interface']
const LONG = 'x'.repeat(2000)

const inputs: Record<string, AiInput> = {
  image: {
    itemUuid: 'u1',
    kind: 'image',
    media: [img(1)],
    context: {
      sourceLabel: 'Instagram',
      sourceHost: 'instagram.com',
      post: { authorName: 'Ada', authorHandle: '@ada', caption: 'Nouveau poster pour Blender 5' },
    },
    vocabulary: vocab,
  },
  carousel: {
    itemUuid: 'u2',
    kind: 'image',
    media: [img(1), img(2), img(3)],
    context: { sourceLabel: 'Instagram', carousel: { total: 6, slideNumbers: [1, 4, 6] } },
    vocabulary: vocab,
  },
  video: {
    itemUuid: 'u3',
    kind: 'video',
    media: [img(1), img(2), img(3)],
    context: {
      sourceLabel: 'X',
      sourceHost: 'x.com',
      videoDurationSec: 6.5,
      post: { authorName: 'Bob', authorHandle: '@bob', caption: 'Mon mod Minecraft' },
    },
    vocabulary: vocab,
  },
  url: {
    itemUuid: 'u4',
    kind: 'url',
    media: [img(1)],
    context: { sourceLabel: 'Web', sourceHost: 'reddit.com', pageTitle: 'Un fil sur la typo' },
    vocabulary: vocab,
  },
  tweet: {
    itemUuid: 'u5',
    kind: 'tweet',
    media: [],
    context: {
      sourceLabel: 'X',
      sourceHost: 'x.com',
      post: {
        authorName: 'Bob',
        authorHandle: '@bob',
        caption: 'Un thread sur les grilles',
        quoted: { authorName: 'Ada', authorHandle: '@ada', caption: 'Les grilles, c’est la vie' },
      },
    },
    vocabulary: vocab,
  },
}

describe('prompts', () => {
  it('prompt système figé', () => {
    expect(SYSTEM_FR).toMatchSnapshot()
  })

  for (const [name, input] of Object.entries(inputs)) {
    it(`analyse ${name} (claude et codex) figée`, () => {
      expect(buildAnalyzePrompt(input, 'claude')).toMatchSnapshot()
      expect(buildAnalyzePrompt(input, 'codex')).toMatchSnapshot()
    })
  }

  it('champ unique et 2ᵉ essai renforcé', () => {
    const p = buildAnalyzePrompt(inputs.image!, 'claude', { fields: ['title'], retry: true })
    expect(p).toContain('"title"')
    expect(p).not.toContain('"description"')
    expect(p).toContain("n'était pas un JSON valide")
  })

  it("prompt d'image figé", () => {
    expect(buildImagePromptPrompt(inputs.image!, 'claude')).toMatchSnapshot()
  })

  it('légende ≤ 600, post texte ≤ 1200, post cité ≤ 600', () => {
    const cap = (kind: AiInput['kind']) =>
      contextBlock({
        ...inputs.tweet!,
        kind,
        context: {
          post: {
            authorName: 'A',
            authorHandle: '@a',
            caption: LONG,
            quoted: { authorName: 'B', authorHandle: '@b', caption: LONG },
          },
        },
      })
    const lens = (s: string) => [...s.matchAll(/« (x+…) »/g)].map((m) => [...m[1]!].length)
    expect(lens(cap('image'))).toEqual([600, 600])
    expect(lens(cap('tweet'))).toEqual([1200, 600])
    expect(clip('a  b\n c', 10)).toBe('a b c')
  })

  it("le contexte n'inclut jamais d'URL complète ni de chemin local", () => {
    for (const i of Object.values(inputs)) {
      const ctx = contextBlock(i)
      expect(ctx).not.toMatch(/https?:\/\//)
      expect(ctx).not.toContain('/ud/')
    }
    // Codex : aucun chemin dans le prompt (images par -i).
    expect(buildAnalyzePrompt(inputs.video!, 'codex')).not.toContain('/ud/')
  })
})
