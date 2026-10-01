// Preconditions for the analyzer's recommendations (PLAN-2 F6).
//
// A recommendation is only useful if the thing it asks for isn't done yet.
// These checks read the docs agents actually get (the installed sygnal-dev
// skill, llms.txt) and the trackers' status column, so recommend.mjs can
// suppress a recommendation that is already done, or rewrite it to say what
// is left. Pure functions over text; unit-tested in tests/recommend.unit.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { trackerStatus } from '../catalog.mjs'

/**
 * The docs context: { skillText, llmsText, skillSections: [heading], llmsSections, tracker }.
 * `skill` is loadSkill()'s result; SKILL.md is what every agent reads whole.
 */
export function docsContext({ skill = null, llmsText = '', tracker = {} } = {}) {
  const files = skill?.files ?? {}
  const main = files['SKILL.md'] ?? Object.values(files)[0] ?? null
  const skillText = main?.text ?? ''
  const allSkillText = Object.values(files).map((f) => f.text).join('\n')
  return {
    skillText,
    allSkillText,
    skillSections: (main?.sections ?? []).map((s) => s.heading),
    llmsText: String(llmsText ?? ''),
    llmsSections: headings(llmsText),
    tracker,
  }
}

export function headings(text) {
  const out = []
  let fence = false
  for (const l of String(text ?? '').split('\n')) {
    if (/^```/.test(l)) fence = !fence
    const m = !fence && l.match(/^#{1,3}\s+(.*)/)
    if (m) out.push(m[1].trim())
  }
  return out
}

/** Merge the PLAN-1 and PLAN-2 trackers (the later file wins for an ID). */
export function loadTrackers(files) {
  const out = {}
  for (const f of files) Object.assign(out, trackerStatus(f))
  return out
}

export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

export const DEFAULT_TRACKERS = (repoRoot) => ['PLAN-1-status.md', 'PLAN-2-status.md'].map((f) => path.join(repoRoot, 'dev-plans', f))

/** 'fixed' | 'closed' | 'partly fixed' | 'open' | 'unknown' */
export function trackerState(ctx, id) {
  return ctx.tracker?.[id]?.status ?? 'unknown'
}
/** Done for recommendation purposes: fixed, or deliberately closed (won't fix). */
export const isFixed = (ctx, id) => ['fixed', 'closed'].includes(trackerState(ctx, id))

/** The skill's / llms.txt's testing section heading, or null. */
export function testingSection(ctx) {
  return {
    skill: ctx.skillSections.find((h) => /\btest/i.test(h)) ?? null,
    llms: ctx.llmsSections.find((h) => /\btest/i.test(h)) ?? null,
  }
}

/**
 * API facts that agents dug out of node_modules/sygnal in PLAN-1, each with
 * a regex that finds it in the docs. `in` says where each one is documented.
 */
export const API_FACTS = [
  { key: 'child-props', label: 'how a child reads parent props (spread into the view arg; 4th reducer arg)', re: /4th arg|\(state, data, next, props\)|reducers? reads? `?props\./i },
  { key: 'child-select', label: '`CHILD.select(Component)` payload shape', re: /CHILD\.select\(\w+\)[^\n]{0,80}(emits|payload|returned)/i },
  { key: 'run-api', label: '`run(App, drivers, { mountPoint })` and its return value', re: /run\(App, drivers[^\n]*mountPoint[^\n]*(returns|dispose)/i },
  { key: 'abort', label: '`ABORT`', re: /\bABORT\b/ },
  { key: 'focus-events', label: 'which DOM events bubble / how to listen for `blur`/`focus`', re: /focusout/ },
  { key: 'xstream-ops', label: 'the xstream operators available (`debounce`, no RxJS)', re: /debounce\(ms\)|\.compose\(debounce/ },
]

export function apiFactCoverage(ctx) {
  return API_FACTS.map((f) => ({ ...f, inSkill: f.re.test(ctx.skillText), inLlms: f.re.test(ctx.llmsText) }))
}

/** Does the skill show a child reading parent props (G-003)? */
export function documentsChildProps(ctx) {
  return API_FACTS[0].re.test(ctx.skillText) && /PARENT/.test(ctx.skillText) && /CHILD\.select/.test(ctx.skillText)
}

/** `'ACTION | SINK': ...` shorthand model keys taught as a normal form? */
const SHORTHAND_KEY = /['"][A-Z][A-Z0-9_]*\s*\|\s*[A-Z][A-Z0-9_]*['"]\s*:/
/** Section headings (or table cells) that mark the non-canonical column. */
export function teachesCanonicalModel(ctx) {
  const usesEvent = /\bevent\(\s*['"]/.test(ctx.skillText)
  // A shorthand key may appear in the "never write" column of the canonical-forms table; only code samples count.
  const codeOnly = stripTables(ctx.skillText)
  return usesEvent && !SHORTHAND_KEY.test(codeOnly)
}
function stripTables(text) {
  return String(text)
    .split('\n')
    .filter((l) => !/^\s*\|/.test(l))
    .join('\n')
}

/** Does the skill's driverFromAsync example still throw on a non-OK response with no error path? (B-005 docs) */
export function driverExampleShowsErrors(ctx) {
  return /driverFromAsync/.test(ctx.skillText) && /errors\(\)/.test(ctx.skillText)
}

/** Were the records produced by a harness that records usage (tokens/duration)? */
export function recordsHaveUsage(records) {
  return records.some((r) => r.usage?.tokens != null || r.usage?.durationMs != null)
}

/** Were all trials run headless (no coordinator worktree guard)? */
export function allHeadless(records) {
  const withMethod = records.filter((r) => r.method)
  return withMethod.length > 0 && withMethod.every((r) => r.method === 'headless')
}
