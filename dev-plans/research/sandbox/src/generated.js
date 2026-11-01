// The sygnal/ai angle: a model writes a component (beyond compose's fixed catalog), the page runs
// it in a sandbox, and its answer becomes the tool result, the way an `ask` card's does (PLAN-9 H-).
// Failures (a syntax error, a component that throws or reaches for what isn't there) go back to
// the model as repair feedback instead of reaching the user.
//
//   const r = await runGenerated(call, {QJS, kernel, container, compile})
//   // r: {ok: true, sandbox, answer: Promise}  |  {ok: false, feedback: 'ReferenceError: document is not defined'}
import {createSandbox} from './sandbox.js'

export function runGenerated(call, {QJS, kernel, container, compile, limits, capabilities}) {
  if (call.tool !== 'render_component') return {ok: false, feedback: `unknown tool ${call.tool}`}
  const {code, props} = call.arguments || {}
  let source
  try { source = compile(String(code)) } catch (e) { return {ok: false, feedback: `does not compile: ${e.message.split('\n')[0]}`} }
  let failure = null, settle
  const answer = new Promise((ok) => { settle = ok })
  const sandbox = createSandbox(QJS, {
    kernel, source, container, props, limits: {bootMs: 500, callMs: 50, ...limits},
    capabilities: {
      ...capabilities,
      log: (level, text) => { if (level === 'error' && !failure) failure = text },
      onEmit: (e) => { if (e.type === 'ANSWER') settle(e.data) },
    },
    onError: (e) => { failure = `${e.reason}: ${e.message}` },
  })
  // a component that boots but renders nothing, or logged an error while booting, is a failure too
  if (!failure && !sandbox.root?.firstChild) failure = 'rendered nothing'
  if (failure) { sandbox.dispose(); return {ok: false, feedback: failure} }
  return {ok: true, sandbox, answer}
}
