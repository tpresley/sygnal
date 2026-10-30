// sygnal/replay: what a recording turns into.
//
// - replayTest(log, options): a Vitest file that replays the recording (the log next to it as
//   JSON) and asserts no divergence and the final state. Works for any session: children,
//   replies, timers, clock and randomness. A timeline of the inputs is written as a comment, so a
//   reviewer sees what the test does without opening the JSON. sygnal/devtools' Copy as test
//   writes it in its replay mode.
// - bugReport(log, result, options): Markdown for an issue: what happened (the timeline), what
//   the replay found (the first divergence with its diff), and how to reproduce it.
import {patch} from './format'

// (the cause codes, as in ./recorder.ts; repeated so this module stays a leaf)
const CAUSE_NAME: Record<string, string> = {i: 'intent', r: 'reply', n: 'next', a: 'simulateAction', B: 'behavior', g: 'agent', S: 'setState', b: 'built-in', p: 'parent'}
const isInput = (c: string) => 'irnaBgS'.includes(c)

const short = (v: any, n = 60) => {
  if (v === undefined) return ''
  const s = JSON.stringify(v)
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

/** one line per input action: +ms, address (relative to the root), type, cause, data */
export function timeline(log: any, {max = 200}: {max?: number} = {}): string[] {
  const lines: string[] = []
  let ms = 0
  const inputs = log.a.filter((x: any) => isInput(x.c)).length
  for (const a of log.a) {
    ms += a.t
    if (!isInput(a.c)) continue
    if (lines.length >= max) { lines.push(`… ${inputs - max} more`); break }
    const path = log.p[a.p].split('/').slice(1).join('/') || '(root)'
    lines.push(`+${String(ms).padStart(5)}ms  ${path.padEnd(34)} ${a.y} (${CAUSE_NAME[a.c]})${a.d !== undefined ? ' ' + short(a.d.$echo ? '<its state>' : a.d) : ''}${a.e ? `  [reads ${[...new Set(a.e.map((e: any) => e[0]))].join(', ')}]` : ''}`)
  }
  return lines
}

/** the final root state the log records */
export function finalState(log: any): any {
  let s = log.init
  for (const cp of log.k) if (cp.o) s = patch(s, cp.o)
  if (log.end?.o) s = patch(s, log.end.o)
  return s
}

export interface ReplayTestOptions {
  /** the import line for the component (default: `import <App> from './<App>.js'`) */
  componentImport?: string
  /** the identifier the component has in the test (default: the recorded root's name) */
  componentName?: string
  /** the recording's path, relative to the test (default `./<App>.recording.json`) */
  logFile?: string
  /** where replay() is imported from (default 'sygnal/replay') */
  replayImport?: string
  /** more replay() options, as source code: "drivers: { DND: myDriver }" */
  replayOptions?: string
  testName?: string
  /** adds a `// @vitest-environment <env>` first line */
  environment?: string
}

/** A Vitest file replaying `log` (see the module comment) */
export function replayTest(log: any, o: ReplayTestOptions = {}): string {
  const {componentName = log.app, logFile = `./${log.app}.recording.json`, replayImport = 'sygnal/replay', testName, environment} = o
  const inputs = log.a.filter((a: any) => isInput(a.c)).length
  const lines = [
    ...(environment ? [`// @vitest-environment ${environment}`] : []),
    `// A recorded session of ${log.app} (sygnal/replay): ${inputs} inputs, ${log.k.length} checkpoints, ${log.end?.ms ?? '?'} ms${log.redacted ? ', typed text redacted' : ''}.`,
    '// replay() dispatches the recorded inputs to the same instances, gives every handler the',
    '// clock and randomness it read, and compares each action\'s state and each checkpoint\'s',
    '// root state and view with the recording.',
    '//',
    '// Timeline (inputs):',
    ...timeline(log).map(l => '//   ' + l),
    `import { it, expect } from 'vitest'`,
    `import { replay } from '${replayImport}'`,
    o.componentImport || `import ${componentName} from './${componentName}.js'`,
    `import log from '${logFile}' with { type: 'json' }`,
    '',
    `it(${JSON.stringify(testName || `${log.app}: a recorded session replays`)}, async () => {`,
    `  const r = await replay(${componentName}, log${o.replayOptions ? `, { ${o.replayOptions} }` : ''})`,
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

export interface BugReportOptions {
  title?: string
  /** the recording's file name in the report (default `<App>.recording.json`) */
  logName?: string
  /** what should have happened */
  expected?: string
}

/** Markdown for a bug report (see the module comment); `result`: a replay() result, optional */
export function bugReport(log: any, result?: any, {title = `${log.app}: replay diverges`, logName = `${log.app}.recording.json`, expected}: BugReportOptions = {}): string {
  const d = result?.divergence
  const out = [`## ${title}`, '']
  out.push(`Recorded ${log.recorded} · Sygnal ${log.sygnal ?? '?'} · ${log.end?.ms ?? '?'} ms · ${log.a.filter((a: any) => isInput(a.c)).length} inputs · ${log.k.length} checkpoints${log.redacted ? ' · **typed text redacted**' : ''}`, '')
  if (expected) out.push(`**Expected:** ${expected}`, '')
  out.push('### What happened', '', '```', ...timeline(log, {max: 60}), '```', '')
  if (result) {
    out.push('### What the replay found', '')
    if (!d && !result.view && !result.effects.length) out.push('The replay matches the recording (the bug reproduces deterministically from the log).', '')
    if (d) {
      out.push(`- First divergence: action #${d.s} \`${d.type ?? '?'}\` on \`${d.path ?? '?'}\` (${d.reason})`)
      for (const x of (d.diff || []).slice(0, 10)) out.push(`  - \`${x.path}\`: recorded \`${short(x.expected, 80)}\`, now ${x.deleted ? 'deleted' : '`' + short(x.actual, 80) + '`'}`)
    }
    if (result.view) out.push(`- The view differs from checkpoint ${result.view.checkpoint} on while the state matches (a view-only change)`)
    for (const e of result.effects.slice(0, 5)) out.push(`- \`${e.type}\` (#${e.s}) sent other values than recorded (hashes ${e.expected.map((f: any) => f[1]).join(', ') || 'none'} → ${e.actual.map((f: any) => f[1]).join(', ') || 'none'}); now: ${e.values.map(([k, v]: any) => `${k} ${short(v, 160)}`).join('; ')}`)
    if (result.unhandled.length) out.push(`- Actions the code no longer handles: ${result.unhandled.map((x: string) => '`' + x + '`').join(', ')}`)
    for (const w of result.warnings || []) out.push(`- Warning: ${w}`)
    out.push('')
  }
  out.push('### Reproduce', '', `Attach \`${logName}\`, then:`, '', '```js', `import { replay } from 'sygnal/replay'`, `const r = await replay(${log.app}, log)`, 'console.log(r.divergence)', '```', '')
  return out.join('\n')
}
