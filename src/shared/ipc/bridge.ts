/** Contrat `bridge.*` (PLAN §4.4, ERRATA §G.2) : clients connectés, navigateurs, extension, GatherOS. */
import { z } from 'zod'
import { BridgeClient, BrowserInfo, ExtensionInfo, GatherOSPresence } from '../dto/sync'
import { Empty, Void, type ContractShape } from './define'

export const bridgeContract = {
  'bridge.getClients': { input: Empty, output: z.array(BridgeClient) },
  'bridge.getBrowsers': { input: Empty, output: z.array(BrowserInfo) },
  'bridge.getGatherOSPresence': { input: Empty, output: GatherOSPresence },
  'bridge.getExtensionInfo': { input: Empty, output: ExtensionInfo },
  'bridge.reinstallHosts': { input: Empty, output: z.object({ installed: z.array(z.string()) }) },
  'bridge.uninstallHosts': { input: Empty, output: z.object({ removed: z.array(z.string()) }) },
  'bridge.revealExtensionFolder': {
    input: z.object({ target: z.enum(['chromium', 'firefox']).default('chromium') }).default({
      target: 'chromium',
    }),
    output: Void,
  },
} as const satisfies ContractShape
