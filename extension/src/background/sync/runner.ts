/**
 * Exécuteur de synchronisation (WP-54). Squelette de WP-53 : l'interface utilisée par le script
 * d'arrière-plan ; la sync en arrière-plan est livrée par WP-54.
 */
import type { PayloadOf } from '../../../../src/shared/bridge/messages'
import type { NativeBridge } from '../native'

export class SyncRunner {
  readonly bridge: NativeBridge
  constructor(bridge: NativeBridge) {
    this.bridge = bridge
  }
  configure(_s: PayloadOf<'hello.ack'>['settings']): void {}
  run(_r: PayloadOf<'sync.run'>): void {}
  cancel(_runId: string): void {}
  watchdog(): void {}
  onAlarm(_name: string): void {}
  refreshItem(_p: PayloadOf<'item.refresh'>): Promise<void> {
    return Promise.resolve()
  }
  proxyMedia(_p: PayloadOf<'media.fetch'>): Promise<void> {
    return Promise.resolve()
  }
  setWantedAuthors(_p: PayloadOf<'authors.wanted'>): void {}
  onContentMessage(_m: unknown, _sender: unknown, _reply: (r: unknown) => void): boolean {
    return false
  }
}
