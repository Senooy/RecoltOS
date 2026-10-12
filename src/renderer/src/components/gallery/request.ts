/** True if the gallery is requested: `?gallery=1`, in development only (never in production). */
export function isGalleryRequested(
  search: string = typeof location === 'undefined' ? '' : location.search,
  dev: boolean = import.meta.env.DEV,
): boolean {
  return dev && new URLSearchParams(search).get('gallery') === '1'
}
