/*
 * PLAN-9 B-1 / B-2 STUB (worker A): `compose.decisions(options)`, a minimal valid Backend so the
 * behavior, composeWith and the exports work before worker B's encoding lands. Worker B replaces
 * this file (structure/composer.mjs: select + layout steps, params, records).
 *
 * The stub: one `decide()` request with a use/omit choice per option (a record part once per
 * record), read into a flat page; `fake` answers those questions for a target tree's leaves.
 */
import {decide, choice} from '../decide'
import {answers} from '../answers'
import {dev} from './diag'
import {finish, fromTree} from './layout'
import type {Backend, Catalog, Tree} from './types'

const qname = (o: string) => 'use_' + o.replace(/\W/g, '_')
const questions = (catalog: Catalog, state: any) => {
  const q: any = {}
  for (const o of catalog.options(state)) q[qname(o.option)] = choice('Does user_request ask for this element?', {omit: 'Not needed.', use: o.description})
  return q
}

export function decisions(options: any = {}): Backend {
  const {url = '/api/decide', model, sink = 'HTTP'} = options
  if (!model) dev('SYG681', 'compose.decisions', 'no `model`: the decision request names none', 'error')
  return {
    sink,
    start: ({catalog, state, prompt, names}) => ({
      request: decide({url, model, state: {user_request: prompt}, questions: questions(catalog, state), key: names.key, latest: true, ok: names.ok, error: names.error}),
      pending: {step: 'select'},
    }),
    reply: ({catalog, state, reply}) => {
      const a = reply?.answers || {}
      const tree = catalog.options(state).filter(o => a[qname(o.option)]?.choice === 'use').map(o => ({part: o.part, ...(o.params && {params: o.params})}))
      return tree.length ? {layout: finish(catalog, fromTree(catalog, tree), state), decisions: a} : {layout: null, unavailable: true, decisions: a}
    },
    fake: ({catalog, state, target}) => {
      const want = new Set<string>()
      const walk = (t: Tree) => t.forEach((n: any) => {
        const e: any = catalog.get(n.part)
        if (e?.kind == 'part') want.add(e.record ? `${n.part}:${n.params?.[e.record]}` : n.part)
        const c = n.children
        if (c) Array.isArray(c) ? walk(c) : Object.values(c).forEach((x: any) => walk(x))
      })
      walk(target)
      const picks: any = {}
      for (const o of catalog.options(state)) picks[qname(o.option)] = want.has(o.option) ? 'use' : 'omit'
      return answers(questions(catalog, state), picks)
    },
  }
}
