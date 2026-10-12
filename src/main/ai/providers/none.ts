/** Fournisseur « Aucun » : toute méthode lève `DISABLED` ; la file n'enfile rien. */
import {
  AiError,
  type AiCallOptions,
  type AiInput,
  type AiProvider,
  type ProviderStatus,
} from '../../../shared/ai-types'
import { mt } from '../../i18n'

const disabled = (_i?: AiInput, _o?: AiCallOptions): Promise<never> =>
  Promise.reject(new AiError('DISABLED', mt().ai.disabled))

export class NullProvider implements AiProvider {
  readonly id = 'none' as const
  status(): Promise<ProviderStatus> {
    return Promise.resolve({ installed: false, warnings: [] })
  }
  test() {
    return Promise.resolve({
      ok: false,
      status: { installed: false, warnings: [] },
      error: mt().ai.disabled,
    })
  }
  analyze = disabled
  describe = disabled
  title = disabled
  tags = disabled
  ocr = disabled
  imagePrompt = disabled
}
