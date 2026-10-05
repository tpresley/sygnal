/*
 * 'sygnal/zag' (PLAN-5 W-2, D203): `fromZag(zag, render, options)`, a Zag.js machine as a widget
 * tag (defineWidget). Generalises experiment E3.
 *
 *   import * as menu from '@zag-js/menu'
 *   export const Actions = fromZag(menu, (api, props) => (
 *     <div>
 *       <button {...api.getTriggerProps()}>{props.label}</button>
 *       <div {...api.getPositionerProps()}>
 *         <div {...api.getContentProps()}>
 *           {props.items.map((i) => <div {...api.getItemProps({ value: i.value })}>{i.label}</div>)}
 *         </div>
 *       </div>
 *     </div>
 *   ), { events: { select: ['onSelect', (d) => d.value] }, commands: { open: (api) => api.setOpen(true) } })
 *   // view:   <Actions className="actions" label="Actions" items={ITEMS} />
 *   // intent: PICK: DOM.select('.actions').events('select').detail()
 *
 * - The machine runs on @zag-js/vanilla's VanillaMachine (an optional peer, pinned ~1.45.0 with
 *   the machine packages: Zag's packages depend on each other's exact versions). One per host.
 * - Props: the machine's props are a getter over the newest widget props (`options.props(p, x)`
 *   maps them; by default they pass as they are), memoised per render and per `x.refresh()`. A
 *   render with other props sets them and notifies the machine, so its watchers see controlled
 *   props (`open`, `value`) change. No props are captured at mount (E3's stale-props bug).
 *   VanillaMachine.updateProps is not used: it merges into the previous props (a removed prop
 *   stays) and wraps the previous getter on every call.
 * - Zag's prop getters are normalised for snabbdom (`zagProps`): `{ attrs, on, props, style }`,
 *   which a JSX spread routes to those modules. `render(api, props, x)` returns one vnode (an
 *   array is wrapped in a `display: contents` div), patched into the host by a private snabbdom
 *   patch (the host is opaque to the app's patch). It re-runs when the machine notifies and when
 *   the props change.
 * - Machine callbacks become dispatched DOM events on the host: `events: { name: 'onX' }` (detail:
 *   Zag's details object) or `{ name: ['onX', (details, x) => detail] }`; `{ name: null }` only
 *   declares it (a callback from the props mapping dispatches it with `x.dispatch`). A callback
 *   the props mapping also returns runs first.
 * - Commands: `commands: { open: (api, options, x) => api.setOpen(true) }` (D102 element commands).
 * - The instance (`t.widget(sel).instance` with `dom: 'real'`) is `x`: `{ el, api(), machine,
 *   refresh() }` plus whatever the part keeps on it.
 * - Wrong arguments throw SYG667 when the widget is defined.
 *
 * Separate entry: rollup turns './index' into the external 'sygnal' and keeps snabbdom and
 * @zag-js/* external (D209), so importing 'sygnal' or 'sygnal/ui' never needs Zag.
 */
import {VanillaMachine} from '@zag-js/vanilla'
import {init} from 'snabbdom/build/init.js'
import {h} from 'snabbdom/build/h.js'
import {classModule} from 'snabbdom/build/modules/class.js'
import {propsModule} from 'snabbdom/build/modules/props.js'
import {attributesModule} from 'snabbdom/build/modules/attributes.js'
import {datasetModule} from 'snabbdom/build/modules/dataset.js'
import {eventListenersModule} from 'snabbdom/build/modules/eventlisteners.js'
import {styleModule} from './cycle/dom/styleModule'
import {defineWidget} from './index'

const patch = init([classModule, propsModule, attributesModule, datasetModule, styleModule, eventListenersModule])

// React-style event props whose DOM event has another name (as @zag-js/vanilla's normalizeProps)
const EV: any = {Focus: 'focusin', Blur: 'focusout', Change: 'input', DoubleClick: 'dblclick'}
const NAME: any = {htmlFor: 'for', className: 'class'}
// enumerated attributes whose false must be written, not removed
const STR = /^(aria-|spellcheck$|draggable$|contenteditable$)/i

/**
 * One Zag prop bag (`api.getTriggerProps()` with any normaliser, or raw) as snabbdom data
 * `{ attrs, on, props, style }`: `onX` handlers to `on` (onChange → input, onFocus → focusin, …),
 * `value` / `checked` (and their `default…`) to `props`, `style`, and the rest to `attrs` (names
 * lowercased, htmlFor → for; an ARIA boolean as "true" / "false"; false removes the attribute).
 */
