/**
 * Styles par défaut des nœuds Spaces (SPACES §1.2.3, DESIGN §3.11), partagés par le main
 * (`addItems`, assets, import des boards) et l'éditeur.
 */
import type { z } from 'zod'
import type { ImageStyle, ItemStyle, NoteStyle, ShapeStyle, TextStyle } from './spaces-schema'

export type ItemStyleV = z.output<typeof ItemStyle>
export type ImageStyleV = z.output<typeof ImageStyle>
export type NoteStyleV = z.output<typeof NoteStyle>
export type ShapeStyleV = z.output<typeof ShapeStyle>
export type TextStyleV = z.output<typeof TextStyle>
export type ShapeKind = ShapeStyleV['kind']

export const defaultItemStyle = (): ItemStyleV => ({
  fit: 'cover',
  radius: 8,
  border: false,
  lockAspect: true,
})

export const defaultImageStyle = (a: {
  mime: string
  naturalWidth: number
  naturalHeight: number
  kind: 'image' | 'video'
}): ImageStyleV => ({
  fit: 'cover',
  radius: 8,
  border: false,
  lockAspect: true,
  mime: a.mime,
  naturalWidth: a.naturalWidth,
  naturalHeight: a.naturalHeight,
  kind: a.kind,
})

export const defaultNoteStyle = (): NoteStyleV => ({ color: 'yellow', fontSize: 14, align: 'left' })

export const defaultShapeStyle = (kind: ShapeKind = 'rect'): ShapeStyleV => ({
  kind,
  fill: null,
  fillAlpha: 1,
  stroke: 'ink',
  strokeWidth: 2,
  dash: 'solid',
  radius: kind === 'rect' ? 4 : 0,
  fontSize: 14,
  textColor: 'ink',
})

export const defaultTextStyle = (): TextStyleV => ({
  fontSize: 24,
  weight: 400,
  font: 'sans',
  color: 'ink',
  align: 'left',
  autoWidth: true,
})
