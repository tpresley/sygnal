/*
 * PLAN-9 C-1: the `compose` behavior (phase1-contract.md, PROPOSAL.md §3).
 *
 *   Workspace.uses = { page: compose(catalog, { backend: compose.decisions({ model }), form: '.ask', prompt: '.prompt' }) }
 *   view: {catalog.render(state.page, state)}
 *
 * Slice (state.page): { prompt, status, layout, preview, pending, decisions, error, ui, local }
 * - status: 'idle' | 'composing' (a request is out) | 'preview' (a partial layout shows: after a
 *   decision step, or while an LLM streams) | 'done' | 'unavailable' (nothing in the catalog fits:
 *   the layout is kept) | 'error' (the layout is kept; `error` says why);
 * - layout: the last finished layout; preview: the one being built (rendered instead while set);
 * - pending: the backend's step (plain JSON); decisions: what the backend explains (its last);
 * - ui: container state per node key (CONTROL: `{ key, name, value }` → ui[key][name] = value; the
 *   clicks are read only when a container has its own render);
 *   local: the state of `local` parts per node key.
 *
 * Actions ('page.X'): COMPOSE (data: a prompt string, `{ prompt, fresh? }`, or the form's submit:
 * the slice's prompt; an edit of the current layout unless `fresh`), SET_LAYOUT (a layout, finished
 * first: restore, undo, the app's own edits; null clears), REMOVE (a node key), CONTROL, DONE (a
 * composition finished: data is the layout; a host entry 'page.DONE' runs after it). Internal:
 * PROMPT (typing), REPLY / DELTA / FAILED (the backend sink's reply actions). A backend reply
 * `{ error }` (not a valid layout even after repair), or a start / reply that throws, is handled as
 * FAILED: status 'error', the layout kept; a delta that throws is ignored.
 *
 * The only sink it declares is `backend.sink`. Requests go in the lane `key` (default 'compose')
 * with `latest`, so a new prompt aborts the old one's step in flight. The reply names are the
 * use's key: `page.REPLY`, `page.DELTA`, `page.FAILED`. Finished layouts and previews are re-keyed
 * against the current layout (fromTree's previous-key reuse), so a part a follow-up doesn't change
 * keeps its node key, and so its instance and state, whatever keys the backend gave it. A reply
 * or delta with `keyed: true` (both backends' edits, B-4) already carries the previous layout's keys
 * and is used as is (re-keying by identity could swap the keys of two copies of one part).
 *
 * The handlers that need the host's whole state (record params read it) are HOST entries; a sink
 * reads it as `props.state` (the pre-action state), and one memo per behavior value makes STATE,
 * the sink and EFFECT of one action compute the same step.
 */
import {defineBehavior} from '../../behaviors'
import {ABORT} from '../../../shared'
import {fail} from '../../diagnostics/legacy'
import {finish, fromTree, removeNode, toTree} from './layout'
import type {Backend, Catalog, Layout} from './types'

/** the compositions per catalog (composeWith finds the pending one): backend, lane and use keys */
const uses = /*#__PURE__*/ new WeakMap<object, Array<{backend: Backend; lane: string; keys: Set<string>; mine: WeakSet<object>}>>()
export const usesOf = (catalog: object) => uses.get(catalog) || []

const message = (e: any) => String(e?.message ?? e ?? 'error')

/** one step per (host state, data, key): STATE, the sink and EFFECT of one action share it */
const once = <R>(f: (st: any, d: any, k: string) => R) => {
  let a: any[] = [], r: R
  return (st: any, d: any, k: string): R => a[0] === st && a[1] === d && a[2] === k ? r : (a = [st, d, k], r = f(st, d, k))
}

/** a click on a container control (render's `control()` data attributes) */
const controlOf = (e: any) => {
  const el = e?.ownerTarget || e?.target?.closest?.('[data-compose-control]') || e?.target
  const ds = el?.dataset || {}
  if (!ds.composeControl || !ds.composeKey) return null
  let value: any = ds.composeValue
  try { value = JSON.parse(value) } catch (_) { /* a plain string */ }
  return {key: ds.composeKey, name: ds.composeControl, value, at: ds.composeAt, scope: ds.composeScope}
}

