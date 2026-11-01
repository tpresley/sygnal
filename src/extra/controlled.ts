/**
 * canvas-three Q3 (experimental in 7.2): the controlled imperative value of a widget that declares
 * `value` (extra/widget.ts). Both the app (the `value` prop, from state) and the widget (the user
 * types, orbits, pans) change the value; no echo loops, no stale overwrites.
 * Research: dev-plans/research/canvas-three (§6).
 *
 * 1. The first prop is the baseline (the widget was made with it): not written.
 * 2. A render writes only when the prop changed since the last render: a re-render for anything
 *    else never pushes an old value over newer input.
 * 3. A changed prop equal to a value the widget reported (`local`) is its echo, perhaps a late
 *    one: not written; the echoes up to it are dropped.
 * 4. Any other changed prop is the app's (a reset, a clamp, a load): written, pending echoes dropped.
 * 5. settle(prop), when the app had its turn after a local change: a prop that never moved (the
 *    model rejected the edit) is written back (`strict`).
 */
export function controlled(write: (v: any) => void, equals: (a: any, b: any) => boolean = Object.is) {
  let q: any[] = [], last: any, has = 0, cur: any, dirty = 0
  const put = (v: any) => { q = []; cur = v; write(v); st.writes++ }
  const st = {writes: 0, echoes: 0, reverts: 0}
  return {
    st,
    local(v: any) {
      q.push(v)
      if (q.length > 64) q.shift()
      cur = v
      dirty = 1
    },
    prop(v: any) {
      if (!has) return void (has = 1, last = cur = v)
      if (equals(v, last)) return
      last = v
      dirty = 0
      const i = q.findIndex(x => equals(x, v))
      if (i >= 0) q.splice(0, i + 1), st.echoes++
      else if (equals(v, cur)) q = []
      else put(v)
    },
    settle(v: any) {
      if (!dirty) return
      dirty = 0
      if (equals(v, last) && !equals(v, cur)) put(v), st.reverts++
    },
  }
}
