/**
 * English texts for the `ai` domain: Settings › AI, the “Change” sheet (provider and consent),
 * the “Enrich library” dialog, send preview, log, Details panel, top bar pill.
 */
import type { Widen } from '../../../../shared/i18n/messages'
import type { ai as frAi } from '../fr/ai'
import { pluralEn } from '../plural'

export const ai: Widen<typeof frAi> = {
  aiUi: {
    engineTitle: (name: string) => `Engine: ${name}`,
    engineNone: 'none',
    providerNames: { claude: 'Claude', codex: 'ChatGPT / Codex', off: 'None' },
    shortNames: { claude: 'Claude', codex: 'Codex' },
    change: 'Change',
    state: {
      off: 'AI is off. Choose an engine to title, describe and tag your items.',
      noConsent: 'Engine chosen, waiting for your approval of what gets sent.',
      checking: 'Checking…',
      notFound: 'CLI not found on this Mac.',
      notLogged: 'Not signed in: run the CLI once in Terminal to sign in.',
      connected: (plan?: string) =>
        plan
          ? `Connected · ${plan === 'max' ? 'Max' : plan === 'pro' ? 'Pro' : plan} plan`
          : 'Connected',
      apiKey: 'API key detected: usage-based billing, which goes against your subscription choice.',
      paused: (reason: string, until?: string) => `${reason}${until ? ` until ${until}` : ''}`,
    },
    pauseReasons: {
      RATE_LIMITED: 'Subscription limit reached, paused',
      NOT_AUTHENTICATED: 'Not signed in, paused',
      NOT_INSTALLED: 'CLI not found, paused',
      HARD_CAP: 'Daily cap reached',
      USER: 'Paused',
      HOUR_BUDGET: 'Hourly quota reached',
      DAY_BUDGET: 'Daily quota reached',
    },
    autoName: 'Automatically name new items',
    autoNameDesc: 'Generates a short title for each new item, in the background.',
    autoAnalyze: 'Describe and tag new items',
    autoAnalyzeDesc:
      'Adds a description, tags and detected text (OCR) so search can find your items by what’s in them.',
    advanced: 'Advanced',
    privacy: 'Privacy',
    model: 'Model',
    modelAuto: 'Auto',
    modelCustom: 'Other…',
    modelPlaceholder: 'model identifier',
    effort: 'Effort',
    efforts: { low: 'Low', medium: 'Medium' },
    fallback: 'Fallback engine',
    fallbackHelp: 'Used when the main engine is paused (limit, signed out).',
    titlePolicy: 'Replace titles',
    titlePolicies: { empty: 'Only if empty', always: 'Always' },
    rate: 'Rate',
    rateHelp: (h: number, d: number, hard: number) =>
      `${h} calls per hour, ${d} per day, hard cap ${hard}.`,
    presets: { soft: 'Gentle', normal: 'Normal', fast: 'Fast' },
    concurrency: 'Simultaneous calls',
    queue: 'Queue',
    queueStats: (q: number, r: number, f: number) =>
      `${q} waiting · ${r} running · ${f} ${pluralEn(f, 'failure', 'failures')}`,
    budgetUsed: (h: number, hl: number, d: number, dl: number) =>
      `This hour ${h}/${hl} · today ${d}/${dl}`,
    pause: 'Pause',
    resume: 'Resume',
    cancelAll: 'Cancel All',
    retryFailed: 'Retry Failures',
    overrideCap: 'Keep Going Today',
    analyzeRest: (n: number) => `Analyze unanalyzed items (${n})`,
    regenerateFr: (n: number) => `Regenerate existing descriptions in English (${n})`,
    sentTitle: 'What gets sent',
    sentRows: [
      [
        'Image, page',
        '1 JPEG ≤ 1568 px without EXIF, source host, page title, post caption (≤ 600 chars) with the author’s name and handle',
      ],
      ['Carousel', '1 to 3 JPEGs (cover and spread-out slides), number of slides, caption'],
      [
        'Video',
        '3 keyframes ≤ 1024 px, duration, caption and author; never the video file or audio',
      ],
      ['Post', 'author, handle, text (≤ 1200 chars) and quoted post (≤ 600 chars)'],
      ['Always', 'the system prompt and ≤ 60 tags from your vocabulary'],
    ],
    neverSent:
      'Never sent: local paths, original file names, full URLs, notes, collections, the rest of your library.',
    preview: 'See a Preview',
    log: 'Send log',
    logEmpty: 'Nothing sent yet.',
    logClear: 'Clear Log',
    logCleared: (n: number) => `${n} ${pluralEn(n, 'entry', 'entries')} cleared`,
    outcomes: {
      ok: 'succeeded',
      error: 'error',
      rate_limited: 'limit',
      cancelled: 'cancelled',
      timeout: 'timeout',
      violation: 'tool refused',
    },
    logFiles: (n: number, kb: string) => (n === 0 ? 'text only' : `${n} JPEG · ${kb}`),
    logChars: (n: number) => ` · ${n} chars`,
    // “Change” sheet
    sheetTitle: 'AI Engine',
    sheetDesc:
      'RecoltOS runs the official CLI installed on your Mac, with your subscription. No API key.',
    path: 'Path',
    copies: (n: number) => `${n} ${pluralEn(n, 'copy', 'copies')} found`,
    version: (v: string) => `version ${v}`,
    verify: 'Check',
    liveTest: 'Test a Real Call',
    liveTestHint: 'Uses 1 request from your subscription (synthetic image).',
    liveOk: (ms: number, model?: string) =>
      `Valid response in ${String(Math.round(ms / 100) / 10)} s${model ? ` (${model})` : ''}`,
    liveFail: (e: string) => `Failed: ${e}`,
    keychainHint: 'If macOS asks for keychain access for “claude”, click “Always Allow”.',
    consentTitle: 'Before using AI',
    consentIntro: (name: string) =>
      `Analyzed items are sent to ${name}, under your subscription, and are subject to ${name === 'Claude' ? 'Anthropic’s' : 'OpenAI’s'} terms and privacy policy.`,
    consentThirdParty: 'Captions and third-party author names are sent along with the content.',
    consentUsage:
      'Personal use, with the official unmodified binary and your own account: subscription limits assume ordinary, individual use. Don’t distribute RecoltOS set up on someone else’s account.',
    consentOk: 'Got It',
    done: 'OK',
    // Enrich
    enrichDesc: (n: number) =>
      `${n} ${pluralEn(n, 'item doesn’t', 'items don’t')} have a description yet. AI can title, describe and tag them for search.`,
    enrichEta: (calls: number, eta: string, perHour: number) =>
      `${calls} ${pluralEn(calls, 'call', 'calls')}, about ${eta} at ${perHour} calls per hour.`,
    enrichRegen: (n: number) =>
      `Also regenerate the ${n} existing descriptions in English (uses ${n} more calls)`,
    enrichXCarousels: 'X carousels without local slides: cover only.',
    enrichStart: 'Start',
    enrichLater: 'Later',
    enrichStarted: (n: number) => `${n} ${pluralEn(n, 'item', 'items')} added to the AI queue`,
    // Preview
    previewTitle: 'What will be sent',
    previewDesc: (name: string) => `Exactly these files and this text, to ${name}.`,
    previewNoFile: 'No image: text only.',
    previewPrompt: 'Prompt',
    previewSystem: 'System prompt',
    previewChars: (n: number) => `${n} characters`,
    previewEmpty: 'Nothing to preview.',
    // Details
    via: (name: string, fallback: boolean) =>
      `via ${name} (subscription)${fallback ? ' · fallback' : ''}`,
    generating: 'Analyzing…',
    queued: 'Queued…',
    failed: 'The analysis failed.',
    retry: 'Try Again',
    excluded: 'Excluded from AI',
    generatePrompt: 'Generate an Image Prompt',
    copied: 'Prompt copied',
    enqueued: 'Analysis requested',
    include: 'Allow Sending to AI',
    // Top bar
    pill: (n: number) => `AI · ${n}`,
    pillPaused: 'AI paused',
    pillTitle: 'AI queue: open Settings › AI',
    eta: (sec: number) => {
      if (sec < 90) return `${Math.max(1, Math.round(sec))} s`
      const min = Math.round(sec / 60)
      if (min < 60) return `${min} min`
      const h = Math.floor(min / 60)
      const m = min % 60
      return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
    },
    errorCodes: {
      NOT_INSTALLED: 'CLI not found',
      NOT_AUTHENTICATED: 'not signed in',
      RATE_LIMITED: 'limit reached',
      TIMEOUT: 'timed out',
      CANCELLED: 'cancelled',
      FILE_MISSING: 'media unreadable or missing',
      DISABLED: 'AI turned off',
      BAD_OUTPUT: 'invalid response',
      PROCESS: 'the CLI failed',
      TOOL_VIOLATION: 'tool refused',
      UNSUPPORTED_CLI: 'unsupported CLI',
    },
    errors: {
      ai_disabled: 'Choose an engine first in Settings › AI.',
      ai_consent_required: 'Accept the sending terms first in Settings › AI.',
    },
  },
}
