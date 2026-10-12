// A minimal Sygnal renderer for a json-render Spec (prototype).
//
//   const SpecView = createSpecView({ components })
//   <SpecView spec={state.spec} state="ui" />           host: CHILD.select(SpecView) → { action, params, key, event }
//
// The json-render state model IS the SpecView's Sygnal state slice ("ui" above): $state / $bindState
// pointers resolve against it, and `setState` / `pushState` / `removeState` are STATE reducers here.
// Every other action goes up to the host with PARENT, so the host decides (its own model, HTTP, EVENTS...).
//
// Two kinds of registry entries:
//   - a view part: a plain function ({ props, children, slots, on, bind, key }) => vnode. It is part of
//     SpecView's own JSX, so SpecView's intent hears its DOM events through attributes it spreads:
//       on('press')            → { 'data-jr-click': '<key>:press' }   (click)
//       on('submit', 'submit') → { 'data-jr-submit': '<key>:submit' }
//       bind('value')          → { 'data-jr-bind': '/form/name' }     (input → setState at that pointer)
//   - a component part: an ordinary Sygnal component (it has .intent / .model). Its $bindState props become
//     its state (a lens: { [prop]: value }, written back by pointer), its plain props are props, its children
//     are `children`; it raises spec events with `PRESS: { PARENT: emit('press') }`.

import { ABORT, xs, Slot } from 'sygnal'
import {
  resolveElementProps,
  resolveBindings,
  resolveActionParam,
  evaluateVisibility,
  getByPath,
  setByPath,
  removeByPath,
} from '../vendor/json-render-core.mjs'

const isComponentPart = (fn) => typeof fn === 'function' && (fn.intent || fn.model)

/** for a component part's model: `PRESS: { PARENT: emit('press') }` */
export const emit = (event, data = (state, d) => d) => (state, d, next, props) => ({
  jr: true,
  key: props.jrKey,
  event,
  data: data(state, d),
})

// state writes are immutable: copy, then apply json-render's (mutating) pointer helpers
const write = (state, fn) => {
  const copy = structuredClone(state)
  fn(copy)
  return copy
}

const BUILT_IN = {
  setState: (state, p) => write(state, (s) => setByPath(s, p.statePath, p.value)),
  pushState: (state, p) =>
    write(state, (s) => {
      const list = getByPath(s, p.statePath)
      setByPath(s, p.statePath, [...(Array.isArray(list) ? list : []), p.value])
      if (p.clearStatePath) setByPath(s, p.clearStatePath, '')
    }),
  removeState: (state, p) => write(state, (s) => removeByPath(s, `${p.statePath}/${p.index}`)),
}

