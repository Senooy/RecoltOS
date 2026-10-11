/**
 * Format HTML marqué du presse-papiers interne des Spaces (SPACES §1.5.7), pur et testable :
 * `<meta charset="utf-8"><span data-recolt-nodes="<base64(JSON)>" data-recolt-v="1"></span>` suivi
 * du texte échappé.
 */

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )

export function encodeNodesHtml(nodesJson: string, text: string): string {
  const b64 = Buffer.from(nodesJson, 'utf8').toString('base64')
  return `<meta charset="utf-8"><span data-recolt-nodes="${b64}" data-recolt-v="1"></span>${escapeHtml(text)}`
}

/** JSON des nœuds si le HTML porte le marqueur (version 1), sinon `null`. */
export function decodeNodesHtml(html: string): string | null {
  const m = /data-recolt-nodes="([A-Za-z0-9+/=]+)"/.exec(html)
  if (!m || !/data-recolt-v="1"/.test(html)) return null
  try {
    const json = Buffer.from(m[1]!, 'base64').toString('utf8')
    JSON.parse(json)
    return json
  } catch {
    return null
  }
}
