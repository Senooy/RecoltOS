/** English texts for the `updates` domain (automatic updates from GitHub Releases). */
import type { Widen } from '../../../../shared/i18n/messages'
import type { updates as frUpdates } from '../fr/updates'

export const updates: Widen<typeof frUpdates> = {
  updatesUi: {
    title: 'Updates',
    current: (v: string) => `You’re using RecoltOS ${v}.`,
    check: 'Check for Updates',
    auto: 'Check for updates automatically',
    autoDesc:
      'At launch, then every 6 hours. The update downloads in the background and installs the next time you restart.',
    restart: 'Restart',
    state: {
      unsupported: 'Automatic updates aren’t available for this build.',
      idle: 'Not checked yet.',
      checking: 'Checking…',
      upToDate: 'RecoltOS is up to date.',
      downloading: (v: string, p: number) => `Downloading RecoltOS${v ? ` ${v}` : ''}… ${p}%`,
      ready: (v: string) => `RecoltOS ${v} is ready. It will be installed when you restart.`,
      error: 'Couldn’t check for updates. Try again later.',
    },
    toast: {
      ready: (v: string) => `RecoltOS ${v} is ready`,
      restart: 'Restart',
    },
  },
}
