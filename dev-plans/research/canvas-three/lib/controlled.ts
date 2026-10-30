/**
 * The controlled imperative value protocol: a value both the app (a prop, from state) and the
 * widget itself (the user drags the camera, types in the editor, pans the map) can change, with
 * no echo loops and no stale overwrites.
 *
 *   const c = controlled({ write: (v) => editor.setText(v), equals })
 *   // the widget changed by itself:      c.local(v); emit('change', v)
 *   // a render passed the prop:          c.prop(props.value)
 *   // (optional) a frame after local():  c.settle(props.value)   → reverts an edit the app rejected
 *
 * Rules (the RN TextInput bridge needed the same, with event counts):
 * 1. A render writes only when the prop *changed* since the last render. Re-renders for other
 *    reasons never push an old value over newer user input.
 * 2. A changed prop equal to a value the widget emitted itself is its echo (perhaps late, while
 *    the user has moved on): not written. Echoes up to it are dropped.
 * 3. Any other changed prop is the app's (a reset, a clamp, a transform): written, and the
 *    pending echoes are dropped.
 * 4. Rejection: an emitted value the app ignored (the prop didn't move at all) stays in the
 *    widget unless the island calls settle() after the app had its turn (a frame); then the
 *    prop wins. Off by default: most islands are "controlled at the edges" (state follows the
 *    widget), and settle() is for strict validation.
 *
 * write() must not report back as a local change (the island suppresses its own writes: a
 * CodeMirror annotation, a flag around map.setView).
 */
export interface Controlled<T> {
  local(v: T): void
  prop(v: T): boolean
  settle(v: T): boolean
  /** values emitted and not yet seen back */
  pending(): readonly T[]
  stats: {writes: number, echoes: number, reverts: number}
}

export function controlled<T>({write, equals = Object.is, max = 64}: {write: (v: T) => void, equals?: (a: T, b: T) => boolean, max?: number}): Controlled<T> {
  let queue: T[] = [], lastProp: any = undefined, has = false, current: any, dirty = false
  const stats = {writes: 0, echoes: 0, reverts: 0}
  const put = (v: T) => { queue = []; current = v; write(v); stats.writes++ }
  return {
    stats,
    pending: () => queue,
    local(v) {
      queue.push(v)
      if (queue.length > max) queue.shift()
      current = v
      dirty = true
    },
    prop(v) {
      if (has && equals(v, lastProp)) return false
      has = true
      lastProp = v
      dirty = false
      const i = queue.findIndex(q => equals(q, v))
      if (i >= 0) { queue.splice(0, i + 1); stats.echoes++; return false }
      if (current !== undefined && equals(v, current)) { queue = []; return false }
      put(v)
      return true
    },
    settle(v) {
      if (!dirty) return false
      dirty = false
      if (has && equals(v, lastProp) && current !== undefined && !equals(v, current)) { put(v); stats.reverts++; return true }
      return false
    },
  }
}
