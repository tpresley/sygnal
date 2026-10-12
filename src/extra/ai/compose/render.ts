/*
 * PLAN-9 K-2: catalog.render(slice, state, { scope?, frozen?, answer?, at? }), the composition as
 * vnodes for the host's own view (phase1-contract.md). It renders `slice.preview ?? slice.layout`.
 *
 * - A part is a component vnode, so every composed part is a child instance of the host (CHILD.select,
 *   lenses, EVENTS, context and drivers work as for any child). It gets:
 *   - its identity: `key` = `scope/nodeKey` (or `nodeKey`); the core keys instances by the vnode key
 *     (D470: `key ?? props.id ?? path`), so params, including one named `id`, reach the part as props;
 *   - its state: `state: 'key'` as is, a lens as is, `(node, key) => lens` called, `local: init` a lens
 *     into `slice.local[nodeKey]` (at the slice's path `at`); each lens is memoized per node (G-752),
 *     so a part re-renders only when its own state, props or params change;
 *   - its params, defaults filled, as props (or `props(params, state)`; an object `props` is merged
 *     under them), and the props `node` (its key), and `scope` / `frozen` / `answer` when given (a
 *     result part's answer: `answer.value` when `answer.node` is its key).
 *   A part declared with `render` (a view function) is called inline with the same props and
 *   `state` read through its lens.
 * - A container calls its view with `{ key, node, params (defaults filled), slots, children, ui, control, scope, frozen }`:
 *   `slots` maps each slot to its vnodes, `children` lists `{ key, node, part, slot, vnode }` in
 *   order, `ui` is `slice.ui[key]`, and `control(name, value)` returns data attributes to spread on an
 *   element; a click on it is the behavior's CONTROL `{ key, name, value }` (ui[key][name] = value).
 * - A frozen render is wrapped in `<fieldset disabled class="compose-frozen">`.
 * - A container view or `props()` that throws: only the composition is replaced (a `.compose-error`
 *   element), SYG406. Under `<Composed>` (composed.ts) the throw goes on to the host's `onError`
 *   instead, rendered in place of the composition (SYG408). An unknown part or slot is skipped (SYG250, once per catalog and name).
 */
import {createElement as h} from '../../../pragma/index'
import {error as logError} from '../../diagnostics/legacy'
import {dev} from './diag'
import type {Catalog, Part, RenderOptions} from './types'

const getIn = (o: any, path: any[]) => path.reduce((x, k) => x?.[k], o)
const setIn = (o: any, path: any[], v: any): any => {
  const [k, ...rest] = path
  const base = Array.isArray(o) ? o.slice() : {...o}
  base[k] = rest.length ? setIn(o?.[k] ?? {}, rest, v) : v
  return base
}

/** the memoized lenses (G-752), per catalog: (at, scope, node key, part, params) → lens */
const memo = /*#__PURE__*/ new WeakMap<object, Map<string, any>>()
const MAX = 2000

function lensOf(cat: Catalog, part: Part, node: any, key: string, at: any[] | null, scope?: string): any {
  if (!part.hasLocal && typeof part.state != 'function') return part.state
  let m = memo.get(cat)
  if (!m) memo.set(cat, m = new Map())
  const id = JSON.stringify([at, scope ?? null, key, part.id, part.hasLocal ? 0 : node.params ?? null])
  let l = m.get(id)
  if (l !== undefined) return l
  if (part.hasLocal) {
    const init = part.local, path = at ? [...at, 'local', key] : null
    l = {
      get: (st: any) => (path ? getIn(st, path) : undefined) ?? init,
      set: (st: any, v: any) => (path ? setIn(st, path, v) : st),
    }
  } else l = (part.state as any)(node, key)
  if (m.size > MAX) m.clear()
  m.set(id, l)
  return l
}

/** a part's params with the defaults filled in */
function paramsOf(part: {params: Record<string, any>}, node: any): Record<string, any> {
  const out: any = {}
  for (const k in part.params) {
    const v = node.params?.[k] ?? (part.params[k] as any).default
    if (v !== undefined) out[k] = v
  }
  for (const k in node.params) if (!(k in out)) out[k] = node.params[k]
  return out
}

/** the slice's path in the host state: `at`, else the host key whose value is the slice */
function pathOf(slice: any, state: any, at: RenderOptions['at']): any[] | null {
  if (Array.isArray(at)) return at
  if (typeof at == 'string') return [at]
  if (state && typeof state == 'object') for (const k in state) if (state[k] === slice) return [k]
  return null
}

