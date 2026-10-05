/**
 * PLAN-4 CT-1, runtime control checks (dev entry only; the static ones are in sygnal-check).
 *
 * SYG124 (error): a component passed where a control or selector is expected, as in
 *   `DOM.click(TodoItem)` or `DOM.select(TodoItem)`. Mechanism: the `sources` hook wraps the
 *   component's DOM source in a Proxy; `select()` (also chained: `DOM.select('.x').select(C)`)
 *   and every event shorthand check their first argument. A function that isn't a control is a
 *   component. Reported once per component and argument; the call then goes on to the DOM
 *   source, whose select() still throws ("expects the argument to be a string").
 *
 * SYG125 (error): controls are elements, not components.
 *   - a control given `.intent`, `.model` or `.initialState` (reported when it first renders,
 *     the statics are set after controls() returns);
 *   - a spec object whose `vnode()` returns anything but one element vnode (text, nothing, an
 *     array, a component). With diagnostics on, the render then throws an Error with the
 *     SYG125 text, so the component's error boundary names the control instead of failing on
 *     the stamp.
 *   Mechanism: controls() (src/extra/controls.ts) calls `__SYGNAL_DIAGNOSTICS__.control(control,
 *   vnode)` on every render; installControlHooks() publishes it on the core bridge.
 *
 * The same hook remembers which control rendered each vnode (controlOfVnode), so inspect() can
 * list a component's controls with their element or kind.
 */
import type {DiagnosticCheck} from '../index'
import {bridge, devReport, once, onReset, nameOf, report} from './shared'
import {DEV_CODE_SEVERITY} from '../codes'

/** the key of a control, from its selector `[data-control="<Key>"]` */
export const controlKey = (control: any): string => String(control).slice(15, -2)

/** a control selector `[data-control="<Key>"]` as its key, else undefined */
export const keyOfSelector = (selector: string): string | undefined => {
  const m = /^\[data-control="([^"]+)"\]$/.exec(selector)
  return m ? m[1] : undefined
}

const isControl = (x: any): boolean => typeof x == 'function' && !!x.__sygnalControl

const componentName = (fn: any): string =>
  fn.componentName || fn.label || fn.name || 'the component'

let vnodeControls = new WeakMap<object, any>()
let staticsSeen = new WeakSet<object>()
onReset(() => {
  vnodeControls = new WeakMap()
  staticsSeen = new WeakSet()
})

/** the control that rendered a vnode (only while the dev entry is installed) */
export const controlOfVnode = (vnode: any): any =>
  vnode && typeof vnode == 'object' ? vnodeControls.get(vnode) : undefined

const STATICS = ['intent', 'model', 'initialState']

const describe = (v: any): string =>
  v === undefined || v === null ? String(v)
  : Array.isArray(v) ? `an array of ${v.length}`
  : typeof v != 'object' ? `a ${typeof v} (${JSON.stringify(v)})`
  : typeof v.sel != 'string' ? (v.text !== undefined ? 'a text vnode' : 'a fragment')
  // the pragma's component placeholder (the component function in data.c)
  : v.data && typeof v.data.c == 'function' ? `the component <${v.sel}>`
  : 'an element vnode'

function onControl(control: any, vnode: any): void {
  const key = controlKey(control)
  if (vnode && typeof vnode == 'object') vnodeControls.set(vnode, control)

  if (!staticsSeen.has(control)) {
    staticsSeen.add(control)
    const given = STATICS.filter(s => control[s] != null)
    if (given.length) {
      devReport('SYG125', {
        message: `The control ${key} has ${given.map(s => '.' + s).join(', ')}, but controls are elements, not components: ${given.length > 1 ? 'these statics are' : 'it is'} never used`,
        fix: `Put the intent and model on the component that renders <${key}>, and listen to the control in its intent: DOM.click(${key}). For something with its own state and actions, write a component instead`,
        data: {control: key, statics: given},
      })
    }
  }

  const what = describe(vnode)
  if (what == 'an element vnode') return
  const kind = control.kind
  // report() (not devReport): in 'error' mode its DiagnosticError is thrown into the render
  const d = report('SYG125', {
    severity: DEV_CODE_SEVERITY.SYG125,
    message: `The control ${key}'s spec${kind ? ` (kind '${kind}')` : ''} vnode() returned ${what}, but it must return one element vnode`,
    fix: `Return a single element built with the h argument: vnode(props, children, h) { return h('div', props, ...children) }`,
    data: {control: key, kind, returned: what},
  })
  if (d) throw new Error(d.text)
}

/** Publish the control hook on the core bridge. Returns an uninstall function. */
export function installControlHooks(): () => void {
  const core = bridge()
  if (!core) return () => {}
  core.control = onControl
  return () => { if (core.control === onControl) core.control = undefined }
}

const wrapped = new WeakMap<object, any>()

/** a DOM source whose select() and event shorthands report SYG124 for a component argument */
function checkedDOM(component: any, dom: any): any {
  if (!dom || typeof dom != 'object') return dom
  let proxy = wrapped.get(dom)
  if (proxy) return proxy
  proxy = new Proxy(dom, {
    get(t: any, k: any) {
      const v = t[k]
      if (typeof k != 'string' || typeof v != 'function' || (k != 'select' && k in t)) return v
      return function (this: any, arg: any, ...rest: any[]) {
        if (typeof arg == 'function' && !isControl(arg)) {
          const name = nameOf(component), child = componentName(arg)
          if (once(`SYG124:${name}:${child}:${k}`)) {
            const call = k == 'select' ? `DOM.select(${child})` : `DOM.${k}(${child})`
            devReport('SYG124', {
              component,
              message: `${name}.intent passes the component ${child} to ${call}, but a component is not an element: it has no element of its own to listen on, and its elements are isolated from ${name}`,
              fix: `Handle the event in ${child} and send it up with PARENT, then read it here with CHILD.select(${child}); or render a control ${name} owns around it: const { ${child}Box } = controls({ ${child}Box: 'div' }), <${child}Box><${child} /></${child}Box>, DOM.click(${child}Box)`,
              data: {component: child, method: k},
            })
          }
        }
        const out = v.call(t, arg, ...rest)
        return k == 'select' ? checkedDOM(component, out) : out
      }
    },
  })
  wrapped.set(dom, proxy)
  return proxy
}

export const controlsCheck: DiagnosticCheck = {
  id: 'controls',

  sources(component, sources) {
    if (!sources || typeof Proxy != 'function') return
    const domName = component?.DOMSourceName || 'DOM'
    if (!sources[domName]) return
    return new Proxy(sources, {
      get(t: any, k: any) {
        const v = t[k]
        return k === domName ? checkedDOM(component, v) : v
      },
    })
  },
}
