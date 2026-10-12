/**
 * `system.*` contract (`edit`, `openLogs`, `copyText`, `redetectTools`).
 * Cross-cutting events: `menu.command`, `nav.openItem`, `library.switched`.
 */
import { z } from 'zod'
import { LibraryId, Uuid, WebUrl } from '../enums'
import { ToolsPrefs } from '../prefs'
import { MENU_COMMANDS } from '../shortcuts'
import { Empty, Void, type ContractShape, type EventShape } from './define'

export const EditCommand = z.enum(['undo', 'redo', 'selectAll', 'cut', 'copy', 'paste'])

export const systemContract = {
  'system.revealInFinder': { input: z.object({ itemUuid: Uuid }), output: Void },
  /** http(s) only. */
  'system.openExternal': { input: z.object({ url: WebUrl }), output: Void },
  /** Poster for a video; `toPng` on the worker side (nativeImage cannot read webp). */
  'system.copyImage': { input: z.object({ itemUuid: Uuid }), output: Void },
  'system.copyText': { input: z.object({ text: z.string().max(100_000) }), output: Void },
  'system.saveAs': {
    input: z.object({ itemUuid: Uuid }),
    output: z.object({ path: z.string() }).nullable(),
  },
  'system.quickLook': { input: z.object({ itemUuid: Uuid }), output: Void },
  /** Focused editable field: `webContents.undo()`…. */
  'system.edit': { input: z.object({ cmd: EditCommand }), output: Void },
  'system.openLogs': { input: Empty, output: Void },
  'system.redetectTools': { input: Empty, output: ToolsPrefs },
  /** Item to open, requested by main before the window listens (`nav.openItem`). */
  'system.takePendingNav': { input: Empty, output: z.object({ uuid: Uuid }).nullable() },
  'system.appInfo': {
    input: Empty,
    output: z.object({
      version: z.string(),
      electron: z.string(),
      chrome: z.string(),
      node: z.string(),
      isPackaged: z.boolean(),
    }),
  },
} as const satisfies ContractShape

export const MenuCommandSchema = z.enum(MENU_COMMANDS)

export const systemEvents = {
  'menu.command': z.object({ cmd: MenuCommandSchema }),
  'nav.openItem': z.object({ uuid: Uuid }),
  'library.switched': z.object({ libraryId: LibraryId }),
} as const satisfies EventShape