/** `contain` false (the `<Composed>` marker): a throw reaches the caller, which renders the host's onError (SYG408) */
export function renderLayout(cat: Catalog, slice: any, state: any, opts: RenderOptions = {}, contain = true): any {
  const layout = slice?.preview ?? slice?.layout
  if (!layout || typeof layout != 'object' || !layout.nodes) return null
  const {scope, frozen, answer} = opts
  const at = pathOf(slice, state, opts.at), atStr = at ? at.join('.') : undefined
  const nodes = layout.nodes, seen = new Set<string>()
  const extra: any = {}
  if (scope !== undefined) extra.scope = scope
  if (frozen) extra.frozen = true

  const nodeOf = (key: string): any => {
    const n = nodes[key]
    if (!n || seen.has(key)) return null
    seen.add(key)
    const e: any = cat.get(n.part)
    if (!e) { dev('SYG250', 'catalog.render', `the layout names an unknown part '${n.part}' (node '${key}'); it is not rendered`, 'warn', cat, 'render:' + n.part); return null }
    if (e.kind == 'container') {
      const slots: Record<string, any[]> = {}, children: any[] = []
      for (const s of e.slotNames) slots[s] = []
      for (const s in n.slots) {
        if (!slots[s]) { dev('SYG250', 'catalog.render', `node '${key}' (${e.id}) has no slot '${s}'; its children are not rendered`, 'warn', cat, `render:${e.id}:${s}`); continue }
        for (const k of n.slots[s] || []) {
          const vnode = nodeOf(k)
          if (vnode == null) continue
          slots[s].push(vnode)
          children.push({key: k, node: nodes[k], part: cat.get(nodes[k].part), slot: s, vnode})
        }
      }
      const control = (name: string, value?: any) => ({
        'data-compose-control': name, 'data-compose-key': key, 'data-compose-value': JSON.stringify(value ?? null),
        ...(atStr !== undefined && {'data-compose-at': atStr}), ...(scope !== undefined && {'data-compose-scope': scope}),
      })
      return e.render({key, node: n, params: paramsOf(e, n), slots, children, ui: slice.ui?.[key] || {}, control, scope, frozen: !!frozen})
    }
    const part = e as Part
    // H-2: a result part answers a card (chat's askCard gives the call id as scope); elsewhere its answer reaches no one
    if (part.result && scope === undefined) dev('SYG160', 'catalog.render', `the result part '${part.id}' is rendered outside a card (no scope), so its answer reaches no tool call`, 'warn', cat, 'result:' + part.id)
    const params = paramsOf(part, n)
    const props = typeof part.props == 'function' ? part.props(params, state) : {...part.props, ...params}
    const lens = lensOf(cat, part, n, key, at, scope)
    const own = {...props, ...extra, node: key, ...(answer && answer.node === key && {answer: answer.value})}
    if (part.render) return part.render({...own, state: lens === undefined ? state : typeof lens == 'string' ? state?.[lens] : lens.get(state)})
    if (!part.component) return null
    const id = scope !== undefined ? `${scope}/${key}` : key
    // identity from the vnode key (D470: key ?? props.id ?? path), so a param named `id` reaches the part
    return h(part.component, {...own, ...(lens !== undefined && {state: lens}), key: id})
  }

  let out: any
  try { out = nodeOf(layout.root || 'page') } catch (err) {
    if (!contain) throw err
    logError('SYG406', 'catalog.render', 'a container view or a part\'s props() threw; the composition is replaced by an empty .compose-error element', 'Check the container\'s render and the part\'s props for missing data', err)
    return h('div', {className: 'compose-error'})
  }
  return frozen ? h('fieldset', {disabled: true, className: 'compose-frozen'}, out) : out
}

/**
 * H-2: an `ask_user` tool part's card as `[slice, options]` for catalog.render (askCard and
 * `<Composed card={part} />`): the call id as scope, frozen unless the card is open, the answer
 * marked, `at` the part's `ui` in the chat `k` (so `local` parts write to it). Null without a layout.
 */
export function cardArgs(state: any, part: any, k = 'assistant'): [any, RenderOptions] | null {
  const u = part?.ui
  if (!u?.layout) return null
  const msgs = state?.[k]?.messages || []
  let at: any[] | undefined
  for (let i = msgs.length - 1; i >= 0 && !at; i--) {
    const j = (msgs[i].parts || []).findIndex((x: any) => x.toolCallId === part.toolCallId && x.ui)
    if (j >= 0) at = [k, 'messages', i, 'parts', j, 'ui']
  }
  return [u, {
    scope: part.toolCallId,
    frozen: part.state !== 'input-available' || u.status !== 'open',
    answer: u.answer ? {node: u.answer.node, value: u.answer.value} : null,
    ...(at && {at}),
  }]
}
