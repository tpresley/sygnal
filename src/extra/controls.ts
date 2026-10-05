/**
 * controls(spec) (PLAN-4 CT-1): element tokens that link a view to its intent by identifier.
 *
 *   const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })
 *   <Draft value={state.draft} /><Add>Add</Add>
 *   App.intent = ({ DOM }) => ({ DRAFT: DOM.input(Draft).value(), ADD: DOM.click(Add) })
 *
 * Each key becomes a control: a JSX tag that renders its spec's element with every prop passed
 * through plus data-control="<Key>" (merged into data.attrs), and that stringifies to
 * [data-control="<Key>"], so it is accepted wherever a selector string is (DOM.select and the
 * DOM.<event> shorthands through MainDOMSource.select, simulateEvent, query, template strings).
 *
 * A control is not a component: the pragma recognises it by its `__sygnalControl` render hook
 * (src/pragma/index.ts) and calls it with the props, the children and its own createElement.
 * The JSX runtime entries use the core's pragma (D188), so the `h` passed in is the core
 * createElement; the hook keeps it a parameter (spec.vnode's contract, D101/D116).
 *
 * A spec is an intrinsic tag name or a spec object { kind, vnode(props, children, h), commands? }
 * (the frozen contract D101/D116, PLAN-5 widgets build on it). vnode() must return one element
 * vnode; the stamp keeps its key, hooks and other data, and the props' key is copied onto it
 * when it has none. `kind` ('element' for a tag) and `spec` stay on the control (inspect(),
 * element commands).
 *
 * In dev, the 'sygnal/diagnostics' entry publishes `control(control, vnode)` on the core bridge:
 * SYG125 (component statics on a control, or a vnode() that isn't one element vnode) and the
 * controls listed by inspect(). Without it (production) the call is skipped.
 */
export function controls(spec: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const key in spec) {
    const s = spec[key]
    const control: any = () => {}
    control.__sygnalControl = (data: any, children: any[], h: any) => {
      const v = typeof s == 'string' ? h(s, data, ...children) : s.vnode(data || {}, children, h)
      ;(globalThis as any).__SYGNAL_DIAGNOSTICS__?.control?.(control, v)
      const d = v.data ||= {}
      d.attrs = {...d.attrs, 'data-control': key}
      if (v.key === undefined && data) v.key = data.key
      return v
    }
    control.toString = () => `[data-control="${key}"]`
    control.kind = typeof s == 'string' ? 'element' : s.kind
    control.spec = s
    out[key] = control
  }
  return out
}
