/*
 * PLAN-9 B-3 STUB (worker A): `compose.llm(options)`, a minimal valid Backend so the behavior,
 * composeWith and the exports work before worker C's encoding lands. Worker C replaces this file
 * (llm/llm-composer.mjs: the tree+plan schema, repair, the streamed preview).
 *
 * The stub: one chat request asking for `{ "page": Tree }` as JSON text; the reply's structured
 * `value` (or its text, parsed) through fromTree + finish; `fake` is that JSON.
 */
import {dev} from './diag'
import {finish, fromTree} from './layout'
import type {Backend} from './types'

export function llm(options: any = {}): Backend {
  const {model, sink = 'LLM', instructions = 'Compose a page from these parts only. Answer with JSON: {"page": [{"part": id, "params"?: {}, "children"?: []}]}.'} = options
  if (!model) dev('SYG681', 'compose.llm', 'no `model`: the chat request names none', 'error')
  return {
    sink,
    start: ({catalog, state, prompt, names}) => ({
      request: {model, instructions: instructions + '\n' + catalog.options(state).map(o => `${o.option}: ${o.description}`).join('\n'),
        messages: [{role: 'user', content: prompt}], key: names.key, latest: true, ok: names.ok, error: names.error},
      pending: {step: 'llm'},
    }),
    reply: ({catalog, state, reply}) => {
      const v = reply?.value ?? JSON.parse(reply?.text ?? '')
      const tree = Array.isArray(v?.page) ? v.page : []
      return tree.length ? {layout: finish(catalog, fromTree(catalog, tree), state), decisions: v} : {layout: null, unavailable: true, decisions: v}
    },
    fake: ({target}) => JSON.stringify({page: target}),
  }
}
