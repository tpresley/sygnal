// Classifiers for single tool calls and tool results. Pure functions, unit-tested
// in analysis/tests/classify.test.mjs. The build/test ("verify") and file-edit
// detection reuse lib/transcript.mjs, the harness's own counter, so iteration
// counts here match transcript-stats.mjs.
import { isRunCommand, isEditCommand, splitCommands, bashEdits, bashEditWeights } from '../../lib/transcript.mjs'
import { isSygnalSkillCall } from './skill.mjs'

export const PHASES = ['orient', 'learn', 'implement', 'verify', 'test-authoring', 'debug', 'tooling-friction', 'think', 'report', 'other']

export const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'])
const META_TOOLS = new Set(['ToolSearch', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList'])

export const TEST_FILE_RE = /(\.(test|spec)\.[cm]?[jt]sx?\b|__tests__\/|(^|\/)tests?\/[^\s'"]+\.[cm]?[jt]sx?\b|vitest\.config|\.probe\.|_probe\.)/
const SKILL_RE = /\/\.claude\/skills\/|\/skills\/[\w-]+\/(SKILL\.md|references\/)/
const LIB_RE = /node_modules\/(sygnal|react|react-dom|@testing-library|vitest|vite|xstream|snabbdom|@vitejs)\b/
const DOCS_RE = /node_modules\/[^\s'"]*\.(md|d\.ts)\b|llms\.txt/

/** Paths mentioned in a tool call (file_path / path / the command text). */
export function callText(call) {
  const i = call.input ?? {}
  return [i.file_path, i.path, i.pattern, i.command, i.glob, i.skill].filter(Boolean).join(' ')
}

/** Is a Write/Edit target, or the file a Bash command writes, a test file? */
export function isTestPath(p) {
  return TEST_FILE_RE.test(String(p ?? ''))
}

/** Files a Bash command writes (lib/transcript.mjs bashEdits: redirects, tee, sed -i, perl -i, python/node scripts, patches). */
export function bashWriteTargets(cmd) {
  return bashEdits(cmd).targets
}

/** Edit phase of a Bash call that writes files: test-authoring if every identified target is a test file. */
function bashEditPhase(cmd) {
  const t = bashEdits(cmd).targets
  return t.length && t.every(isTestPath) ? 'test-authoring' : 'implement'
}

/**
 * Share of a Bash edit's written text that goes to test files (0..1), or null
 * when it can't be told (no heredoc). Lets the timeline split one call that
 * writes both source and tests between implement and test-authoring.
 */
export function bashTestShare(cmd) {
  const w = bashEditWeights(cmd)
  const total = w.reduce((a, x) => a + x.chars, 0)
  if (!total) return null
  return w.filter((x) => isTestPath(x.target)).reduce((a, x) => a + x.chars, 0) / total
}

/** Does this Bash call write a test file? */
export function bashWritesTest(cmd) {
  return bashEdits(cmd).targets.some(isTestPath)
}

/** Does this Bash command remove a test file? */
function removesTestFile(cmd) {
  return splitCommands(cmd).some((seg) => /^rm\b/.test(seg) && isTestPath(seg))
}

/**
 * Base phase of a call, ignoring the failure state:
 * orient | learn | implement | verify | test-authoring | report | other.
 * (debug and tooling-friction are overlays applied by the timeline.)
 */
export function basePhase(call) {
  const name = call.name
  const i = call.input ?? {}
  if (name === 'Skill') return isSygnalSkillCall(call) ? 'learn' : 'other'
  if (name === 'SubagentHandback') return 'report'
  if (META_TOOLS.has(name)) return 'other'
  if (EDIT_TOOLS.has(name)) return isTestPath(i.file_path ?? i.notebook_path) ? 'test-authoring' : 'implement'
  if (READ_TOOLS.has(name)) {
    const p = callText(call)
    if (SKILL_RE.test(p) || LIB_RE.test(p) || DOCS_RE.test(p)) return 'learn'
    if (isTestPath(i.file_path ?? i.path)) return 'test-authoring'
    return 'orient'
  }
  if (name === 'WebFetch' || name === 'WebSearch') return 'learn'
  // Driving the running app by hand (dev server + browser pane) is verification.
  if (/browser|preview|chrome/i.test(name) || ['TaskStop', 'TaskOutput', 'BashOutput', 'KillShell'].includes(name)) return 'verify'
  if (name === 'Bash') {
    const cmd = String(i.command ?? '')
    // An edit that also runs the tests: writing it is the edit phase; the
    // timeline charges the run (the result interval) to verify.
    if (isEditCommand(cmd)) return bashEditPhase(cmd)
    if (isRunCommand(cmd)) return 'verify'
    if (removesTestFile(cmd)) return 'test-authoring'
    if (SKILL_RE.test(cmd) || /node_modules\/(sygnal|react|react-dom|@testing-library|xstream)\b/.test(cmd)) return 'learn'
    if (/^\s*(node|npx\s+tsx|npx\s+node)\s/.test(cmd) && !/node_modules\/\.bin/.test(cmd)) return 'verify'
    return 'orient'
  }
  return 'other'
}

/** Is this call a build/test run (an "iteration" in the harness's sense)? */
export function isVerifyCall(call) {
  return call.name === 'Bash' && isRunCommand(String(call.input?.command ?? ''))
}

/** Does this call edit a file (counts toward edit rounds, like transcript-stats.mjs)? */
export function isEditCall(call) {
  if (EDIT_TOOLS.has(call.name)) return true
  return call.name === 'Bash' && isEditCommand(String(call.input?.command ?? ''))
}

// The coordinator's worktree guard (PLAN-1 subagent trials), or a headless trial's permission posture refusing a call.
const GUARD_RE = /is isolated in the worktree[^\n]*|Refusing to run it|requested permissions to use [^\n]*haven't granted it|Permission to use [^\n]* has been denied/

/** Was the call refused by the environment (worktree guard / permission system) rather than run? */
export function isRefused(result) {
  if (!result) return false
  return !!result.isError && GUARD_RE.test(result.text)
}

/**
 * Outcome of a verify (build/test) result: 'pass' | 'fail' | 'refused' | 'unknown'.
 * Vitest and Vite summaries win over the exit code (output is often piped
 * through `tail`, which hides the exit code).
 */
export function verifyOutcome(result) {
  if (!result) return 'unknown'
  const t = String(result.text ?? '')
  if (isRefused(result)) return 'refused'
  const failedSummary = /(Test Files|Tests)\s+\d+ failed|Failed Suites \d+|Failed Tests \d+|\bFAIL\b\s+\S|error during build|Build failed|RolldownError|Parse failure|Transform failed|\[vite\][^\n]*error/i.test(t)
  if (failedSummary) return 'fail'
  const passSummary = /(Test Files|Tests)\s+\d+ passed|✓ built in|No test files found|built in \d+(ms|s)/.test(t)
  if (passSummary) return 'pass'
  if (result.isError) return 'fail'
  if (/^\s*(SyntaxError|ReferenceError|TypeError|Error):/m.test(t)) return 'fail'
  return 'unknown'
}

/** Outcome of any other command: 'ok' | 'error' | 'refused'. */
export function commandOutcome(result) {
  if (!result) return 'ok'
  if (isRefused(result)) return 'refused'
  return result.isError ? 'error' : 'ok'
}

const ERROR_LINE_RES = [
  /\b(ReferenceError|TypeError|SyntaxError|RangeError|AssertionError|RolldownError|TestingLibraryElementError)\b[^\n]*/,
  /^\s*Error:[^\n]*/m,
  /\b(Unexpected token|Expected a semicolon[^\n]*|Parse failure[^\n]*)/,
  /\b(waitFor\w* timed out[^\n]*)/,
  /error during build[^\n]*/i,
  /Cannot find (module|package)[^\n]*/,
  /\bFAIL\b[^\n]*/,
  /(Test Files|Tests)\s+\d+ failed[^\n]*/,
  /^Error: Exit code \d+/m,
]

/** Normalize an error line: strip ANSI, absolute paths (keep basename), line:col, numbers in durations, quotes noise. */
export function normalizeSignature(line) {
  return String(line ?? '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/(?:\/[\w.@+-]+)+\/([\w.@+-]+)/g, '$1')
    .replace(/:\d+:\d+/g, '')
    .replace(/\b\d+(\.\d+)?\s*ms\b/g, 'Nms')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

/** First meaningful error line of a failing result, normalized. */
export function errorSignature(text) {
  const t = String(text ?? '')
  for (const re of ERROR_LINE_RES) {
    const m = t.match(re)
    if (m) return normalizeSignature(m[0])
  }
  const first = t.split('\n').find((l) => l.trim())
  return normalizeSignature(first ?? '')
}

/**
 * Coarse cause of a failure that matched no catalog entry:
 * 'agent-mistake' (assertion failures, syntax errors, wrong imports in the
 * agent's own code or test), or 'other'.
 */
export function uncataloguedCause(signature) {
  if (/^(Test Files|Tests) \d+ failed|^FAIL\b[^:]*$|^Error: Exit code/.test(signature)) return 'unknown (output truncated)'
  if (/AssertionError|expected .* to (be|equal|contain|have)|TestingLibraryElementError|Unable to find|waitFor\w* timed out|SyntaxError|Unexpected token|Expected a semicolon|is not defined|is not a function|Cannot read propert|Cannot find (module|package)|does not provide an export|FAIL\b|failed/i.test(signature)) return 'agent-mistake'
  return 'other'
}

// What was the agent trying to learn? Matched against the call's input text
// (paths, grep patterns, commands). First match wins.
export const LEARN_TOPICS = [
  ['skill-load', (c) => isSygnalSkillCall(c)],
  ['testing-utility', /testing\.ts|renderComponent|simulateAction|mockDOMSource|waitForState|@testing-library/],
  ['vite-plugin', /vite\/plugin|plugin\.mjs|dist\/vite|vite\.mjs|__sygnal/],
  ['run-mount-api', /function run\b|mountPoint|extra\/run\.ts/],
  ['drivers', /driverFromAsync|driverFactories|makeDriver|custom driver|Custom Driver/i],
  ['abort-reducers', /ABORT|isAbort/],
  ['dom-events', /blur|focusout|nonBubbl|useCapture|preventDefault/],
  ['streams', /debounce|xstream|periodic|flatten|startWith/],
  ['parent-child-props', /CHILD|PARENT|childSource|props/],
  ['events-bus', /EVENTS|eventDriver|Event Bus/],
  ['context', /context|calculated/i],
  ['collections', /Collection|makeCollection|pickCombine/],
  ['dom-isolation', /isolat|DOMSource|DOM\.select/],
  ['types', /index\.d\.ts|\.d\.ts/],
  ['skill-reference', /skills\//],
  ['framework-source', /node_modules\/(sygnal|react|react-dom)/],
]

/** Topic of a learn-phase call. */
export function learnTopic(call) {
  const text = callText(call)
  for (const [topic, test] of LEARN_TOPICS) {
    if (typeof test === 'function' ? test(call) : test.test(text)) return topic
  }
  return 'other'
}