export const zagProps = (bag: any): any => {
  const attrs: any = {}, on: any = {}, props: any = {}, style: any = {}
  for (const k in bag) {
    const v = bag[k]
    if (v === undefined) continue
    if (typeof v == 'function' && /^on[A-Z]/.test(k)) on[EV[k.slice(2)] || k.slice(2).toLowerCase()] = v
    else if (k == 'style') Object.assign(style, v)
    else if (/^(default)?(value|checked|Value|Checked)$/.test(k)) props[k.replace(/^default(.)/, (_, c) => c.toLowerCase())] = v
    else attrs[NAME[k] || (/^(viewBox|preserveAspectRatio)$/.test(k) ? k : k.toLowerCase())] = typeof v == 'boolean' && STR.test(k) ? '' + v : v
  }
  return {attrs, on, props, style}
}

// Zag's normaliser shape (@zag-js/types createNormalizer): every element kind maps through zagProps
const normalize: any = new Proxy({}, {get: (_, k) => (k == 'style' ? (s: any) => ({...s}) : zagProps)})

const fail = (m: string): never => {
  throw new Error(`[Sygnal SYG667] ${m}. https://sygnal.js.org/reference/errors#syg667`)
}

let ids = 0

function start(zag: any, render: any, o: any, el: any, p0: any, dispatch: any): any {
  let props = p0, memo: any, on = 1, busy = 0, again = 0
  let vn: any = el.appendChild(document.createElement('div'))
  const id = p0.id ?? 'sygnal-zag-' + ++ids
  // the instance (the part's per-instance fields too); the props mapping gets it from the start
  const x: any = {el, dispatch}
  // the events' callbacks: dispatch on the host
  const cbs: any = {}
  for (const name in o.events) {
    const [cb, map] = ([] as any[]).concat(o.events[name])
    // null: declared only (the part dispatches it with x.dispatch)
    if (!cb) continue
    const prev = cbs[cb]
    cbs[cb] = (d: any) => { prev?.(d); dispatch(name, map ? map(d, x) : d) }
  }
  // the machine's props: the newest widget props, mapped (memoised until the next render or refresh)
  const machineProps = () => {
    if (memo) return memo
    const mp = o.props ? o.props(props, x) : props
    const out: any = {...mp, id, getRootNode: () => (el.isConnected ? el.getRootNode() : document)}
    for (const cb in cbs) {
      const u = mp[cb]
      out[cb] = u ? (d: any) => { u(d); cbs[cb](d) } : cbs[cb]
    }
    return (memo = out)
  }
  // notify(): a public field of VanillaMachine (typed private), the one way to re-run its watchers
  // without updateProps (Zag pinned ~1.45.0; the tests cover it)
  const m: any = new VanillaMachine(zag.machine, machineProps)
  const api = () => zag.connect(m.service, normalize)
  const draw = () => {
    if (!on) return
    if (busy) return void (again = 1)
    busy = 1
    try {
      do {
        again = 0
        const out = render(api(), props, x)
        vn = patch(vn, Array.isArray(out) ? h('div', {style: {display: 'contents'}}, out) : out || h('!', ''))
      } while (again && on)
    } finally { busy = 0 }
  }
  Object.assign(x, {
    machine: m,
    api,
    refresh: () => { memo = 0; m.notify() },
    set: (p: any) => { props = p; x.refresh() },
    stop: () => {
      if (!on) return
      on = 0
      m.stop()
      // the rendered content's destroy hooks (refs in the render) run; the host is leaving anyway
      vn = patch(vn, h('!', ''))
    },
  })
  m.subscribe(draw)
  draw()
  m.start()
  draw()
  return x
}

/**
 * A Zag machine as a widget tag: `fromZag(zag, render, options)` where `zag` is a machine package
 * (`import * as menu from '@zag-js/menu'`: its `machine` and `connect`), `render(api, props, x)`
 * renders its parts with the prop getters spread (`<button {...api.getTriggerProps()}>`).
 * Options: `events` (dispatched name → Zag callback, or [callback, details → detail]), `props`
 * ((widgetProps, x) → machine props), `commands` ((api, options, x) → …), and defineWidget's
 * `tag`, `name`, `fallback`, `hostProps`.
 */
export function fromZag(zag: any, render: any, options: any = {}): any {
  if (!zag || !zag.machine || typeof zag.connect != 'function') fail('fromZag(zag, render): the first argument is not a Zag machine package (import * as menu from \'@zag-js/menu\')')
  if (typeof render != 'function') fail('fromZag(zag, render): render must be a function (api, props) => vnode')
  const o = options, commands: any = {}
  for (const c in o.commands) commands[c] = (x: any, opt: any) => o.commands[c](x.api(), opt, x)
  return defineWidget({
    tag: o.tag,
    name: o.name,
    fallback: o.fallback,
    hostProps: o.hostProps,
    events: Object.keys(o.events || {}),
    commands,
    mount: (el: any, p: any, dispatch: any) => start(zag, render, o, el, p, dispatch),
    update: (x: any, p: any) => x.set(p),
    unmount: (x: any) => x.stop(),
  })
}
