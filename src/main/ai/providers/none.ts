/** Fournisseur « Aucun » (AI §3.2) : toute méthode lève `DISABLED` ; la file n'enfile rien. */
import {
  AiError,
  type AiCallOptions,
  type AiInput,
  type AiProvider,
  type ProviderStatus,
} from '../../../shared/ai-types'

const disabled = (_i?: AiInput, _o?: AiCallOptions): Promise<never> =>
  Promise.reject(new AiError('DISABLED', 'IA désactivée'))

export class NullProvider implements AiProvider {
  readonly id = 'none' as const
  status(): Promise<ProviderStatus> {
    return Promise.resolve({ installed: false, warnings: [] })
  }
  test() {
    return Promise.resolve({
      ok: false,
      status: { installed: false, warnings: [] },
      error: 'IA désactivée',
    })
  }
  analyze = disabled
  describe = disabled
  title = disabled
  tags = disabled
  ocr = disabled
  imagePrompt = disabled
}
