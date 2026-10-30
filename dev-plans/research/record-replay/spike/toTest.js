// Record/replay spike: what a recording turns into.
//
// - logToVitest(log, options): a Vitest file that replays the recording (the log next to it as
//   JSON) and asserts no divergence and the final state. Works for any session: children,
//   replies, timers, entropy. A timeline of the inputs is written as a comment, so a reviewer
//   sees what the test does without opening the JSON.
// - toSessionRecording(log): the log as sygnal/devtools' SessionRecording, for its existing
//   "Copy as test" (copyAsTestResult(session, options)): explicit t.simulateAction / t.respond
//   lines. Only complete when every input targets the root and no handler read entropy; the
//   result says why not otherwise (the replay-based file has neither limit).
// - bugReport(log, result, options): Markdown for an issue: what happened (the timeline), what
//   the replay found (the first divergence with its diff), and how to reproduce it.
import { decode, patch } from './format.js'
import { INPUT } from './recorder.js'

const CAUSE_NAME = { i: 'intent', r: 'reply', n: 'next', a: 'simulateAction', B: 'behavior', g: 'agent', b: 'built-in', p: 'parent', S: 'setState' }

const short = (v, n = 60) => {
  if (v === undefined) return ''
  const s = JSON.stringify(v)
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

/** one line per input action: +ms, address (relative to the root), type, cause, data */
export function timeline(log, { max = 200 } = {}) {
  const lines = []
  let ms = 0
  for (const a of log.a) {
    ms += a.t
    if (!INPUT.has(a.c)) continue
    if (lines.length >= max) { lines.push(`… ${log.a.filter(x => INPUT.has(x.c)).length - max} more`); break }
    const path = log.p[a.p].split('/').slice(1).join('/') || '(root)'
    lines.push(`+${String(ms).padStart(5)}ms  ${path.padEnd(34)} ${a.y} (${CAUSE_NAME[a.c]})${a.d !== undefined ? ' ' + short(a.d.$echo ? '<its state>' : a.d) : ''}${a.e ? `  [reads ${[...new Set(a.e.map(e => e[0]))].join(', ')}]` : ''}`)
  }
  return lines
}

/** the final root state the log records */
export function finalState(log) {
  let s = log.init
  for (const cp of log.k) if (cp.o) s = patch(s, cp.o)
  if (log.end?.o) s = patch(s, log.end.o)
  return s
}

/**
 * A Vitest file replaying `log`. Options: componentImport (the import line), componentName,
 * logImport (default `./<name>.recording.json`), replayImport (the replayer's module),
 * testName, environment (default 'jsdom').
 */
export function logToVitest(log, { componentImport, componentName = log.app, logFile = `./${log.app}.recording.json`, replayImport = '../replayer.js', testName, environment = 'jsdom' } = {}) {
  const inputs = log.a.filter(a => INPUT.has(a.c)).length
  const lines = [
    `// @vitest-environment ${environment}`,
    `// Generated from a Sygnal recording (record/replay spike): ${log.app}, ${inputs} inputs, ${log.k.length} checkpoints, ${log.end?.ms ?? '?'} ms${log.redacted ? ', redacted' : ''}.`,
    '// The replay dispatches the recorded inputs to the same instances, gives every reducer the',
    '// Date.now() / Math.random() / randomUUID() values it read, and compares each action\'s state',
    '// and each checkpoint\'s root state and vnode with the recording.',
    '//',
    '// Timeline (inputs):',
    ...timeline(log).map(l => '//   ' + l),
    `import { it, expect } from 'vitest'`,
    `import { replay } from '${replayImport}'`,
    componentImport || `import ${componentName} from './${componentName}.js'`,
    `import log from '${logFile}' with { type: 'json' }`,
    '',
    `it(${JSON.stringify(testName || `${log.app}: a recorded session replays`)}, async () => {`,
    `  const r = await replay(${componentName}, log)`,
    '  try {',
    '    expect(r.divergence).toBeNull()',
    '    expect(r.view).toBeNull()',
    '    expect(r.effects).toEqual([])',
    '    expect(r.unhandled).toEqual([])',
    `    expect(r.final).toEqual(${JSON.stringify(finalState(log), null, 2).split('\n').join('\n    ')})`,
    '  } finally {',
    '    r.t.dispose()',
    '  }',
    '})',
    '',
  ]
  return lines.join('\n')
}

/** the log as a sygnal/devtools SessionRecording (see the module comment) */
export function toSessionRecording(log, Component) {
  const root = log.p.indexOf(log.app)
  const actions = []
  const foreign = []
  const reasons = []
  for (const a of log.a) {
    const cause = CAUSE_NAME[a.c] || a.c
    if (a.p !== root) {
      if (INPUT.has(a.c) && (a.h || a.f)) foreign.push({ type: a.y, component: log.p[a.p].split('/').pop().replace(/[[:].*$/, ''), instance: log.p[a.p], cause })
      continue
    }
    if (a.e) reasons.push(`${a.y} reads ${[...new Set(a.e.map(e => e[0]))].join(', ')} (a replay injects it; simulateAction can't)`)
    const sinks = [...(a.h ? ['STATE'] : []), ...(a.f || []).map(f => f[0])]
    actions.push({ type: a.y, data: a.d === undefined ? undefined : a.d.$echo ? undefined : decode(a.d), cause, sinks, at: a.t,
      ...(a.d?.$echo ? { echo: true } : {}),
      ...(a.c == 'r' && a.r ? { replySink: a.r, replyKind: log.sources[a.r] == 'resources' ? 'fetch' : 'other' } : {}) })
  }
  const model = Component?.model ? Object.keys(Component.model) : undefined
  return {
    session: {
      version: 1, component: log.app, instance: '0', initialState: log.init, definitionInitialState: Component?.initialState,
      finalState: finalState(log), actionNames: model, drivers: Object.keys(log.sources), fakeable: Object.keys(log.sources).filter(n => log.sources[n] == 'resources'),
      actions, foreign,
    },
    reasons,
  }
}

/** Markdown for a bug report (see the module comment) */
export function bugReport(log, result, { title = `${log.app}: replay diverges`, logName = `${log.app}.recording.json`, expected } = {}) {
  const d = result?.divergence
  const out = [`## ${title}`, '']
  out.push(`Recorded ${log.recorded} · ${log.end?.ms ?? '?'} ms · ${log.a.filter(a => INPUT.has(a.c)).length} inputs · ${log.k.length} checkpoints${log.redacted ? ' · **typed text redacted**' : ''}`, '')
  if (expected) out.push(`**Expected:** ${expected}`, '')
  out.push('### What happened', '', '```', ...timeline(log, { max: 60 }), '```', '')
  if (result) {
    out.push('### What the replay found', '')
    if (!d && !result.view && !result.effects.length) out.push('The replay matches the recording (the bug reproduces deterministically from the log).', '')
    if (d) {
      out.push(`- First divergence: action #${d.s} \`${d.type ?? '?'}\` on \`${d.path ?? '?'}\` (${d.reason})`)
      for (const x of (d.diff || []).slice(0, 10)) out.push(`  - \`${x.path}\`: recorded \`${short(x.expected, 80)}\`, now ${x.deleted ? 'deleted' : '`' + short(x.actual, 80) + '`'}`)
    }
    if (result.view) out.push(`- The view differs from checkpoint ${result.view.checkpoint} on while the state matches (a view-only change)`)
    for (const e of result.effects.slice(0, 5)) out.push(`- \`${e.type}\` (#${e.s}) sent other values than recorded (hashes ${e.expected.map(f => f[1]).join(', ') || 'none'} → ${e.actual.map(f => f[1]).join(', ') || 'none'}); now: ${e.values.map(([k, v]) => `${k} ${short(v, 160)}`).join('; ')}`)
    if (result.unhandled.length) out.push(`- Actions the code no longer handles: ${result.unhandled.map(x => '`' + x + '`').join(', ')}`)
    out.push('')
  }
  out.push('### Reproduce', '', `Attach \`${logName}\`, then:`, '', '```js', `const r = await replay(${log.app}, log)`, 'console.log(r.divergence)', '```', '')
  return out.join('\n')
}
