/*
 * 'sygnal/react' (PLAN-5 W-2, D203): `fromReact(Component, { events })`, a React component as a
 * widget tag (defineWidget). An escape hatch for the one component you can't replace: context
 * and providers don't cross the boundary, a React portal renders outside the host, and the mock
 * DOM can't run it (test with `dom: 'real'`).
 *
 *   const Stars = fromReact(StarRating, { events: { rate: 'onChange' } })
 *   // view:   <Stars className="rating" value={state.rating} max={5} />
 *   // intent: RATE: DOM.select('.rating').events('rate').detail()
 *
 * - Each host is a React root (react-dom/client createRoot). `mount` and `update` render the
 *   component with the newest props in flushSync, so the DOM is up to date when they return.
 * - `events`: `{ eventName: 'onCallback' }`, or an array of callback names, each dispatched under
 *   its own name (`['onChange']` → 'onChange'; React's names never collide with native events).
 *   The detail is the callback's argument (an array when it gets more than one). The component
 *   gets a callback for each, and a callback passed as a prop runs first.
 * - Props: all but `className`, `class`, `id`, `style` and `attrs` (those are the host's); `props`
 *   maps them instead: `props: (p) => ({ ...p, size: 'small' })`.
 * - Unmount: `root.unmount()` in a microtask (React refuses a synchronous unmount while it is
 *   rendering, which a callback → action → re-render chain can be in).
 * - SSR: the host with the `fallback` (no React on the server here).
 * - preact/compat: alias `react` and `react-dom` to `preact/compat`, and `react-dom/client` to
 *   `preact/compat/client`, in the bundler; the adapter only uses createElement, createRoot and
 *   flushSync.
 *
 * Separate entry: './index' becomes the external 'sygnal'; react and react-dom stay external
 * (optional peerDependencies, D209).
 */
import {createElement} from 'react'
import {flushSync} from 'react-dom'
import {createRoot} from 'react-dom/client'
import {defineWidget} from './index'

const HOST = /^(className|class|id|style|attrs)$/

const fail = (m: string): never => {
  throw new Error(`[Sygnal SYG667] ${m}. https://sygnal.js.org/reference/errors#syg667`)
}

/**
 * A React component as a widget tag: `fromReact(Comp, { events, props, tag, name, fallback,
 * hostProps, commands })`. `commands` are called with the instance `{ root, el, props }`.
 */
export function fromReact(Comp: any, options: any = {}): any {
  if (typeof Comp != 'function' && !(Comp && typeof Comp == 'object' && Comp.$$typeof)) {
    fail('fromReact(Component): the first argument is not a React component')
  }
  const o = options, ev = o.events || {}
  // event name → callback prop name
  const events: Record<string, string> = Array.isArray(ev) ? Object.fromEntries(ev.map((c: string) => [c, c])) : ev
  const draw = (i: any, p: any) => {
    const q: any = {}
    for (const k in p) if (!HOST.test(k)) q[k] = p[k]
    const rp = o.props ? o.props(q) : q
    for (const name in events) {
      const cb = events[name], own = rp[cb]
      rp[cb] = (...a: any[]) => {
        own?.(...a)
        i.d(name, a.length > 1 ? a : a[0])
      }
    }
    i.props = rp
    flushSync(() => i.root.render(createElement(Comp, rp)))
  }
  return defineWidget({
    tag: o.tag,
    name: o.name || Comp.displayName || Comp.name,
    fallback: o.fallback,
    hostProps: o.hostProps,
    events: Object.keys(events),
    commands: o.commands,
    mount: (el: any, p: any, d: any) => {
      const i = {root: createRoot(el), el, d, props: null}
      draw(i, p)
      return i
    },
    update: draw,
    unmount: (i: any) => { queueMicrotask(() => i.root.unmount()) },
  })
}
