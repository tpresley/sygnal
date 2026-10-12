/*
 * PLAN-9 M-1 (D466): `<Composed catalog={catalog} from="page" />`, catalog.render as a JSX tag.
 * A template rewrite (registry `pres`, as Portal and Transition; no host): in the owner's
 * reconcile walk the marker is replaced by `catalog.render(slice, state, opts)` on the owner's own
 * state, so the parts are the owner's children with the same identity as `{catalog.render(...)}`
 * in its view (CHILD.select, lenses, keys and container views behave the same).
 * - `from`: a state key ('page', the default) or a path (['boards', 0, 'page']); it is `at`.
 * - `card={part}`: an `ask_user` tool part's card, as askCard() renders it (`from` is then the
 *   chat's key, default 'assistant'); nothing while the card has no layout.
 * - `scope`, `frozen`, `answer`: as catalog.render's options.
 * - Error containment: a container view or part `props()` that throws replaces only the
 *   composition with the owner's `onError` (SYG408), where `{catalog.render(...)}` in a view shows a
 *   `.compose-error` element (SYG406).
 * - Misuse (SYG451, dev): no catalog, or `from` not naming a composition slice: nothing rendered.
 * - Registration (G-751): the pragma calls `Composed.$reg` when a tag uses it, so an app that never
 *   renders `<Composed>` ships none of this. The marker reads the owner's state cell: a composition
 *   computed in the view needs catalog.render().
 */
import {pres} from '../../../core/registry'
import {renderLayout, cardArgs} from './render'
import {dev} from './diag'

const EMPTY = () => ({sel: undefined, data: {}, children: [], text: undefined, elm: undefined, key: undefined})
const misuse = (owner: any, msg: string) => (dev('SYG451', owner.def.name, '<Composed> ' + msg + ': nothing rendered', 'warn', owner, msg), EMPTY())

function rewrite(n: any, owner: any): any {
  // a lowercase <composed> element (no marker function) is left as it is
  if (!n.data?.m) return n
  const {catalog, from, card, scope, frozen, answer} = n.data.props || {}
  if (typeof catalog?.render != 'function') return misuse(owner, 'has no catalog')
  const state = owner.cell.get()
  let slice: any, opts: any
  if (card !== undefined) {
    if (!card || typeof card != 'object' || !card.toolCallId) return misuse(owner, 'card is not a tool part')
    const c = cardArgs(state, card, from)
    if (!c) return EMPTY()
    ;[slice, opts] = c
  } else {
    const at = Array.isArray(from) ? from : [from ?? 'page']
    slice = at.reduce((x: any, k: any) => x?.[k], state)
    if (!slice || typeof slice != 'object' || !('layout' in slice || 'preview' in slice)) {
      return misuse(owner, `from=${JSON.stringify(from ?? 'page')} is not a composition`)
    }
    opts = {at}
  }
  if (scope !== undefined) opts.scope = scope
  if (frozen !== undefined) opts.frozen = frozen
  if (answer !== undefined) opts.answer = answer
  try { return renderLayout(catalog, slice, state, opts, false) || EMPTY() }
  catch (e) { return owner.failed(e).outv }
}

const reg = () => { pres.composed = rewrite }

/** `<Composed catalog={catalog} from="page" />`: the composition's parts as the owner's children */
export function Composed(_props: any): any {
  // never called: the pragma makes a `composed` marker vnode (preventInstantiation)
}
(Composed as any).componentName = 'composed';
(Composed as any).preventInstantiation = true;
(Composed as any).$reg = reg;
