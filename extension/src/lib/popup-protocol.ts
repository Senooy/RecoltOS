/**
 * Messages popup ↔ arrière-plan (`runtime.sendMessage`). Internes à l'extension.
 */
import type { BridgePlatform } from '../../../src/shared/bridge/constants'
import type { PlatformsState } from '../../../src/shared/bridge/messages'
import type { BridgeCollection } from '../../../src/shared/bridge/save'
import type { SyncStateMessage } from '../../../src/shared/bridge/sync'
import type { BridgeState } from '../background/native'

export interface PopupState {
  bridge: BridgeState
  stale: { extVersion: string; bundledExtVersion: string } | null
  target: 'chromium' | 'firefox'
  collections: BridgeCollection[]
  lastCollectionId: string | null
  tab: {
    id: number | null
    url: string | null
    title: string | null
    platform: BridgePlatform | null
  }
  ogImage: string | null
  platforms: PlatformsState | null
  sync: SyncStateMessage['sources'] | null
  pending: boolean
}

export type PopupRequest =
  | { type: 'popup:state' }
  | {
      type: 'popup:save'
      mode: 'page' | 'image'
      tabId: number | null
      title: string | null
      collectionId: string | null
      note: string | null
    }
  | { type: 'popup:sync'; platform?: BridgePlatform }
  | { type: 'popup:createCollection'; name: string }
  | { type: 'popup:statusChanged' }
