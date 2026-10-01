// Friction catalog: known framework / tooling / harness issues, with regex
// signatures that find them in a trial transcript.
//
// Each entry:
//   id        tracker ID from dev-plans/PLAN-1-status.md "Bugs & Gaps Found"
//             (or a NEW-* / HARNESS-* id for issues this analyzer found that
//             have no tracker row yet)
//   title     one line
//   kind      'defect'   a framework/tooling bug: failures matching it are
//                        tooling-friction, not agent mistakes
//             'harness'  an eval-harness / environment artifact (both arms)
//             'suspect'  an ambiguous failure signature that counts as friction
//                        only when the agent's report also names the issue
//             'pitfall'  a framework design trap (the agent's code is wrong,
//                        but the framework makes it easy); tracked, not friction
//             'docs'     a documentation gap
//   arms      which arms it can apply to
//   result    regexes matched against tool results (failure text)
//   report    regexes matched against the agent's final report
//   workaround regexes matched against the agent's tool inputs (commands,
//             file writes) and its final code: evidence the agent routed
//             around the issue
//   fallback  for 'suspect' entries: the tracker IDs whose report match
//             confirms the failure as friction
//
// Status ("fixed" / "open") is read from the tracker at run time
// (trackerStatus()), so it stays current.
import fs from 'node:fs'

