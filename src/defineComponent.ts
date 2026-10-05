/**
 * PLAN-4.6 (D162): `defineComponent(opts)` builds a component from an options object, for code
 * that makes components from data (generators, wrappers). It returns an ordinary function
 * component: a new function that calls `view` with the one view argument, with the other options
 * assigned as its statics. There is no separate instantiation path: the core reads the statics
 * like any function component's.
 *
 *   const Counter = defineComponent({ name: 'Counter', view, intent, model, initialState: { n: 0 } })
 *
 * `name` becomes `componentName` (diagnostics, devtools, uid()). The view function itself is not
 * changed, so one view can back several definitions.
 */
export function defineComponent(opts: Record<string, any>): any {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('defineComponent(opts): pass an options object, e.g. defineComponent({ view, model, initialState })')
  }
  const {view, name, ...statics} = opts
  if (typeof view !== 'function') {
    throw new TypeError(`defineComponent(${name ? `{ name: '${name}' }` : 'opts'}): view must be a function (the view: ({ state, context, ...props }) => vnode)`)
  }
  const C: any = (args: any) => view(args)
  const componentName = name || view.componentName || view.name
  if (componentName) {
    C.componentName = componentName
    try { Object.defineProperty(C, 'name', {value: componentName, configurable: true}) } catch (_) { /* name not configurable */ }
  }
  for (const k of Object.keys(statics)) if (statics[k] !== undefined) C[k] = statics[k]
  return C
}

export default defineComponent
