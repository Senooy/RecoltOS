/** Vrai si la galerie est demandée : `?gallery=1`, en développement seulement (jamais en production). */
export function isGalleryRequested(
  search: string = typeof location === 'undefined' ? '' : location.search,
  dev: boolean = import.meta.env.DEV,
): boolean {
  return dev && new URLSearchParams(search).get('gallery') === '1'
}
