/**
 * Messages main ↔ utility processes (ARCHI §2.2 ; dérivés PLAN §1.6). Aucun worker n'ouvre la base.
 * Pas d'`EmbedOps` en V1 (ERRATA §G).
 */

export type WorkerRequest = { id: number; op: string; args: unknown }
export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { code: string; message: string; retryAt?: number } }
  | { id: number; progress: unknown }

export interface ZipEntry {
  /** Chemin absolu du fichier source. */
  abs: string
  /** Chemin dans l'archive. */
  name: string
}

export interface MediaOps {
  probeImage(a: { abs: string }): {
    width: number
    height: number
    mime: string
    isAnimated: boolean
    hasAlpha: boolean
  }
  probeVideo(a: { abs: string }): {
    width: number
    height: number
    durationMs: number
    hasAudio: boolean
    codec: string
    playable: boolean
  }
  /** HEIC/HEIF/PSD : `/usr/bin/sips -s format <jpeg|png> <src> --out <dst>`. */
  decodeForeign(a: { src: string; dst: string; format: 'jpeg' | 'png' }): {
    width: number
    height: number
  }
  /** `thumbs/` 800w webp q80. */
  makeThumb(a: { src: string; dst: string; width: 800 }): {
    width: number
    height: number
    bytes: number
  }
  /** `large/` 1440w webp. */
  makeLarge(a: { src: string; dst: string; width: 1440 }): {
    width: number
    height: number
    bytes: number
  }
  /** `posters/` jpg 1280 max. */
  makePoster(a: { src: string; dst: string; atMs: number }): { width: number; height: number }
  /** `previews/` mp4 540p ≤ 8 s muet (`h264_videotoolbox`, repli libx264). */
  makePreview(a: { src: string; dst: string; maxSeconds: 8; height: 540 }): {
    width: number
    height: number
    durationMs: number
    bytes: number
  }
  makeDisplay(a: { src: string; dst: string; maxEdge: 2048 }): { width: number; height: number }
  /** `avatars/<platform>/<k>.jpg` : carré 128 px, JPEG. */
  makeAvatar(a: { src: string; dst: string; size: 128 }): {
    width: number
    height: number
    bytes: number
  }
  palette(a: { src: string; k?: 8 }): {
    hex: string[]
    lab: [number, number, number][]
    share: number[]
  }
  toPng(a: { abs: string; maxEdge?: number }): { png: Uint8Array; width: number; height: number }
  hashFile(a: { abs: string }): { sha256: string; bytes: number }
  /** COPYFILE_FICLONE puis rename. */
  cloneFile(a: { src: string; dst: string }): { bytes: number }
  zipLibrary(a: { root: string; entries: ZipEntry[]; out: string }): { bytes: number }
  /** IA (AI §4) : JPEG q85 ≤ `maxEdge` (1568), sans métadonnées, fond blanc. */
  aiImage(a: { src: string; dst: string; maxEdge: number }): {
    width: number
    height: number
    bytes: number
  }
  /** IA (AI §4) : une image clé à `atMs` ou `fromEndMs` de la fin, JPEG ≤ `maxEdge` (1024). */
  extractFrame(a: {
    src: string
    dst: string
    atMs?: number
    fromEndMs?: number
    maxEdge: number
  }): { width: number; height: number; bytes: number }
}

export type MediaOp = keyof MediaOps
export type MediaArgs<O extends MediaOp> = Parameters<MediaOps[O]>[0]
export type MediaResult<O extends MediaOp> = ReturnType<MediaOps[O]>
