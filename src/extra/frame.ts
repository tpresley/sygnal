/**
 * The frame phase (canvas-game B2): a `frame` timer delivers its actions from inside a
 * requestAnimationFrame callback, and the flush they cause runs in that callback's microtasks. A
 * widget that paints on requestAnimationFrame and asks for one from that flush gets the next
 * frame, and the frame after skips (the next request is for the one after): it painted every
 * other frame. So the timer driver marks the frame (`frameBegin` before its actions,
 * `frameEnd` after), and a widget asks `atFrameEnd(paint)` first: inside a frame, the paint runs at
 * the end of this frame's microtasks (after the flush), in the frame the state changed.
 *
 * The state is on a global symbol: the timer driver (main bundle) and sygnal/canvas,
 * sygnal/three (their own bundles) share it without an export. 0 B in the core.
 */
type Phase = {depth: number, count: number, paints: Set<() => void>, ends: Set<() => void>}
const K = Symbol.for('sygnal.frame')
const phase = (): Phase => (globalThis as any)[K] || ((globalThis as any)[K] = {depth: 0, count: 0, paints: new Set(), ends: new Set()})

/** frame actions are about to be delivered (the timer driver's animation frame callback) */
export function frameBegin() { phase().depth++ }

/** inside a frame (its actions, the flush they cause, its paints): renderComponent's settle() ignores it */
export const inFrame = () => phase().depth > 0

/** frames ended so far, and a listener for each frame's end (renderComponent's t.frames) */
export const frameCount = () => phase().count
export function onFrameEnd(f: () => void): () => void {
  const e = phase().ends
  e.add(f)
  return () => e.delete(f)
}

/**
 * after the frame's actions: a microtask (queued after the flush their state writes scheduled)
 * that runs the paints widgets asked for meanwhile
 */
export function frameEnd() {
  queueMicrotask(() => {
    const f = phase()
    if (--f.depth > 0) return
    f.depth = 0
    const ps = [...f.paints]
    f.paints.clear()
    for (const p of ps) try { p() } catch (e) { queueMicrotask(() => { throw e }) }
    f.count++
    for (const e of [...f.ends]) e()
  })
}

/** a widget's paint: queued for the end of the current frame (true), or not inside one (false: request a frame as usual) */
export function atFrameEnd(paint: () => void): boolean {
  const f = phase()
  if (!f.depth) return false
  f.paints.add(paint)
  return true
}
