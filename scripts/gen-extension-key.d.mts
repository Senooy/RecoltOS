/** Types de `gen-extension-key.mjs` (identifiant fixe de l'extension Chromium). */
export function extensionIdFromPublicKey(der: Uint8Array): string
export function generateExtensionKey(): { key: string; id: string; privatePem: string }
