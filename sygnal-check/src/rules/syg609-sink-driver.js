/**
 * SYG609, statically (PLAN-4 4-G2; REPORT-v4: Haiku 13-t2 kept `run(App)` with no
 * makeFetchDriver(), and its own tests passed on renderComponent's fake HTTP sink): a model entry
 * sends to a sink (HTTP, WS, any name that isn't built in) that no driver of the app's run() call
 * takes, so run() drops every value sent there. The dev entry reports the same code at run time
 * (src/extra/diagnostics/checks/wiring.ts).
 *
 * Only when every fact is static, like SYG643: the run() call is in the scanned files, its drivers
 * are an object literal the checker can list (or there is no drivers argument), the component is
 * one its root renders, and no other run() call that renders it registers the name (or has drivers
 * the checker can't list). Sinks the core handles itself never need a driver: STATE, EFFECT,
 * EVENTS, PARENT, READY, DOM, CHILD, ELEMENT, PERSIST, and LOG (a default driver of run()).
 * Reported once per component and sink, at the first entry that sends to it.
 *
 * PLAN-11 Q-6: an intent that reads a driver source (`({ DOM, HTTP }) => …`, `sources.HTTP`,
 * `const { HTTP } = sources`) no driver provides, under the same conditions, as the dev entry's
 * sources proxy does: the source is undefined, so `HTTP.select(…)` throws. The sources the core
 * gives every intent (DOM, STATE, CHILD, dispose$, props$, children$, commands$) and run()'s
 * default drivers (EVENTS, LOG) never need one. Reported once per component and source, at the
 * first read.
 */
import { walk, unwrap, propName, memberName } from '../ast.js'
import { findApps } from '../model/apps.js'
import { sourceAliases } from '../model/intent.js'

// src/extra/diagnostics/checks/wiring.ts NO_DRIVER_NEEDED, plus run()'s default drivers
const NO_DRIVER_NEEDED = new Set(['STATE', 'EFFECT', 'EVENTS', 'PARENT', 'READY', 'DOM', 'CHILD', 'ELEMENT', 'PERSIST', 'LOG'])
const DRIVER_NAME = /^[A-Z][A-Z0-9_]*$/
// the sources the core adds to every intent (src/core/runtime.ts srcDesc) and run()'s default drivers
const CORE_SOURCES = new Set(['DOM', 'STATE', 'CHILD', 'EVENTS', 'LOG'])
// G-620: an LLM sink gets the chat driver (sygnal/ai)
const EXAMPLE = { HTTP: 'makeFetchDriver()', WS: 'makeSocketDriver()', SW: "makeServiceWorkerDriver('/sw.js', { enabled: import.meta.env.PROD })", LLM: "makeChatDriver({ transport: openResponses({ baseURL: 'http://localhost:11434/v1', model: 'llama3.2' }) })" }

/** The driver-like source names an intent reads: Map<name, node> (the first read). */
function sourceReads(fn) {
  const out = new Map()
  const add = (name, node) => { if (name && !out.has(name)) out.set(name, node) }
  const { sourcesParam } = sourceAliases(fn)
  const fromPattern = (pat) => {
    for (const p of pat.properties) if (p.type === 'ObjectProperty') add(propName(p), p.key)
  }
  let first = fn.params?.[0]
  if (first?.type === 'AssignmentPattern') first = first.left
  if (first?.type === 'ObjectPattern') fromPattern(first)
  if (sourcesParam) {
    walk(fn.body, (n) => {
      if (n.type === 'VariableDeclarator' && n.id.type === 'ObjectPattern' &&
          unwrap(n.init)?.type === 'Identifier' && unwrap(n.init).name === sourcesParam) fromPattern(n.id)
      if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && !n.computed) {
        const o = unwrap(n.object)
        if (o?.type === 'Identifier' && o.name === sourcesParam) add(memberName(n), n.property)
      }
      return true
    })
  }
  for (const k of [...out.keys()]) if (!DRIVER_NAME.test(k) || CORE_SOURCES.has(k) || NO_DRIVER_NEEDED.has(k)) out.delete(k)
  return out
}

export default {
  id: 'sink-driver',
  codes: ['SYG609'],
  description: 'Sink or intent source has no driver',
  run(project, report) {
    let apps = null
    for (const comp of project.components) {
      const fn = comp.intent?.fn
      if (fn && comp.intent.file) {
        for (const [name, node] of sourceReads(fn)) {
          apps = apps || findApps(project)
          const rendering = apps.filter(a => a.components.has(comp))
          const lacking = rendering.find(a => a.drivers && !a.drivers.has(name))
          if (!lacking || rendering.some(a => !a.drivers || a.drivers.has(name))) continue
          const at = `${project.relPath(lacking.file.path)}:${lacking.call.loc.start.line}`
          const root = lacking.root?.name || 'App'
          const example = EXAMPLE[name] ? `run(${root}, { ${name}: ${EXAMPLE[name]} })` : `run(${root}, { ${name}: myDriver })`
          report({
            code: 'SYG609',
            component: comp.name,
            file: comp.intent.file,
            node,
            related: [{ node: lacking.call.callee, file: lacking.file, message: `this run() call registers no ${name} driver` }],
            message: `${comp.name}.intent reads the ${name} source, but the run() call that renders ${comp.name} (${at}) ` +
              `registers no driver named ${name}, so it is undefined`,
            fix: `Pass a driver named ${name} to run(): ${example}` +
              (EXAMPLE[name] ? '' : ', e.g. driverFromAsync(fn) or your own driver') +
              `. Check the spelling against the drivers you pass`,
            data: { name, kind: 'source', drivers: [...lacking.drivers] },
          })
        }
      }
      const values = comp.model?.sinkValues || []
      const seen = new Set()
      for (const v of values) {
        const sink = v.sink
        if (seen.has(sink) || NO_DRIVER_NEEDED.has(sink) || !DRIVER_NAME.test(sink)) continue
        seen.add(sink)
        apps = apps || findApps(project)
        const rendering = apps.filter(a => a.components.has(comp))
        const lacking = rendering.find(a => a.drivers && !a.drivers.has(sink))
        if (!lacking || rendering.some(a => !a.drivers || a.drivers.has(sink))) continue
        const at = `${project.relPath(lacking.file.path)}:${lacking.call.loc.start.line}`
        const root = lacking.root?.name || 'App'
        const example = EXAMPLE[sink] ? `run(${root}, { ${sink}: ${EXAMPLE[sink]} })` : `run(${root}, { ${sink}: myDriver })`
        report({
          code: 'SYG609',
          component: comp.name,
          file: v.file,
          node: v.keyNode || v.node, // C-2: the sink key (HTTP:), not the whole value
          related: [{ node: lacking.call.callee, file: lacking.file, message: `this run() call registers no ${sink} driver` }],
          message: `Model entry '${v.action}' sends to the ${sink} sink, but the run() call that renders ${comp.name} (${at}) ` +
            `registers no driver named ${sink}, so every value sent there is dropped`,
          fix: `Pass a driver named ${sink} to run(): ${example}` +
            (EXAMPLE[sink] ? '' : ', e.g. driverFromAsync(fn) or your own driver') +
            `. Check the spelling against the drivers you pass. Tests don't need it: renderComponent fakes the sink`,
          data: { name: sink, kind: 'sink', action: v.action, drivers: [...lacking.drivers] },
        })
      }
    }
  },
}
