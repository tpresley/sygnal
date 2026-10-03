// Throwaway: Zag.js (framework-agnostic UI state machines, the core of Ark UI) rendered with Sygnal JSX.
// The machine lives on the host element; its UI renders through a private snabbdom patch (like Portal);
// machine callbacks (onOpenChange, onValueChange...) become CustomEvents on the host for intent.
import { VanillaMachine, normalizeProps } from '@zag-js/vanilla'
import { init, attributesModule, propsModule, classModule, styleModule, eventListenersModule, datasetModule, h } from 'snabbdom'

const patch = init([attributesModule, propsModule, classModule, styleModule, eventListenersModule, datasetModule])
const PROPS = new Set(['value', 'checked', 'defaultValue'])

// Zag prop bag → snabbdom data ({ attrs, on, props, style }); spread into Sygnal JSX: <button {...zp(api.getTriggerProps())}>
export function zp(bag) {
  const attrs = {}, on = {}, props = {}, style = {}
  for (const [k, v] of Object.entries(bag)) {
    if (k.startsWith('on') && typeof v === 'function') on[k.slice(2)] = v
    else if (k === 'style') Object.assign(style, typeof v === 'object' ? v : {})
    else if (k === 'class') attrs.class = v
    else if (PROPS.has(k)) props[k] = v
    else attrs[k] = v === undefined ? false : v
  }
  return { attrs, on, props, style }
}

let uid = 0
export function zagWidget({ machine, connect }, { props = {}, events = [], render, className, key }) {
  const userProps = (elm) => {
    const p = {}
    for (const name of events) p[name] = (d) => elm.dispatchEvent(new CustomEvent(name, { detail: d, bubbles: true }))
    return p
  }
  return {
    sel: 'div', key, children: undefined, text: undefined, elm: undefined, data: {
      props: className ? { className } : {},
      hook: {
        insert: (v) => {
          const elm = v.elm, id = `zag-${++uid}`
          let current = { props, render }
          const m = new VanillaMachine(machine, () => ({ id, ...current.props, ...userProps(elm) }))
          let vnode = elm.appendChild(document.createElement('div'))
          const draw = () => { const a = connect(m.service, normalizeProps);  vnode = patch(vnode, h('div', {}, [current.render(connect(m.service, normalizeProps))])) }
          m.subscribe(draw); m.start(); draw()
          elm.__zag = { m, draw, set: (p, r) => { current = { props: p, render: r }; m.updateProps(() => ({ id, ...p, ...userProps(elm) })); draw() } }
        },
        postpatch: (old, v) => {  v.elm.__zag = old.elm.__zag; v.elm.__zag.set(props, render) },
        destroy: (v) => v.elm.__zag?.m.stop(),
      },
    },
  }
}
