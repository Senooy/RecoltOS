/**
 * Minimal `chrome.*` to test the extension code under Node (vitest): scripted native port,
 * in-memory storage, cookies, menus, permissions.
 */
type Fn = (...a: never[]) => unknown

export class FakePort {
  name: string
  posted: unknown[] = []
  private msgL: Fn[] = []
  private discL: Fn[] = []
  error?: { message: string }
  constructor(name: string) {
    this.name = name
  }
  onMessage = { addListener: (f: Fn) => this.msgL.push(f) }
  onDisconnect = { addListener: (f: Fn) => this.discL.push(f) }
  postMessage(m: unknown) {
    this.posted.push(m)
  }
  disconnect() {}
  /** Host → extension message. */
  receive(m: unknown) {
    for (const f of this.msgL) (f as (x: unknown) => void)(m)
  }
  /** Disconnection by the browser (with `lastError`). */
  drop(message: string, fake: FakeChrome) {
    fake.lastError = { message }
    for (const f of this.discL) (f as (x: unknown) => void)(this)
    fake.lastError = undefined
  }
}

export class FakeChrome {
  ports: FakePort[] = []
  lastError: { message: string } | undefined
  local = new Map<string, unknown>()
  session = new Map<string, unknown>()
  cookies = new Map<string, string>()
  menus: { id: string; parentId?: string; title: string }[] = []
  reloads = 0
  granted = true
  /** Non-existent native host names (connection → disconnection "not found"). */
  missingHosts = new Set<string>()

  private store(map: Map<string, unknown>) {
    return {
      get: (k?: string | string[]) => {
        const keys = k === undefined ? [...map.keys()] : Array.isArray(k) ? k : [k]
        return Promise.resolve(
          Object.fromEntries(keys.filter((x) => map.has(x)).map((x) => [x, map.get(x)])),
        )
      },
      set: (o: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(o)) map.set(k, v)
        return Promise.resolve()
      },
      remove: (k: string) => {
        map.delete(k)
        return Promise.resolve()
      },
    }
  }

  api() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    return {
      runtime: {
        id: 'test',
        get lastError() {
          return self.lastError
        },
        connectNative(name: string) {
          const p = new FakePort(name)
          self.ports.push(p)
          if (self.missingHosts.has(name)) {
            queueMicrotask(() => p.drop('Specified native messaging host not found.', self))
          }
          return p
        },
        reload: () => {
          self.reloads += 1
        },
        getManifest: () => ({ version: '1.0.0' }),
      },
      storage: { local: this.store(this.local), session: this.store(this.session) },
      cookies: {
        get: ({ name }: { url: string; name: string }) =>
          Promise.resolve(self.cookies.has(name) ? { name, value: self.cookies.get(name) } : null),
        getAll: () => Promise.resolve([...self.cookies].map(([name, value]) => ({ name, value }))),
      },
      permissions: { contains: () => Promise.resolve(self.granted) },
      contextMenus: {
        removeAll: () => {
          self.menus = []
          return Promise.resolve()
        },
        create: (o: { id: string; parentId?: string; title: string }) => {
          self.menus.push({
            id: o.id,
            title: o.title,
            ...(o.parentId ? { parentId: o.parentId } : {}),
          })
        },
      },
      tabs: { query: () => Promise.resolve([]) },
    }
  }

  install(): void {
    ;(globalThis as Record<string, unknown>).chrome = this.api()
  }
}

export function lastPort(f: FakeChrome): FakePort {
  const p = f.ports.at(-1)
  if (!p) throw new Error('aucun port')
  return p
}
