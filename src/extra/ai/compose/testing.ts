/*
 * PLAN-9 T-1: composeWith(t, catalog, tree, { stream? }), a test fixture for a whole composition,
 * the same for every backend:
 *
 *   t.simulateAction('page.COMPOSE', 'Revenue and churn side by side')
 *   await composeWith(t, catalog, [{ part: 'row', children: [{ part: 'revenue' }, { part: 'churn' }] }])
 *
 * It finds the composition of `catalog` that is waiting for a reply (a `compose` use whose slice
 * has `pending`) and answers each of its steps with the backend's `fake()` (the reply body that
 * leads to `tree`) on the backend's sink, targeted by the use's reply action (`page.REPLY`):
 * `t.respond`, or, with `stream: n` (true: 3) and a text body, `t.stream` in n chunks (an LLM
 * backend's JSON). It resolves once no step is pending.
 */
import {usesOf} from './behavior'
import type {Tree} from './types'

const err = (m: string) => new Error(`[Sygnal] composeWith: ${m}`)

export async function composeWith(t: any, catalog: any, tree: Tree, options: {stream?: number | boolean} = {}): Promise<void> {
  const entries = usesOf(catalog)
  if (!entries.length) throw err('no compose behavior uses this catalog (compose(catalog, { backend }) in a component\'s uses)')
  type Cur = {e: (typeof entries)[number]; k: string; s: any} | undefined
  // the use that made the pending step (several hosts may share the catalog and the key)
  const find = (): Cur => {
    let any: Cur
    for (const e of entries) for (const k of e.keys) {
      const s = t.state?.[k]
      if (s?.pending == null) continue
      if (typeof s.pending == 'object' && e.mine.has(s.pending)) return {e, k, s}
      any ||= {e, k, s}
    }
    return any
  }
  let cur: Cur = find()
  if (!cur) { await t.settle(); cur = find() }
  if (!cur) throw err('no composition is waiting for a reply (send COMPOSE first)')
  for (let step = 0; cur && step < 16; step++) {
    const {e, k, s}: any = cur
    const sink: string = e.backend.sink, target = k + '.REPLY'
    const body = e.backend.fake({catalog, state: t.state, pending: s.pending, target: tree})
    if (options.stream && typeof body == 'string') {
      const n = Math.max(1, options.stream === true ? 3 : Number(options.stream) || 1), size = Math.ceil(body.length / n) || 1
      for (let i = 0; i < n; i++) await t.stream(sink, [body.slice(i * size, (i + 1) * size)], target, {end: i == n - 1})
    } else await t.respond(sink, body, target)
    const next: any = t.state?.[k]
    cur = next?.pending != null && next.pending !== s.pending ? {e, k, s: next} : undefined
  }
}