/**
 * compose(catalog, { backend, form?, prompt?, key? }): the behavior (a `uses` value). Types:
 * src/ai.d.ts.
 */
export function composeBehavior(catalog: Catalog, options: any = {}): any {
  const {backend, form, prompt: promptSel, key: lane = 'compose'} = options
  if (!backend || typeof backend.sink != 'string' || typeof backend.start != 'function' || typeof backend.reply != 'function') {
    fail('SYG681', 'compose', 'compose(catalog, { backend }) needs a backend', 'Pass compose.decisions({ model }) or compose.llm({ model })')
  }
  if (!catalog || typeof catalog.render != 'function') fail('SYG681', 'compose', 'compose(catalog, …) needs a catalog made by defineCatalog()', 'Pass defineCatalog({ parts })')
  const S: string = backend.sink
  // mine: the pending steps this use made, so composeWith picks its backend among the catalog's uses
  const entry = {backend, lane, keys: new Set<string>(), mine: new WeakSet<object>()}
  const own = (p: any) => { if (p && typeof p == 'object') entry.mine.add(p); return p }
  if (!uses.has(catalog)) uses.set(catalog, [])
  uses.get(catalog)!.push(entry)
  const names = (k: string) => ({ok: k + '.REPLY', error: k + '.FAILED', delta: k + '.DELTA', key: lane})
  const rekey = (l: Layout, prev: Layout | null): Layout => (prev ? fromTree(catalog, toTree(l), prev) : l)

  const start = once((st, d, k) => {
    const s = st?.[k]
    if (!s) return null
    const raw = typeof d == 'string' ? d : d && typeof d == 'object' && typeof d.prompt == 'string' ? d.prompt : s.prompt
    const prompt = String(raw ?? '').trim()
    if (!prompt) return null
    entry.keys.add(k)
    const base = {...s, prompt, preview: null, decisions: null, error: null}
    try {
      const r = backend.start({catalog, state: st, prompt, previous: d?.fresh ? null : s.layout, names: names(k)})
      return {slice: {...base, status: 'composing', pending: own(r.pending ?? {})}, request: r.request}
    } catch (e) {
      return {slice: {...base, status: 'error', pending: null, error: message(e)}}
    }
  })

  const reply = once((st, d, k) => {
    const s = st?.[k]
    if (!s?.pending) return null
    let r: any
    try { r = backend.reply({catalog, state: st, pending: s.pending, reply: d, names: names(k)}) || {} } catch (e) {
      return {slice: {...s, status: 'error', preview: null, pending: null, error: message(e)}}
    }
    const decisions = r.decisions !== undefined ? r.decisions : s.decisions
    // a reply that isn't a valid layout (even after the backend's repair): as FAILED
    if (r.error != null) return {slice: {...s, status: 'error', preview: null, pending: null, decisions, error: message(r.error)}}
    if (r.request !== undefined) {
      const preview = r.preview ? (r.keyed ? r.preview : rekey(r.preview, s.layout)) : s.preview
      return {slice: {...s, status: preview ? 'preview' : 'composing', preview, pending: own(r.pending ?? s.pending), decisions}, request: r.request}
    }
    if (r.layout) {
      // `keyed` (B-4 edits): the backend kept the previous keys itself (moves, new rows): not re-keyed
      const layout = r.keyed ? r.layout : rekey(r.layout, s.layout)
      return {slice: {...s, status: 'done', layout, preview: null, pending: null, decisions, error: null}, done: layout}
    }
    if (r.unavailable || r.layout === null) return {slice: {...s, status: 'unavailable', preview: null, pending: null, decisions}}
    return {slice: {...s, status: 'error', preview: null, pending: null, decisions, error: 'the backend gave no layout'}}
  })

  const host = (step: (st: any, d: any, k: string) => any) =>
    (st: any, d: any, _n: any, _p: any, _o: any, k: string) => { const r = step(st, d, k); return r?.slice ? {...st, [k]: r.slice} : ABORT }
  const sink = (step: (st: any, d: any, k: string) => any) =>
    (_s: any, d: any, _n: any, p: any, _o: any, k: string) => { const r = step(p?.state, d, k); return r?.request !== undefined ? r.request : ABORT }

  // `prompt` (a selector) must not set the slice's prompt (defineBehavior merges options naming
  // initialState keys): the factory gets the other options
  const {prompt: _selector, ...rest} = options
  const controls = Object.values(catalog.containers || {}).some((c: any) => typeof c.decl?.render == 'function')
  return defineBehavior({
    initialState: {prompt: '', status: 'idle', layout: null, preview: null, pending: null, decisions: null, error: null, ui: {}, local: {}},
    intent: (so: any, _o: any, k: string) => {
      const {DOM} = so
      if (!DOM) return {}
      return {
        ...(promptSel && {PROMPT: DOM.select(promptSel).events('input').map((e: any) => e.target.value)}),
        ...(form && {COMPOSE: DOM.select(form).events('submit', {preventDefault: true}).mapTo(undefined)}),
        // only when a container has its own render (the built-in views render no controls): else
        // the selector never matches (SYG103 in dev)
        ...(controls && {CONTROL: DOM.select('[data-compose-control]').events('click').map(controlOf)
          .filter((c: any) => c && c.scope === undefined && (c.at === undefined || c.at === k))
          .map(({key, name, value}: any) => ({key, name, value}))}),
      }
    },
    model: {
      PROMPT: (s: any, p: any) => typeof p == 'string' && p !== s.prompt ? {...s, prompt: p} : ABORT,
      COMPOSE: {HOST: host(start), [S]: sink(start)},
      REPLY: {
        HOST: host(reply),
        [S]: sink(reply),
        EFFECT: (_s: any, d: any, next: any, p: any, _o: any, k: string) => { const r = reply(p?.state, d, k); if (r?.done) next('DONE', r.done) },
      },
      DELTA: {
        HOST: (st: any, d: any, _n: any, _p: any, _o: any, k: string) => {
          const s = st[k]
          if (!s?.pending || typeof backend.delta != 'function') return ABORT
          let r: any
          try { r = backend.delta({catalog, state: st, pending: s.pending, delta: d}) } catch (_) { return ABORT }
          return r?.preview ? {...st, [k]: {...s, status: 'preview', preview: r.keyed ? r.preview : rekey(r.preview, s.layout)}} : ABORT
        },
      },
      FAILED: (s: any, d: any) => s.pending ? {...s, status: 'error', preview: null, pending: null, error: message(d?.error ?? d)} : ABORT,
      SET_LAYOUT: {
        HOST: (st: any, d: any, _n: any, _p: any, _o: any, k: string) => {
          const layout = d == null ? null : finish(catalog, d, st)
          return {...st, [k]: {...st[k], layout, preview: null, pending: null, error: null, status: layout ? 'done' : 'idle'}}
        },
      },
      REMOVE: {
        HOST: (st: any, key: any, _n: any, _p: any, _o: any, k: string) => {
          const s = st[k], l = s?.layout
          if (!l?.nodes || typeof key != 'string' || !Object.prototype.hasOwnProperty.call(l.nodes, key) || key == l.root) return ABORT
          return {...st, [k]: {...s, layout: finish(catalog, removeNode(l, key), st)}}
        },
      },
      CONTROL: (s: any, c: any) => c && typeof c.key == 'string' && typeof c.name == 'string'
        ? {...s, ui: {...s.ui, [c.key]: {...s.ui?.[c.key], [c.name]: c.value}}} : ABORT,
      DONE: () => ABORT,
    },
  })(rest)
}
