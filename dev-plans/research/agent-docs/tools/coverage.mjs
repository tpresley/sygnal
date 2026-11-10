#!/usr/bin/env node
// Fact coverage of the eval tasks (dev-plans/research/agent-docs): which Sygnal facts each task's
// reference solution (evals/agent-ergonomics/hidden/<task>/solution) uses, and whether each
// candidate context still contains them inline, or one read away through a file it names.
//
// A fact is a token of the API, found by regex in the solution: a named import, a static, a
// source method, a sink, a request key, a JSX prop, a t.* helper. A few are semantic: the solution
// uses a shape and the doc must state the rule behind it. This is a lower bound on what a task
// needs (a solution shows one way) and an upper bound on what a doc conveys (a token in a doc
// can sit in a sentence that doesn't help); it compares candidates, it doesn't predict pass rates.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const hidden = path.join(repo, 'evals/agent-ergonomics/hidden')
const cand = path.join(here, '../candidates')
const read = (f) => fs.readFileSync(f, 'utf8')
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
}

// id, regex in the solution, regex in the docs (defaults to the first)
const F = (id, use, doc) => ({ id, use, doc: doc ?? use })
const key = (k) => F(`${k}:`, new RegExp(`\\b${k}:`), new RegExp(`\\b${k}\\b`))
const FACTS = [
  // statics
  ...['intent', 'model', 'initialState', 'calculated', 'context', 'resources', 'connections', 'timers', 'uses', 'persist', 'route', 'head', 'isolatedState', 'onError', 'browser', 'agent', 'viewTransitions'].map((s) => F(`.${s}`, new RegExp(`^\\s*\\w+\\.${s}\\s*=`, 'm'), new RegExp(`\\.${s}\\b|\\b${s}\\b`))),
  // sources
  F('DOM.select().events()', /DOM\.select\(/), F('.value()', /\.value\(/), F('.checked()', /\.checked\(/), F('.key()', /\.key\(/), F(".data('x')", /\.data\('/, /\.data\('/), F('.detail()', /\.detail\(/), F('.target()', /\.target\(/),
  F('STATE.watch', /STATE\.watch/), F('EVENTS.select', /EVENTS\.select/), F('CHILD.select', /CHILD\.select/), F('commands$', /commands\$/), F('props$', /props\$/), F('dispose$', /dispose\$/),
  F('preventDefault: true', /preventDefault: true/), F("DOM 'document'", /(?:select|keydown|click|keyup)\('document'\)/), F('DOM.focusout', /DOM\.focusout/), F('DOM.change', /DOM\.change/, /DOM\.<event>|DOM\.change/), F('DOM.keydown', /DOM\.keydown/), F('DOM.submit', /DOM\.submit/), F('debounce', /\bdebounce\(/), F('.compose', /\.compose\(/), F('xs.merge', /xs\.merge/), F('xs.combine', /xs\.combine/), F('sampleCombine', /sampleCombine/),
  // sinks and reducer shape
  ...['STATE', 'EFFECT', 'PARENT', 'EVENTS', 'HTTP', 'WS', 'ROUTER', 'HEAD', 'ELEMENT', 'PERSIST', 'LLM'].map((s) => F(`${s} sink`, new RegExp(`\\b${s}:`))),
  F('ABORT', /\bABORT\b/), F('next()', /\bnext\('/, /\bnext\('/), F('BOOTSTRAP', /\bBOOTSTRAP\b/), F('DISPOSE', /\bDISPOSE\b/), F('previousState', /\bpreviousState\b/), F('now()', /\bnow\(\)/), F('uuid()', /\buuid\(\)/), F('event()', /\bevent\('/),
  // JSX
  F('<Collection', /<Collection\b/), F('Collection from', /<Collection[^>]*\bfrom=/, /\bfrom=/), F('Collection filter', /<Collection[^>]*\bfilter=/, /\bfilter=/), F('Collection sort', /<Collection[^>]*\bsort=/, /\bsort=/), F('<Switchable', /<Switchable\b/), F('Switchable current', /<Switchable[^>]*\bcurrent=/, /\bcurrent=/), F('instance=', /\binstance=/), F('state= slice', /\bstate="/), F('data={{', /\bdata=\{\{/), F('key= identity', /\bkey=\{`|\bkey=\{\w+\.\w+\}/, /\bkey=/), F('commands=', /\bcommands=/), F('<VirtualCollection', /<VirtualCollection\b/), F('byId', /\bbyId\(/), F('uid()', /\buid\(/),
  // requests and resources
  ...['ok', 'latest', 'query', 'json', 'method', 'abort', 'refresh', 'invalidates', 'invalidate', 'updates', 'tags', 'staleTime', 'refetchEvery', 'keepPrevious', 'multipart', 'timeoutMs', 'more'].map(key),
  F('reply error:', /\berror: '[A-Z_]+'/, /\berror: '/), F('resource status', /\.status === '(?:loading|error|success|idle)'/, /'loading'/), F('refreshing', /\brefreshing\b/),
  // router
  F('href()', /\bhref\('/, /\bhref\(/), F('router.current', /router\.current/), F('router.driver', /router\.driver/), F('ROUTER to', /\bto: '/, /\{ to\b|\bto: '/), F('ROUTER block', /\bblock:/), F('ROUTER replace', /\breplace: true/, /\breplace\b/), F('proceed', /\bproceed\b/), F('route params', /route\.params|\.params\./, /\bparams\b/), F('route query', /route\.query/, /\bquery\b/),
  // sockets
  F('socket spec', /\bsocket:/), F('sse spec', /\bsse:/), F('reconnect', /\breconnect:/), F('willReconnect', /\bwillReconnect\b/), F("WS { to, json }", /\bto: '\w+', json/, /\{ to: '/),
  // timers, commands, elements
  F('timer every', /\bevery:/), F('timer after', /\bafter:/), F('timer frame', /\bframe:/), F('.send(', /\.send\('/, /\.send\(/), F('ELEMENT focus', /\bfocus: '/, /\{ focus: /), F('ELEMENT scrollIntoView', /\bscrollIntoView\b/), F('ELEMENT showModal', /\bshowModal\b/),
  // behaviors
  F('state.form.fields', /form\.fields/), F("'form.DONE'", /form\.DONE/), F("'form.ERRORS'", /form\.ERRORS/), F('form submitting', /form\.submitting/), F('resetOnShow', /\bresetOnShow\b/), F('form submit:', /\bsubmit: '/, /\bsubmit: '/), F('form.ADD/REMOVE', /'form\.(?:ADD|REMOVE)'/), F('isSelected', /\bisSelected\b/), F('canUndo', /\bcanUndo\b/), F('undo coalesce', /\bcoalesce\b/),
  // widgets
  F('widget mount', /\bmount\b[:(]/, /\bmount\b/), F('widget events:', /\bevents: \[/, /\bevents\b/), F('widget dispatch', /\bdispatch\('/, /\bdispatch\b/),
  // TypeScript
  ...['Comp', 'RootComp', 'IntentSources', 'ActionsOf', 'Resource', 'RenderResult', 'ModelFor', 'ModelActions', 'SygnalEvents', 'UsesState', 'UsesActions'].map((t) => F(`type ${t}`, new RegExp(`\\b${t}<?\\b`), new RegExp(`\\b${t}\\b`))),
  // tests the solutions wrote
  ...['ready', 'next', 'settle', 'waitForState', 'simulateEvent', 'simulateAction', 'respond', 'fail', 'requests', 'html', 'query', 'queryAll', 'state', 'states', 'emitted', 'sinkValues', 'expectNoDiagnostics', 'push', 'drop', 'sent', 'stream', 'navigate', 'location', 'widget', 'commands', 'storage', 'timers', 'head'].map((m) => F(`t.${m}`, new RegExp(`\\bt\\.${m}\\b`))),
  // semantic: the shape needs the rule
  F('RULE item removal', /(?:REMOVE|DELETE)[\w]*: \(\) => undefined|STATE: \(\) => undefined/, /=> undefined/),
  F('RULE selectors scoped', /\bPARENT:|CHILD\.select/, /own JSX/),
  F('RULE STATE first', /\bSTATE:[^\n]*\n[^\n]*\b(?:HTTP|PARENT|EVENTS|ROUTER|WS|EFFECT):/, /STATE runs first/),
  F('RULE child no initialState', /\bstate="/, /[Oo]nly the root has|root only|has no `initialState`/),
  F('RULE driver in run()', /run\(\w+, \{/, /run\(\w+, \{ \w+: /),
]

// ---- tasks
function factsOf(task) {
  const dir = path.join(hidden, task, 'solution')
  const files = walk(dir).filter((f) => /\.(jsx?|tsx?)$/.test(f))
  const src = files.map(read).join('\n')
  const found = FACTS.filter((f) => f.use.test(src)).map((f) => ({ id: f.id, doc: f.doc }))
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(sygnal(?:\/[\w/-]+)?)'/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]
      if (name && !found.some((f) => f.id === name)) found.push({ id: name, doc: new RegExp(`\\b${esc(name)}\\b`) })
    }
    if (m[2] !== 'sygnal' && !found.some((f) => f.id === m[2])) found.push({ id: m[2], doc: new RegExp(esc(m[2])) })
  }
  return found
}

// ---- candidates: inline text + the files it names, one read away
const namedFiles = (text, roots) => {
  const seen = new Map()
  for (const m of text.matchAll(/`?([\w./-]+\.(?:md|txt))\b/g)) {
    const rel = m[1].replace(/^node_modules\/sygnal\//, '')
    for (const r of roots) {
      const f = path.join(r, rel)
      if (fs.existsSync(f) && fs.statSync(f).isFile()) { seen.set(path.resolve(f), rel); break }
    }
  }
  return seen
}
const dts = read(path.join(repo, 'dist/index.d.ts'))
function candidate(name, inlineFile, roots, extraInline = [], opts = {}) {
  const inline = [read(inlineFile), ...extraInline.map(read)].join('\n')
  const files = namedFiles(inline, roots)
  // Anything in a directory the candidate names as a whole (`llms/`), and the one-file-per-trigger guides
  const reach = [...files.keys()].map(read).join('\n')
  return { name, bytes: Buffer.byteLength(read(inlineFile)), inline, reach, files: [...files.values()], ...opts }
}
const pkgRoots = [repo, path.join(repo, 'dist/guide')]
const compactRoots = [path.join(cand, 'compact-core'), repo, path.join(repo, 'dist/guide')]
const skillRoots = [path.join(cand, 'compact-skill'), repo, path.join(repo, 'dist/guide')]
const llmsCurrentRoots = [repo, path.join(repo, 'dist/guide')]
const CANDS = [
  candidate('llms.txt (today)', path.join(repo, 'llms.txt'), llmsCurrentRoots),
  candidate('SKILL.md (today)', path.join(repo, 'skills/sygnal-dev/SKILL.md'), [path.join(repo, 'skills/sygnal-dev'), ...pkgRoots]),
  candidate('compact core', path.join(cand, 'compact-core/llms.txt'), compactRoots),
  candidate('compact skill', path.join(cand, 'compact-skill/SKILL.md'), skillRoots),
  candidate('AGENTS.md index only', path.join(cand, 'agents-index/AGENTS.md'), compactRoots),
]

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tasks = fs.readdirSync(hidden).filter((d) => /^\d\d-/.test(d)).sort()
  const rows = []
  const missed = Object.fromEntries(CANDS.map((c) => [c.name, new Map()]))
  const onlyReach = Object.fromEntries(CANDS.map((c) => [c.name, new Map()]))
  for (const task of tasks) {
    const facts = factsOf(task)
    const row = { task, facts: facts.length, cells: {} }
    for (const c of CANDS) {
      let inl = 0, rea = 0
      const miss = []
      for (const f of facts) {
        if (f.doc.test(c.inline)) inl++
        else if (f.doc.test(c.reach)) { rea++; onlyReach[c.name].set(f.id, (onlyReach[c.name].get(f.id) ?? 0) + 1) }
        else { miss.push(f.id); missed[c.name].set(f.id, (missed[c.name].get(f.id) ?? 0) + 1) }
      }
      row.cells[c.name] = { inl, rea, miss }
    }
    rows.push(row)
  }
  const totalFacts = rows.reduce((s, r) => s + r.facts, 0)
  const summary = CANDS.map((c) => {
    const inl = rows.reduce((s, r) => s + r.cells[c.name].inl, 0), rea = rows.reduce((s, r) => s + r.cells[c.name].rea, 0)
    return { name: c.name, bytes: c.bytes, tok: Math.round(c.bytes / 3.6), inlinePct: +((inl / totalFacts) * 100).toFixed(1), reachPct: +(((inl + rea) / totalFacts) * 100).toFixed(1), files: c.files.length, missing: [...missed[c.name]].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}×${n}`), hottestOnDemand: [...onlyReach[c.name]].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([f, n]) => `${f}×${n}`) }
  })
  fs.writeFileSync(path.join(here, '../data/coverage.json'), JSON.stringify({ totalFacts, summary, rows }, null, 1))
  for (const s of summary) console.log(`${s.name}: ${s.bytes} B ≈ ${s.tok} tok · inline ${s.inlinePct}% · inline+1 read ${s.reachPct}% · ${s.files} named files · missing: ${s.missing.join(', ') || 'none'}\n   hottest on-demand: ${s.hottestOnDemand.join(', ')}`)
  // Per-task table
  const short = { 'llms.txt (today)': 'llms', 'SKILL.md (today)': 'skill', 'compact core': 'compact', 'compact skill': 'cskill', 'AGENTS.md index only': 'index' }
  const out = ['| Task | Facts | llms.txt inline | SKILL inline | Compact inline / +1 read | Index inline / +1 read | Compact: not reachable |', '|---|---|---|---|---|---|---|']
  for (const r of rows) {
    const pct = (a, b = r.facts) => `${Math.round((a / b) * 100)}%`
    const c = r.cells
    const miss = c['compact core'].miss
    out.push(`| ${r.task} | ${r.facts} | ${pct(c['llms.txt (today)'].inl)} | ${pct(c['SKILL.md (today)'].inl)} | ${pct(c['compact core'].inl)} / ${pct(c['compact core'].inl + c['compact core'].rea)} | ${pct(c['AGENTS.md index only'].inl)} / ${pct(c['AGENTS.md index only'].inl + c['AGENTS.md index only'].rea)} | ${miss.length ? miss.map((m) => '`' + m + '`').join(' ') : ''} |`)
  }
  fs.writeFileSync(path.join(here, '../data/coverage-table.md'), out.join('\n') + '\n')
}
