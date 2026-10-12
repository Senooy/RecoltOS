/** English texts for the `viewer` domain: the detail view. */
import type { Widen } from '../../../../shared/i18n/messages'
import type { viewer as frViewer } from '../fr/viewer'

export const viewer: Widen<typeof frViewer> = {
  viewerUi: {
    label: 'Detail view',
    counter: (i: number, n: number) => `${i} / ${n}`,
    zoom: 'Zoom',
    seek: 'Playback position',
    slide: (i: number, n: number) => `Slide ${i} of ${n}`,
    prevSlide: 'Previous slide',
    nextSlide: 'Next slide',
    openSource: 'Open Link',
    techInfo: 'Technical info',
    format: 'Format',
    identifier: 'Identifier',
    removeTag: (name: string) => `Remove the ${name} tag`,
    removeCollection: (name: string) => `Remove from ${name}`,
    tagSuggestions: 'Tag suggestions',
    ocrShow: 'Show',
    ocrHide: 'Hide',
    copyPrompt: 'Copy Prompt',
    aiUnavailable: 'Turn on an AI engine in Settings › AI.',
    aiNone: 'No description yet.',
    providers: { claude: 'Claude', codex: 'Codex', gatheros: 'GatherOS' },
    sources: {
      x: 'X',
      instagram: 'Instagram',
      cosmos: 'Cosmos',
      web: 'Web',
      capture: 'Screenshot',
      local: 'File',
    },
    kinds: {
      image: 'Image',
      video: 'Video',
      tweet: 'Post',
      url: 'Page',
    },
    noteSaved: 'Note saved',
    deleted: 'Moved to Trash',
    downloaded: 'File saved',
    notFound: 'This item no longer exists.',
    thread: 'Thread',
    pick: 'Eyedropper',
    pickFailed: 'No readable color at this spot',
  },
}