export const CATALOG = [
  {
    id: 'B-007',
    title: 'Vite plugin HMR transform rewrites `run(` in test files',
    kind: 'defect',
    arms: ['sygnal'],
    result: [/__sygnal is not defined/, /const __sygnal\s*=\s*run\b/, /ReferenceError: app is not defined/],
    report: [/__sygnal/, /(vite|sygnal\/vite)[^.\n]{0,40}plugin[^.\n]{0,160}(rewrit|inject|transform|adds?|treats)/i, /plugin[^.\n]{0,80}\brun\(/i],
    workaround: [
      /import\s*\{[^}]*\brun\s+as\s+\w+/,
      /import\s+\*\s+as\s+\w+\s+from\s+['"]sygnal['"]/,
      /\/\/[^\n]*import\.meta\.hot|\/\*[^]*?import\.meta\.hot[^]*?\*\//,
      /\[\s*['"]ru['"]\s*\+\s*['"]n['"]\s*\]/,
    ],
  },
  {
    id: 'B-006',
    title: '`renderComponent` mock DOM lacks enriched helpers (`.data()`, `.value()`, ...)',
    kind: 'defect',
    arms: ['sygnal'],
    result: [/\((?:\.\.\.|…)\)\.(data|value|checked|key|enter|esc)\s+is not a function/, /\.(data|value) is not a function/],
    report: [/(\.data\(\)|\.value\(\)|data is not a function|value is not a function)/i, /mock(ed)? DOM[^.\n]{0,120}(plain streams|helpers|shorthand|doesn'?t support)/i],
    workaround: [/\.value\s*=\s*\(\)\s*=>|value:\s*\(\)\s*=>\s*\w+\.map/],
  },
  {
    id: 'G-016',
    title: 'First event/action right after `renderComponent()` is silently lost',
    kind: 'suspect',
    arms: ['sygnal'],
    result: [/waitForState timed out/],
    report: [
      /(first|immediately|right after|straight after|sent straight)[^.\n]{0,100}(lost|dropped|ignored)/i,
      /(lost|dropped|ignored)[^.\n]{0,80}(right|straight|immediately) after/i,
      /silently (lost|dropped)/i,
    ],
    workaround: [],
  },
  {
    id: 'G-015',
    title: '`simulateAction` does not drive EVENTS / custom driver sinks',
    kind: 'suspect',
    arms: ['sygnal'],
    result: [/waitForState timed out/],
    report: [/simulateAction[^\n]{0,160}(only|never|doesn'?t|does not|not)[^\n]{0,100}(sink|driver|EVENTS|event|fetch|state)/i],
    workaround: [],
  },
  {
    id: 'B-005',
    title: '`driverFromAsync` swallows rejections',
    kind: 'defect',
    arms: ['sygnal'],
    result: [/Unhandled[^\n]{0,40}driverFromAsync/],
    report: [
      /driverFromAsync[^\n]{0,200}(swallow|only logs?|console\.error|never (passes|reach|sends)|logs? (the|a) (failure|error)|nothing (back|reaches))/i,
      /(swallow(s|ed)?)[^.\n]{0,80}(reject|error|failure)/i,
    ],
    // Final-code check (see code.mjs): a driverFromAsync driver whose async function catches.
    workaround: [],
  },
  {
    id: 'B-003',
    title: 'Non-STATE sinks see stale state within one tick',
    kind: 'defect',
    arms: ['sygnal'],
    result: [],
    report: [/same tick[^.\n]{0,120}(old|stale|previous)/i, /(old|stale|previous) (word count|state|value)[^.\n]{0,80}same tick/i, /stale state/i, /EVENTS reducer ran before/i],
    workaround: [],
  },
  {
    id: 'B-004',
    title: 'Controlled input not cleared when actions arrive in the same tick',
    kind: 'defect',
    arms: ['sygnal'],
    result: [],
    report: [/(input|field|draft)[^.\n]{0,60}(not cleared|isn'?t cleared|keeps the typed|stays filled)/i],
    workaround: [],
  },
  {
    id: 'B-010',
    title: 'Collection does not re-render on a pure reorder',
    kind: 'defect',
    arms: ['sygnal'],
    result: [],
    report: [/re-?order(ed|ing)?[^.\n]{0,80}(doesn'?t|does not|didn'?t|not)[^.\n]{0,20}(re-?render|update)/i, /pickCombine/],
    workaround: [],
  },
  {
    id: 'B-011',
    title: 'Stale text node when one text child becomes several children',
    kind: 'defect',
    arms: ['sygnal'],
    // Task 12's placeholder ("Select a task...") left next to the new details.
    result: [/Select a task\.Status/, /expected '[^'\n]*' not to contain 'Select a task/],
    report: [/stale text|old text (stays|remains|is kept)|text node[^.\n]{0,60}(stale|kept|stays|not (replaced|updated))/i],
    workaround: [],
  },
  {
    id: 'B-012',
    title: 'Removed className stays on a reused element',
    kind: 'defect',
    arms: ['sygnal'],
    result: [],
    report: [/class(Name)?[^.\n]{0,60}(stays|remains|is not removed|isn'?t removed|never (unset|removed))/i],
    workaround: [],
  },
  {
    id: 'G-018',
    title: '`data-sygnal-ready` attribute added to child component roots',
    kind: 'defect',
    arms: ['sygnal'],
    result: [/data-sygnal-ready/],
    report: [/data-sygnal-ready/],
    workaround: [],
  },
  {
    id: 'G-003',
    title: 'Skill never shows how a child reads props from its parent',
    kind: 'docs',
    arms: ['sygnal'],
    result: [],
    report: [/(how|where) (a )?child[^.\n]{0,40}(reads|gets|receives) (its )?props/i, /props (are|get) spread/i],
    workaround: [],
  },
  {
    id: 'ISOLATION',
    title: 'Isolation trap: parent `DOM.select` on elements rendered inside a child (SYG104)',
    kind: 'pitfall',
    arms: ['sygnal'],
    result: [/SYG10[34]/],
    report: [/(fully )?isolat(ed|ion)[^.\n]{0,160}(parent|DOM\.select|can'?t see|never sees)/i],
    workaround: [],
  },
  {
    id: 'RXJS',
    title: 'RxJS operator misuse on xstream streams',
    kind: 'pitfall',
    arms: ['sygnal'],
    result: [/\.(pipe|switchMap|mergeMap|debounceTime|tap|concatMap|exhaustMap|distinctUntilChanged)\s+is not a function/],
    report: [/\b(rxjs|switchMap|mergeMap)\b/i],
    workaround: [],
  },
  {
    id: 'NEW-TEST-RECIPE',
    title: 'No documented way to mount and drive a Sygnal app in a test (skill has no testing section)',
    kind: 'docs',
    arms: ['sygnal'],
    result: [/expected '\{"sel":/],
    report: [/(no|without a) (documented|supported|obvious) (way|recipe)[^.\n]{0,80}test/i],
    workaround: [],
  },
  {
    id: 'HARNESS-GUARD',
    title: 'Coordinator worktree guard refused a compound shell command (eval environment, both arms)',
    kind: 'harness',
    arms: ['sygnal', 'react'],
    result: [/is isolated in the worktree[^\n]*Refusing|Refusing to run it/],
    report: [],
    workaround: [],
  },
]

export const CATALOG_BY_ID = Object.fromEntries(CATALOG.map((e) => [e.id, e]))

const anyMatch = (res, text) => res.some((re) => re.test(text))

/** Catalog entries whose `result` signatures match a tool result text. */
export function matchResult(text, arm = null) {
  const t = String(text ?? '')
  return CATALOG.filter((e) => (!arm || e.arms.includes(arm)) && e.result.length && anyMatch(e.result, t)).map((e) => e.id)
}

/** Catalog entries whose `report` signatures match the agent's final report. */
export function matchReport(text, arm = null) {
  const t = String(text ?? '')
  return CATALOG.filter((e) => (!arm || e.arms.includes(arm)) && e.report.length && anyMatch(e.report, t)).map((e) => e.id)
}

/** Catalog entries whose `workaround` signatures match some text (tool input or code). */
export function matchWorkaround(text, arm = null) {
  const t = String(text ?? '')
  return CATALOG.filter((e) => (!arm || e.arms.includes(arm)) && e.workaround.length && anyMatch(e.workaround, t)).map((e) => e.id)
}

/**
 * Decide which catalog IDs make a failure "friction" (not the agent's fault).
 * defect/harness result matches always count; a 'suspect' result match counts
 * only if the agent's report names the same issue.
 */
export function frictionIds(resultIds, reportIds) {
  const out = []
  for (const id of resultIds) {
    const e = CATALOG_BY_ID[id]
    if (!e) continue
    if (e.kind === 'defect' || e.kind === 'harness' || e.kind === 'docs') out.push(id)
    else if (e.kind === 'suspect' && reportIds.includes(id)) out.push(id)
  }
  return out
}

/**
 * Read issue statuses from the tracker table (dev-plans/PLAN-1-status.md).
 * Returns { [id]: { status: 'fixed' | 'open' | 'partly fixed', text } }.
 */
export function trackerStatus(trackerFile) {
  const out = {}
  let text = ''
  try {
    text = fs.readFileSync(trackerFile, 'utf8')
  } catch {
    return out
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*([BG]-\d{3})\s*\|/)
    if (!m) continue
    const cells = line.split('|').map((c) => c.trim())
    const statusCell = cells[cells.length - 2] ?? ''
    const status = /✅/.test(statusCell) ? 'fixed' : /partly fixed/i.test(statusCell) ? 'partly fixed' : 'open'
    out[m[1]] = { status, text: statusCell.replace(/\*\*/g, '').slice(0, 140) }
  }
  return out
}
