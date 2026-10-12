/*
 * PLAN-9 C-2: a composition as an agent action, so a chat assistant (or WebMCP, the command bar)
 * can rearrange the page. The behavior's COMPOSE is an ordinary host action ('page.COMPOSE'), so
 * the A-1 agent layer runs it like any other; these helpers only save the boilerplate:
 *
 *   App.uses = { page: compose(catalog, { backend }), assistant: chat({ form: '.ask', prompt: '.prompt' }) }
 *   App.agent = {
 *     name: 'app',
 *     read: (state) => ({ page: compose.summary(state.page) }),
 *     actions: { ...compose.action('page') },      // the tool app_page_compose({ prompt, fresh? })
 *   }
 *
 * - compose.action(key = 'page', { description?, timeout? }): `{ [key + '.COMPOSE']: { description,
 *   input: { prompt, fresh? }, until, timeout } }`. `until` holds the tool result until the
 *   composition is over (status neither 'composing' nor 'preview': done, unavailable or error), so
 *   the result's `state` (the `read` projection) shows the new page; `timeout` (default 60 s, a
 *   model call takes a while) answers `{ ok: true, pending: true }` instead, as for any `until`.
 * - compose.summary(slice): what the `read` projection shows of a composition: `{ status, page:
 *   the layout as a tree (toTree), error? }`.
 *
 * With compose.llm() the composition's request goes on the same LLM sink as the chat's, in its own
 * lane (`key: 'compose'` vs the chat's uses key) with its own reply actions ('page.REPLY'), so the
 * two never abort or answer each other; the chat's next request waits for `until`.
 */
import {jsonSchema} from '../schema/jsonSchema'
import {toTree} from './layout'

const INPUT = {
  type: 'object',
  properties: {
    prompt: {type: 'string', minLength: 1, description: 'What the page should show, or how to change it, in the user\'s words'},
    fresh: {type: 'boolean', description: 'true: start over instead of changing the current page'},
  },
  required: ['prompt'],
  additionalProperties: false,
}

/** the `agent.actions` entry for the composition under `key` (see the header) */
export function composeAction(key: string = 'page', options: {description?: string; timeout?: number} = {}) {
  const {description = 'Rearrange the page from its prepared parts: say what it should show (it changes the current page unless fresh is true). The result has the new page', timeout = 60000} = options
  return {
    [key + '.COMPOSE']: {
      description,
      input: jsonSchema(INPUT),
      until: (state: any) => { const s = state?.[key]?.status; return s != 'composing' && s != 'preview' },
      timeout,
    },
  }
}

/** a composition as an agent reads it: `{ status, page, error? }` (`page`: the layout as a tree) */
export function composeSummary(slice: any) {
  if (!slice || typeof slice != 'object') return undefined
  return {status: slice.status, page: toTree(slice.layout), ...(slice.error && {error: slice.error})}
}
