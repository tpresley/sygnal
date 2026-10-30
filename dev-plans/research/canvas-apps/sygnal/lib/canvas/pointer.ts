/**
 * A canvas pointer event as plain data, for intents: `DOM.select('.board').events('pointerdown').map(pointer)`.
 * Plain data so reducers stay pure and the action log / replay / a worker can carry it.
 *
 * `part`: the `data-part` of the element hit (a handle: `<rect data={{ part: 'se' }} …>`), or null.
 */
export type Pointer = {
  x: number, y: number,          // world
  sx: number, sy: number,        // canvas pixels
  hit: any,                      // a data layer node's id, or null
  part: string | null,           // data-part of the JSX node hit
  shift: boolean, alt: boolean, mod: boolean, button: number,
}

const isMac = typeof navigator != 'undefined' && /Mac|iP/.test(navigator.platform || navigator.userAgent)

export function pointer(e: any): Pointer {
  const w = e.world || {x: 0, y: 0}, s = e.screen || {x: 0, y: 0}
  return {
    x: w.x, y: w.y, sx: s.x, sy: s.y,
    hit: e.hit ?? null,
    part: e.target?.dataset?.part ?? e.target?.getAttribute?.('data-part') ?? null,
    shift: !!e.shiftKey, alt: !!e.altKey, mod: !!(isMac ? e.metaKey : e.ctrlKey), button: e.button || 0,
  }
}
