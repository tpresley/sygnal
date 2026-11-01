/**
 * The camera: sygnal/canvas's `follow()` after each step, the way Phaser's `startFollow` or
 * Godot's Camera2D would: a dead zone around the player, placed a little behind the centre the way
 * the player faces (a look-ahead), eased horizontally, clamped to the level, whole pixels. A pure
 * function of the world, so a replay sees the same camera; `follow` returns the same object while
 * the camera stays put, so the canvas repaints nothing for it.
 */
import {follow} from 'sygnal/canvas'
import {TILE, VIEW_W, VIEW_H} from './level'
import type {World} from './sim'

export function track(w: World): World {
  const p = w.player
  const camera = follow(w.camera, {x: p.x, y: p.y, width: p.w, height: p.h}, {
    width: VIEW_W, height: VIEW_H,
    deadzone: {width: VIEW_W * 0.16, height: VIEW_H},
    offset: {x: p.facing > 0 ? -VIEW_W * 0.08 : 0},
    lerp: [0.2, 1],
    bounds: {x0: 0, y0: 0, x1: w.rows[0].length * TILE, y1: VIEW_H},
    round: true,
  })
  return camera === w.camera ? w : {...w, camera}
}
