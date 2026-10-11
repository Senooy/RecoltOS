/** Contrat `bridge.*` (PLAN §4.4) : clients connectés, navigateurs, coexistence GatherOS. */
import { z } from 'zod'
import { BridgeClient, BrowserInfo } from '../dto/sync'
import { Empty, Void, type ContractShape } from './define'

export const bridgeContract = {
  'bridge.getClients': { input: Empty, output: z.array(BridgeClient) },
  'bridge.getBrowsers': { input: Empty, output: z.array(BrowserInfo) },
  'bridge.getGatherOSPresence': {
    input: Empty,
    output: z.object({
      appRunning: z.boolean(),
      hostManifests: z.array(z.object({ browser: z.string(), path: z.string() })),
      extensionDetected: z.boolean(),
    }),
  },
  'bridge.reinstallHosts': { input: Empty, output: z.object({ installed: z.array(z.string()) }) },
  'bridge.uninstallHosts': { input: Empty, output: z.object({ removed: z.array(z.string()) }) },
  'bridge.revealExtensionFolder': { input: Empty, output: Void },
} as const satisfies ContractShape
