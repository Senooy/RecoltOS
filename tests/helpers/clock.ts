/** Horloge injectable (QA §5.1 : « horloge injectée ») : avance à la demande, jamais d'`Date.now()` implicite. */
export interface FakeClock {
  now: () => number
  advance: (ms: number) => number
  set: (ms: number) => void
}

export function makeClock(start = Date.UTC(2026, 8, 24, 12, 0, 0)): FakeClock {
  let t = start
  return {
    now: () => t,
    advance: (ms) => (t += ms),
    set: (ms) => {
      t = ms
    },
  }
}
