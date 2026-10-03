/**
 * SYG634 (static, info; PLAN-3 5-3, G-175): a request with `latest: true` and a
 * computed `key`.
 *
 *   SEARCH: { HTTP: (state) => ({ url, query, ok: 'RESULTS', key: `search-${state.q}`, latest: true }) }
 *
 * `latest` cancels the instance's earlier requests with the SAME key, so a key
 * that changes with state gives each value its own lane: a new search never
 * cancels the previous one. That is right for per-row lanes (`save-${id}`), so
 * the finding is info.
 */
import { propName, stringValue } from '../ast.js'

export default {
  id: 'latest-computed-key',
  codes: ['SYG634'],
  description: 'latest: true with a computed key',
  run(project, report) {
    for (const comp of project.components) {
      for (const r of comp.model?.requests || []) {
        const props = new Map(r.node.properties.filter(p => p.type === 'ObjectProperty').map(p => [propName(p), p]))
        const latest = props.get('latest'), key = props.get('key')
        if (!latest || latest.value.type !== 'BooleanLiteral' || !latest.value.value || !key || stringValue(key.value) != null) continue
        report({
          code: 'SYG634',
          component: comp.name,
          file: r.file,
          node: key.value,
          severity: 'info',
          message: `the ${r.sink} request of '${r.action}' has latest: true with a computed key, so each key value is its own lane: a request with another key never cancels the earlier one`,
          fix: "use a fixed key (key: 'search') or none (the lane is the ok action) so the newest request cancels the others; keep the computed key only for independent lanes, such as one save per row",
          data: { action: r.action, sink: r.sink },
        })
      }
    }
  },
}
