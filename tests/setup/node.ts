/**
 * Mise en place commune des tests Node (QA §5.1) :
 *  - fuseau UTC (déterminisme des dates) ;
 *  - aucun accès réseau externe : `fetch` n'accepte que la boucle locale et les domaines factices
 *    `*.test` / `*.example` (les serveurs de test écoutent sur 127.0.0.1) ;
 *  - jamais de variable d'environnement RECOLTOS_* héritée du shell de l'utilisateur.
 */
process.env.TZ = 'UTC'
for (const key of Object.keys(process.env)) {
  if (key.startsWith('RECOLTOS_') && key !== 'RECOLTOS_REAL_LIBRARY') delete process.env[key]
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

export function isAllowedTestHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || /\.(test|example|invalid|localhost)$/.test(hostname)
}

const realFetch = globalThis.fetch
globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  let host: string
  try {
    host = new URL(raw).hostname
  } catch {
    return realFetch(input, init)
  }
  if (!isAllowedTestHost(host)) {
    return Promise.reject(new Error(`Réseau externe interdit en test : ${host}`))
  }
  return realFetch(input, init)
}