export function createSpecView({ components, fallback } = {}) {
  const parts = Object.values(components).filter(isComponentPart)

  // the spec walk: one element → vnode (or null when hidden)
  function renderElement(spec, key, state, scope) {
    const element = spec.elements[key]
    if (!element) return null // streaming: a child that hasn't arrived yet
    const ctx = { stateModel: state, ...scope }
    if (element.visible !== undefined && !evaluateVisibility(element.visible, ctx)) return null
    const props = resolveElementProps(element.props || {}, ctx)
    const bindings = resolveBindings(element.props || {}, ctx) || {}
    const Part = components[element.type] || fallback
    if (!Part) return null

    const renderKeys = (keys, sc = scope) => (keys || []).map((k) => renderElement(spec, k, state, sc)).filter(Boolean)
    let children
    if (element.repeat) {
      const base = typeof element.repeat.statePath === 'string' ? element.repeat.statePath : null
      const items = base ? getByPath(state, base) : []
      children = (Array.isArray(items) ? items : []).flatMap((item, i) =>
        renderKeys(element.children, { repeatItem: item, repeatIndex: i, repeatBasePath: `${base}/${i}` }))
    } else children = renderKeys(element.children)
    const slots = Object.fromEntries(Object.entries(element.slots || {}).map(([name, keys]) => [name, renderKeys(keys)]))
    // repeat scope travels with the element so events inside a repeated child resolve $item / $index
    const scopeTag = scope.repeatBasePath ? `@${scope.repeatBasePath}` : ''

    if (isComponentPart(Part)) {
      const bound = Object.entries(bindings)
      const lens = {
        get: (s) => Object.fromEntries(bound.map(([prop, path]) => [prop, getByPath(s, path)])),
        set: (s, v) => write(s, (copy) => bound.forEach(([prop, path]) => {
          if (v?.[prop] !== getByPath(s, path)) setByPath(copy, path, v?.[prop])
        })),
      }
      const plain = Object.fromEntries(Object.entries(props).filter(([p]) => !(p in bindings)))
      // json-render named slots are Sygnal <Slot name> children (the child reads slots.header)
      const named = Object.entries(slots).map(([name, nodes]) => <Slot name={name}>{nodes}</Slot>)
      return <Part key={key} {...plain} jrKey={key + scopeTag} state={lens}>{children}{named}</Part>
    }
    return Part({
      key,
      props,
      children,
      slots,
      on: (event, domEvent = 'click') => ({ [`data-jr-${domEvent}`]: `${key}${scopeTag}:${event}` }),
      bind: (prop) => (bindings[prop] ? { 'data-jr-bind': bindings[prop] } : {}),
    })
  }

  function SpecView({ state, spec }) {
    if (!spec?.root) return <div className="jr-root jr-empty" />
    return <div className="jr-root">{renderElement(spec, spec.root, state, {})}</div>
  }

  const parse = (tag) => {
    const [where, event] = tag.split(':')
    const [key, base] = where.split('@')
    return { key, base, event }
  }

  SpecView.intent = ({ DOM, CHILD }) => ({
    SPEC_EVENT: xs.merge(
      DOM.click('[data-jr-click]').data('jrClick').map(parse),
      DOM.select('[data-jr-submit]').events('submit', { preventDefault: true }).data('jrSubmit').map(parse),
      xs.merge(...parts.map((P) => CHILD.select(P)))
        .filter((m) => m && m.jr)
        .map((m) => ({ ...parse(`${m.key}:${m.event}`), data: m.data })),
    ),
    BIND: DOM.input('[data-jr-bind]').map((e) => ({ path: e.target.dataset.jrBind, value: e.target.value })),
  })

  // the action bindings an event fires, params resolved against the state before the action
  const bindingsFor = (state, { key, base, event }, props) => {
    const element = props.spec?.elements?.[key]
    const raw = element?.on?.[event]
    if (!raw) return []
    const scope = base ? { repeatBasePath: base, repeatIndex: Number(base.split('/').pop()), repeatItem: getByPath(state, base) } : {}
    const ctx = { stateModel: state, ...scope }
    return (Array.isArray(raw) ? raw : [raw]).map((b) => ({
      action: b.action,
      params: Object.fromEntries(Object.entries(b.params || {}).map(([k, v]) => [k, resolveActionParam(v, ctx)])),
    }))
  }

  SpecView.model = {
    SPEC_EVENT: {
      // built-ins are reducers on this slice, applied in order
      STATE: (state, ev, next, props) => {
        const local = bindingsFor(state, ev, props).filter((b) => BUILT_IN[b.action])
        return local.length ? local.reduce((s, b) => BUILT_IN[b.action](s, b.params), state) : state
      },
      // everything else is the host's: one PARENT value per event (the first app action)
      PARENT: (state, ev, next, props) => {
        const app = bindingsFor(state, ev, props).filter((b) => !BUILT_IN[b.action])
        return app.length ? { key: ev.key, event: ev.event, actions: app, data: ev.data } : ABORT
      },
    },
    BIND: (state, { path, value }) => write(state, (s) => setByPath(s, path, value)),
  }

  return SpecView
}
