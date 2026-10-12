/**
 * Typage des catalogues : le catalogue anglais est DÉRIVÉ du français (`Widen<typeof fr>`).
 * Les littéraux deviennent `string`, les fonctions gardent leurs paramètres et renvoient `string` :
 * une clé manquante ou en trop dans le catalogue anglais est une erreur de compilation.
 */
export type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends readonly unknown[]
      ? { readonly [K in keyof T]: Widen<T[K]> }
      : T extends object
        ? { readonly [K in keyof T]: Widen<T[K]> }
        : T
