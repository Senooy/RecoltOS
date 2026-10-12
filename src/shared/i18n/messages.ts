/**
 * Typing of the catalogs: the English catalog is DERIVED from the French one (`Widen<typeof fr>`).
 * Literals become `string`, functions keep their parameters and return `string`:
 * a missing or extra key in the English catalog is a compilation error.
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
