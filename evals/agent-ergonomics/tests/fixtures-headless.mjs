// A headless transcript fixture (stream-json as run-trial.mjs writes it), shared by
// tests/headless.unit.mjs and analysis/tests/recommend.unit.mjs.
import { DEFAULT_TOOLS } from '../lib/headless.mjs'

export const DEST = '/private/tmp/sygnal-evals/trials/v2/sygnal-01-t1'

// A headless transcript as run-trial.mjs writes it: stream-json lines, each stamped.
export function headlessTranscript({ dest = DEST, result = true, bashPath = dest } = {}) {
  const t = (s) => new Date(Date.parse('2026-10-01T12:00:00Z') + s * 1000).toISOString()
  const u = { input_tokens: 3, output_tokens: 40, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500 }
  const lines = [
    { timestamp: t(0), type: 'system', subtype: 'init', cwd: dest, model: 'claude-opus-5-5', tools: DEFAULT_TOOLS },
    { timestamp: t(4), type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Read', input: { file_path: `${dest}/src/App.jsx` } }], usage: u } },
    { timestamp: t(5), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x' }] }, tool_use_result: { stdout: '' } },
    { timestamp: t(9), type: 'assistant', message: { id: 'm2', role: 'assistant', content: [{ type: 'tool_use', id: 'b', name: 'Edit', input: { file_path: `${dest}/src/App.jsx`, old_string: 'a', new_string: 'b' } }], usage: u } },
    { timestamp: t(10), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: 'ok' }] } },
    { timestamp: t(14), type: 'assistant', message: { id: 'm3', role: 'assistant', content: [{ type: 'tool_use', id: 'c', name: 'Bash', input: { command: `npm --prefix ${bashPath} test` } }], usage: u } },
    { timestamp: t(20), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c', content: ' Test Files  1 passed (1)' }] } },
    { timestamp: t(25), type: 'assistant', message: { id: 'm4', role: 'assistant', content: [{ type: 'text', text: 'Done.' }], usage: u } },
  ]
  if (result) lines.push({ timestamp: t(26), type: 'result', subtype: 'success', is_error: false, duration_ms: 25500, num_turns: 4, result: 'Done.', total_cost_usd: 0.4567, usage: { input_tokens: 12, output_tokens: 900, cache_read_input_tokens: 40000, cache_creation_input_tokens: 8000 } })
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
}
