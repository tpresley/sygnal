// Small synthetic transcript builder for the analyzer's unit tests.
let n = 0
const T0 = Date.parse('2026-10-01T10:00:00.000Z')
export const at = (s) => new Date(T0 + s * 1000).toISOString()

export function user(s, text) {
  return { type: 'user', timestamp: at(s), message: { role: 'user', content: text } }
}

export function call(s, name, input, { msgId, id, usage } = {}) {
  const tid = id ?? `toolu_${++n}`
  return {
    line: { type: 'assistant', timestamp: at(s), message: { id: msgId ?? `msg_${tid}`, role: 'assistant', content: [{ type: 'tool_use', id: tid, name, input }], usage: usage ?? { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100 } } },
    id: tid,
  }
}

export function result(s, toolId, text, isError = false) {
  return { type: 'user', timestamp: at(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: text, is_error: isError }] } }
}

export function text(s, t, msgId) {
  return { type: 'assistant', timestamp: at(s), message: { id: msgId ?? `msg_t${++n}`, role: 'assistant', content: [{ type: 'text', text: t }], usage: { input_tokens: 1, output_tokens: 5, cache_read_input_tokens: 500, cache_creation_input_tokens: 50 } } }
}

/** Build a transcript from steps: [s, name, input, resultAt, resultText, isError]. */
export function transcript(steps, { start = 0, prompt = 'do the task' } = {}) {
  const lines = [user(start, prompt)]
  for (const st of steps) {
    if (st.text) {
      lines.push(text(st.at, st.text))
      continue
    }
    const c = call(st.at, st.name, st.input)
    lines.push(c.line)
    if (st.resultAt != null) lines.push(result(st.resultAt, c.id, st.result ?? '', !!st.isError))
  }
  return lines
}

export const TRIAL = '/tmp/trials/baseline/sygnal-02-t1'
export const PASS_TESTS = ' Test Files  1 passed (1)\n      Tests  1 passed (1)'
export const PASS_BUILD = 'vite v8\n✓ built in 55ms'
export const FAIL_B007 = ' FAIL  src/tmp.test.jsx [ src/tmp.test.jsx ]\nReferenceError: __sygnal is not defined\n Test Files  1 failed (1)'
export const FAIL_ASSERT = " FAIL  src/tmp.test.jsx > pin\nAssertionError: expected 'Nothing pinned' to be 'Pinned: Buy milk'\n Test Files  1 failed (1)"
export const FAIL_TRUNC = ' Test Files  1 failed (1)\n      Tests  1 failed (1)'
export const FAIL_B006 = " FAIL  src/App.test.js > t\nTypeError: DOM.change(...).data is not a function\n Test Files  1 failed (1)"
export const GUARD = 'Error: This session is isolated in the worktree /x, but this command is too complex to verify that it stays inside the worktree. Refusing to run it'
