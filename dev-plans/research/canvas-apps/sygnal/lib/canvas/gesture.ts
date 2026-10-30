/**
 * A press-drag-release gesture as state (sygnal/canvas proposal): the model owns it, so undo,
 * the action log and replay see every step. Plain data, pure functions.
 *
 *   DOWN: (s, p) => ({ ...s, gesture: gesture.start('move', p, { before: s.doc }) }),
 *   MOVE: (s, p) => s.gesture ? { ...s, gesture: gesture.move(s.gesture, p, s.camera.zoom) } : ABORT,
 *   UP:   (s) => ({ ...s, gesture: null }),
 */
import type {Pt} from './geometry'

export type Gesture<D = any> = {kind: string, from: Pt, at: Pt, moved: boolean, shift: boolean, alt: boolean} & D

export const gesture = {
  start<D>(kind: string, p: Pt & {shift?: boolean, alt?: boolean}, data?: D): Gesture<D> {
    return {kind, from: {x: p.x, y: p.y}, at: {x: p.x, y: p.y}, moved: false, shift: !!p.shift, alt: !!p.alt, ...(data as any)}
  },
  /** the pointer moved: `moved` turns true past `slop` screen pixels (a click that jitters is no drag) */
  move<G extends Gesture>(g: G, p: Pt & {shift?: boolean, alt?: boolean}, zoom = 1, slop = 3): G {
    const moved = g.moved || Math.hypot(p.x - g.from.x, p.y - g.from.y) * zoom > slop
    return {...g, at: {x: p.x, y: p.y}, moved, shift: !!p.shift, alt: !!p.alt}
  },
  delta: (g: Gesture) => ({dx: g.at.x - g.from.x, dy: g.at.y - g.from.y}),
}
