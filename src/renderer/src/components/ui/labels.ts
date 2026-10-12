/**
 * Internal labels of the UI kit (accessibility: accessible names, tooltips), in the active
 * language: each label is re-read at use (getters), never frozen at import.
 */
import { tr } from '../../i18n'

export const UI_LABELS = {
  get close(): string {
    return tr.viewer.close
  },
  get loading(): string {
    return tr.app.loading
  },
  remove: (label: string): string => tr.uiKit.remove(label),
  get video(): string {
    return tr.card.video
  },
  get gif(): string {
    return tr.card.gif
  },
  slide: (current: number, total: number): string => tr.uiKit.slide(current, total),
  get notifications(): string {
    return tr.uiKit.notifications
  },
  get dismiss(): string {
    return tr.uiKit.dismiss
  },
}
