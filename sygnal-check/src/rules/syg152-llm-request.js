/**
 * SYG152 (PLAN-6 K-1): a model sends an LLM request (an object literal with `messages`, no `url`,
 * no `abort`) without an `ok` reply action. The chat driver (sygnal/ai) delivers the finished
 * reply (`message`, `text`, `toolCalls`, `usage`) only as `ok`; without it the reply is lost
 * (`delta` shows the text while it streams, but the final message never reaches the state).
 * Requests built by a local helper (`LLM: (state) => ask(state)`) are followed (0-S5). A request
 * with a spread (`{ ...base, messages }`) may get `ok` from it: not reported.
 */
import { propName } from '../ast.js'

const keysOf = (obj) => obj.properties.map(p => (p.type === 'ObjectProperty' || p.type === 'ObjectMethod') ? propName(p) : null)

export default {
  id: 'llm-request-ok',
  codes: ['SYG152'],
  description: 'LLM request without an ok reply action',
  run(project, report) {
    for (const comp of project.components) {
      const seen = new Set()
      for (const r of comp.model?.requests || []) {
        const obj = r.node
        if (seen.has(obj)) continue
        seen.add(obj)
        if (obj.properties.some(p => p.type === 'SpreadElement')) continue
        const keys = keysOf(obj)
        if (keys.includes(null) || !keys.includes('messages') || keys.includes('url') || keys.includes('abort') || keys.includes('ok')) continue
        report({
          code: 'SYG152',
          component: comp.name,
          file: r.file, node: obj,
          message: `the ${r.sink} request '${r.action}' sends has messages but no ok reply action: the finished reply (message, text, toolCalls, usage) arrives only as ok, so it is lost` +
            (keys.includes('delta') ? ' (delta shows the text while it streams, but the final message never reaches the state)' : ''),
          fix: `name the action the reply arrives as: { messages, ok: 'REPLIED', error: 'FAILED' }, and add model entries for them (REPLIED: (state, { message }) => ...)`,
          data: { action: r.action, sink: r.sink },
        })
      }
    }
  },
}
