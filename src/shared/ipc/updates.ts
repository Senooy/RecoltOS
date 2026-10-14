/**
 * `updates.*` contract: automatic updates from GitHub Releases (electron-updater, main process
 * only; the renderer has no network access). Event `updates.status` on every state change.
 */
import { z } from 'zod'
import { Empty, Void, type ContractShape, type EventShape } from './define'

/**
 * - `unsupported`: dev, e2e or a build not signed with a Developer ID (never an error);
 * - `idle`: nothing checked yet in this session;
 * - `ready`: downloaded, installed on restart (or when the app quits).
 */
export const UpdateState = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unsupported') }),
  z.object({ state: z.literal('idle') }),
  z.object({ state: z.literal('checking') }),
  z.object({ state: z.literal('upToDate'), checkedAt: z.number().int() }),
  z.object({
    state: z.literal('downloading'),
    version: z.string(),
    percent: z.number().min(0).max(100),
  }),
  z.object({ state: z.literal('ready'), version: z.string() }),
  z.object({ state: z.literal('error'), message: z.string().max(500) }),
])

export const UpdateStatus = z.object({
  currentVersion: z.string(),
  status: UpdateState,
})
export type UpdateStatus = z.output<typeof UpdateStatus>

export const updatesContract = {
  'updates.getStatus': { input: Empty, output: UpdateStatus },
  /** Manual check (button, menu): also downloads the update if there is one. */
  'updates.check': { input: Empty, output: UpdateStatus },
  /** Quits and installs the downloaded update (`ready` state only). */
  'updates.install': { input: Empty, output: Void },
} as const satisfies ContractShape

export const updatesEvents = {
  'updates.status': UpdateStatus,
} as const satisfies EventShape
