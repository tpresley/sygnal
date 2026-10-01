// Data-driven recommendations. Each rule reads the aggregates, and emits a
// recommendation only when its evidence is present, with the numbers inline.
// Ranked by the estimated seconds per Sygnal trial they would save.
//
// Each rule also has a precondition (PLAN-2 F6): before recommending a change,
// it checks whether the change is already in place, against the docs agents
// get (installed SKILL.md, llms.txt), the trackers' status column and the
// harness itself (lib/preconditions.mjs). A rule that is done is suppressed
// (listed with the reason), or rewritten to say what is still left when the
// trials show the problem persists despite the change.
import {
  docsContext, isFixed, trackerState, testingSection, apiFactCoverage, documentsChildProps,
  teachesCanonicalModel, driverExampleShowsErrors, recordsHaveUsage, allHeadless,
} from './preconditions.mjs'

const f1 = (x) => (x == null ? '—' : (Math.round(x * 10) / 10).toString())
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)

/**
 * @returns {{ active: object[], suppressed: { id, title, reason }[] }}
 *   active: { id, est, target, title, change, evidence, status: 'new' | 'rewritten', precondition }
 */
export function recommendationSet(agg, records, skill, ctx = null) {
  ctx ??= docsContext({ skill })
  const out = []
  const suppressed = []
  const skip = (id, title, reason) => suppressed.push({ id, title, reason })
  const d = agg.delta
  const item = (k) => d.items.find((x) => x.item === k)?.delta ?? 0
  const sy = records.filter((r) => r.arm === 'sygnal' && r.phases)
  const re = records.filter((r) => r.arm === 'react' && r.phases)
  const cat = Object.fromEntries(agg.catalog.map((c) => [c.id, c]))
  const perSy = (id) => cat[id]?.frictionSecondsPerSygnalTrial ?? 0
  const status = (id) => (ctx.tracker?.[id] ? trackerState(ctx, id) : cat[id]?.status ?? 'open')
  const fixed = (id) => isFixed(ctx, id) || cat[id]?.status === 'fixed'
  const sigCount = (re2) => agg.failures.signatures.filter((s) => s.arm === 'sygnal' && re2.test(s.signature)).reduce((a, s) => a + s.count, 0)
  const learn = agg.overall.sygnal?.learn ?? {}

  const libFiles = agg.skill.library.sygnal.sygnal?.files ?? {}
  const viteReaders = Object.entries(libFiles).filter(([f]) => /dist\/vite/.test(f)).reduce((a, [, n]) => Math.max(a, n), 0)

  // 1. B-007
  if (cat['B-007']) {
    const c = cat['B-007']
    const evidence = `${c.sygnal} Sygnal trials affected (${c.inResults} with failing runs, ${c.inReports} named it in their report, ${c.workarounds} used a workaround). ${sigCount(/__sygnal|app is not defined|Unexpected token|Parse failure|semicolon/)} failing runs with \`__sygnal is not defined\` / \`app is not defined\` / parse errors; ${f1(c.frictionSecondsTotal)} s in total, ${f1(c.frictionSecondsPerAffected)} s per affected trial. ${viteReaders} trials found their workaround by reading the plugin in \`node_modules/sygnal/dist/vite\` (that reading is inside the friction time).`
    if (fixed('B-007')) {
      out.push({
        id: 'B-007', est: perSy('B-007'), target: 'release check', status: 'rewritten',
        precondition: 'B-007 is marked fixed in the tracker',
        title: `B-007 is marked fixed, but it still showed up in ${c.sygnal} Sygnal trials (${f1(perSy('B-007'))} s per trial).`,
        change: 'Check that the trials ran the build with the fix (the tarball in the run manifest), and add a plugin fixture test for each failing shape seen here.',
        evidence,
      })
    } else {
      out.push({
        id: 'B-007', est: perSy('B-007') + (learn['vite-plugin'] ?? 0), target: 'framework + release check', status: 'new',
        precondition: `tracker status: ${status('B-007')}`,
        title: `B-007 (Vite plugin rewrites \`run(\` in test files) is the largest single cost: ${f1(perSy('B-007'))} s per Sygnal trial; tracker status: ${status('B-007')}.`,
        change: 'Fix the transform, and add a fixture test in the plugin suite for each failing shape the agents produced: `app = run(App)` inside `beforeEach`, `const app = run(App, drivers, { mountPoint })` inside a test body, and `run(` in a comment. Re-check with this analyzer that the B-007 row drops to zero.',
        evidence,
      })
    }
  }

  // 2. Testing section in the skill / llms.txt
  {
    const wrote = sy.filter((r) => r.wroteTest).length
    const appr = {}
    for (const r of sy) for (const a of r.testApproach ?? []) appr[a] = (appr[a] ?? 0) + 1
    const reAppr = {}
    for (const r of re) for (const a of r.testApproach ?? []) reAppr[a] = (reAppr[a] ?? 0) + 1
    const sec = testingSection(ctx)
    const testLearn = (learn['testing-utility'] ?? 0) + (learn['run-mount-api'] ?? 0)
    const ta = item('phase:test-authoring')
    const evidence = `Kept Sygnal tests drive the app via ${Object.entries(appr).map(([a, n]) => `${a} ×${n}`).join(', ') || 'nothing'}; React agents converge on ${Object.entries(reAppr).map(([a, n]) => `${a} ×${n}`).join(', ') || 'nothing'}. Test-authoring takes ${f1(ta)} s/trial more in Sygnal; reading testing.ts / run() source ${f1(testLearn)} s/trial. Failed build/test runs: Sygnal ${f1(agg.overallShared.sygnal?.failedRuns.mean)} per trial vs React ${f1(agg.overallShared.react?.failedRuns.mean)}.`
    const title0 = 'Add a "Testing your change" section to the skill and llms.txt'
    if (!wrote) {
      // nothing to say
    } else if (sec.skill && sec.llms) {
      if (testLearn < 1 && ta < 2) skip('testing-section', title0, `done: SKILL.md has "${sec.skill}" and llms.txt has "${sec.llms}"; test-authoring delta ${f1(ta)} s and test-tool learn time ${f1(testLearn)} s/trial are small`)
      else {
        out.push({
          id: 'testing-section', est: Math.max(0, ta) + testLearn, target: 'skill + testing API', status: 'rewritten',
          precondition: `SKILL.md already has "${sec.skill}"; llms.txt has "${sec.llms}"`,
          title: `The skill's testing section ("${sec.skill}") exists, but test authoring still costs Sygnal agents ${f1(ta)} s/trial more than React (${wrote}/${sy.length} wrote a test).`,
          change: `Find what the section doesn't answer${testLearn >= 1 ? `: agents still spent ${f1(testLearn)} s/trial reading testing.ts / run() source` : ' (agents no longer read the test tooling source, so the cost is in writing and running the tests)'}. Compare the kept tests' approach with the recipe, and shorten the gap in the API (e.g. PLAN-2 2-A, E4, E11) rather than adding more text.`,
          evidence,
        })
      }
    } else {
      out.push({
        id: 'testing-section', est: Math.max(0, ta) + testLearn, target: 'skill + llms.txt', status: 'new',
        precondition: `testing section: SKILL.md ${sec.skill ? `"${sec.skill}"` : 'none'}, llms.txt ${sec.llms ? `"${sec.llms}"` : 'none'}`,
        title: `${title0}: ${wrote}/${sy.length} Sygnal agents wrote their own test${sec.skill ? ' (llms.txt has no testing section)' : ', with no documented way to do it'}.`,
        change: "Show one canonical recipe that works on the released build: `renderComponent` with `simulateEvent` / `t.next`, or mount the real app in jsdom (`run(App, drivers, { mountPoint: '#root' })`, dispatch real events, `app.dispose()` in `afterEach`). Put it in SKILL.md itself (every agent reads SKILL.md whole).",
        evidence: `The installed skill ${sec.skill ? 'has a' : 'has no'} testing section. ${evidence}`,
      })
    }
  }

  // 3. renderComponent defects
  {
    const t01 = sy.filter((r) => r.task.startsWith('01-'))
    const t01b006 = t01.filter((r) => r.catalog?.result.includes('B-006')).length
    const hit = ['B-006', 'G-016', 'G-015'].filter((id) => cat[id] && cat[id].frictionSecondsTotal > 0)
    const open = hit.filter((id) => !fixed(id))
    const s = hit.reduce((a, id) => a + perSy(id), 0) + (learn['testing-utility'] ?? 0)
    const evidence = hit.map((id) => `${id}: ${cat[id].sygnal} trials, ${f1(cat[id].frictionSecondsTotal)} s total (${status(id)})`).join('; ') + (t01b006 ? `. ${t01b006}/${t01.length} task-01 Sygnal trials hit \`.data is not a function\` on the starter's own intent when they tried renderComponent.` : '.')
    if (hit.length && s > 0 && open.length) {
      out.push({
        id: 'render-component', est: s, target: 'framework (testing.ts)', status: open.length < hit.length ? 'rewritten' : 'new',
        precondition: `open in the tracker: ${open.join(', ')}${open.length < hit.length ? `; already fixed: ${hit.filter((id) => fixed(id)).join(', ')}` : ''}`,
        title: `Fix \`renderComponent\`'s mock DOM and action plumbing (${open.join(', ')}): ${f1(s)} s per Sygnal trial.`,
        change: [
          open.includes('B-006') && 'give the mock DOM source the same enriched API as the real driver (`.data()`, `.value()`, `.checked()` …, B-006)',
          open.includes('G-016') && 'buffer or await the first event/action after mount (`await t.ready()`, G-016)',
          open.includes('G-015') && 'let `simulateAction` run every sink of the model entry, not only STATE (G-015)',
        ].filter(Boolean).join('; ') + ". Add a test per item that uses the starter apps' own intents.",
        evidence,
      })
    } else if (hit.length && s > 0) {
      out.push({
        id: 'render-component', est: s, target: 'release check', status: 'rewritten',
        precondition: `${hit.join(', ')} marked fixed in the tracker`,
        title: `${hit.join(', ')} are marked fixed, but their signatures still cost ${f1(s)} s per Sygnal trial.`,
        change: 'Check the trials ran a build with the fixes, then look at the failing runs: a new defect with an old signature, or a regression.',
        evidence,
      })
    }
  }

  // 4. Harness guard
  if (cat['HARNESS-GUARD']) {
    const c = cat['HARNESS-GUARD']
    const reMean = c.frictionSecondsPerReactTrial
    const reWall = agg.overall.react?.wall.mean
    const title = `Run trials without the coordinator's worktree guard: it refused commands in ${c.sygnal} Sygnal and ${c.react} React trials, ${f1(c.frictionSecondsPerSygnalTrial)} s vs ${f1(reMean)} s per trial.`
    if (allHeadless(records)) {
      out.push({
        id: 'harness-guard', est: item('friction:HARNESS-GUARD'), target: 'eval harness', status: 'rewritten',
        precondition: 'all trials ran headless (run-trial.mjs), which has no worktree guard',
        title: `Commands were refused even though every trial ran headless (${c.sygnal} Sygnal, ${c.react} React trials).`,
        change: "Read the refused calls: the trial's own permission posture (lib/headless.mjs DEFAULT_TOOLS / permission mode) is refusing something the agents need.",
        evidence: `${c.inResults} trials had refused calls; ${f1(c.frictionSecondsPerSygnalTrial)} s vs ${f1(reMean)} s per trial.`,
      })
    } else {
      out.push({
        id: 'harness-guard', est: item('friction:HARNESS-GUARD'), target: 'eval harness', status: 'new',
        precondition: 'trials were not run headless',
        title,
        change: 'Run trials with the headless runner (`orchestrate.mjs` / `run-trial.mjs`), so compound commands are not refused. Keep the method identical across arms and note the change against the baseline, or subtract HARNESS-GUARD time (this analyzer reports it separately) when comparing.',
        evidence: `It is ${pct(reWall ? reMean / reWall : null)} of a React trial's wall time, which compresses the Sygnal/React ratio and adds noise; ${c.inResults} trials had refused calls. Sygnal pays more (Δ ${f1(item('friction:HARNESS-GUARD'))} s/trial) because its agents run more compound commands.`,
      })
    }
  } else if (allHeadless(records)) {
    skip('harness-guard', "Run trials without the coordinator's worktree guard", 'done: trials ran headless, and no command was refused')
  }

  // 5. Learning the API from source
  {
    const readers = agg.skill.libraryReaders.sygnal
    const files = Object.entries(libFiles).filter(([f]) => /\.\w+$/.test(f)).sort((a, b) => b[1] - a[1]).slice(0, 6)
    const apiTopics = Object.entries(learn).filter(([t]) => !['skill-load', 'skill-reference', 'testing-utility', 'vite-plugin', 'run-mount-api'].includes(t)).sort((a, b) => b[1] - a[1])
    const s = apiTopics.reduce((a, [, v]) => a + v, 0)
    const cov = apiFactCoverage(ctx)
    const missing = cov.filter((f) => !f.inSkill)
    const evidence = `Learn time by topic (s/trial, all Sygnal trials): ${apiTopics.map(([t, v]) => `${t} ${f1(v)}`).join(', ') || 'none'}. Most-read paths: ${files.map(([f, n]) => `\`${f}\` (${n})`).join(', ') || 'none'}. React trials reading library source: ${agg.skill.libraryReaders.react}.`
    const title0 = 'Put the API facts agents dig out of `node_modules/sygnal` into the skill'
    if (readers && missing.length) {
      out.push({
        id: 'api-facts', est: s, target: 'skill + llms.txt', status: missing.length < cov.length ? 'rewritten' : 'new',
        precondition: `missing from SKILL.md: ${missing.map((f) => f.key).join(', ')}${missing.length < cov.length ? `; already there: ${cov.filter((f) => f.inSkill).map((f) => f.key).join(', ')}` : ''}`,
        title: `${title0}: ${readers}/${sy.length} Sygnal trials read framework source or dist.`,
        change: `Add to SKILL.md / llms.txt: ${missing.map((f) => `${f.label}${f.inLlms ? ' (already in llms.txt; copy it)' : ''}`).join('; ')}.`,
        evidence,
      })
    } else if (readers && s >= 2) {
      out.push({
        id: 'api-facts', est: s, target: 'skill', status: 'rewritten',
        precondition: `SKILL.md already covers every tracked API fact (${cov.map((f) => f.key).join(', ')})`,
        title: `${readers}/${sy.length} Sygnal trials still read framework source (${f1(s)} s/trial), although the skill covers the API facts PLAN-1 found missing.`,
        change: 'Read what these trials searched for (the paths and learn topics below) and add only facts that are not in SKILL.md; or, if they are there, find out why agents did not find them (placement, wording).',
        evidence,
      })
    } else if (!missing.length) {
      skip('api-facts', title0, `done: SKILL.md covers ${cov.map((f) => f.key).join(', ')}${readers ? ` (${readers} trials still read library source, ${f1(s)} s/trial)` : ''}`)
    }
  }

  // 6. Props / parent-child docs (G-003)
  {
    const t08 = agg.byTask['08-extract-rating']
    const pc = learn['parent-child-props'] ?? 0
    const secRank = (re2) => agg.skill.sections.filter((x) => x.section.startsWith('references/')).findIndex((x) => re2.test(x.section))
    const r19 = secRank(/#19\. /)
    const title0 = 'Document props in child components (G-003) next to PARENT/CHILD in SKILL.md.'
    if (pc > 0.5 || t08) {
      const done = documentsChildProps(ctx) || fixed('G-003')
      const evidence = `learn: parent-child-props ${f1(pc)} s per Sygnal trial.${t08 ? ` Task 08 (extract a component with props): ${f1(t08.sygnal?.wall.mean)} s vs ${f1(t08.react?.wall.mean)} s for React, with ${f1(t08.sygnal?.phases.learn)} s of learn time per trial.` : ''}${r19 >= 0 && r19 < 6 ? ` component-patterns "19. Parent-Child Communication" is the #${r19 + 1} most-read reference section.` : ''}`
      if (!done) {
        out.push({
          id: 'G-003', est: pc, target: 'skill', status: 'new',
          precondition: `SKILL.md has no child-props example; tracker G-003: ${status('G-003')}`,
          title: title0,
          change: 'One short example: parent renders `<StarRating value={state.food} name="food" />`; child view reads `({ state, value, name })`, child model gets props as the 4th reducer argument, and sends `PARENT: (state, data, next, props) => ({ name: props.name, value: data })`; parent `CHILD.select(StarRating)`.',
          evidence,
        })
      } else if (pc >= 2) {
        out.push({
          id: 'G-003', est: pc, target: 'skill (recipe)', status: 'rewritten',
          precondition: 'SKILL.md already documents child props, PARENT and CHILD.select',
          title: `Child props are documented, but Sygnal agents still spend ${f1(pc)} s/trial learning parent/child wiring.`,
          change: 'Add a worked "extract a component" recipe (props in, PARENT out, CHILD.select, a before/after markup assertion) rather than more API text (PLAN-2 2-D2).',
          evidence,
        })
      } else skip('G-003', title0, `done: SKILL.md shows a child reading props with PARENT/CHILD.select (learn time ${f1(pc)} s/trial)`)
    }
  }

  // 7. B-005
  if (cat['B-005']) {
    const c = cat['B-005']
    const title0 = `Fix \`driverFromAsync\` swallowing rejections (B-005): every agent that met it coded around it (${c.workarounds} workaround(s), ${c.inReports} report(s)).`
    const evidence = `Trials: ${c.trials.join(', ')}. learn: drivers ${f1(learn['drivers'] ?? 0)} s/trial; task 05 Sygnal adds ${f1(agg.byTask['05-driver-quote']?.sygnal?.locAdded.mean)} lines vs ${f1(agg.byTask['05-driver-quote']?.react?.locAdded.mean)} in React.`
    if (!fixed('B-005')) {
      out.push({
        id: 'B-005', est: learn['drivers'] ?? 0, target: 'framework + skill', status: 'new', precondition: `tracker B-005: ${status('B-005')}`,
        title: title0,
        change: "Forward rejections to the app (an `{ error }` value or an error stream) and fix the null/undefined resolve crash; update the skill's driverFromAsync example to show the error path end to end.",
        evidence,
      })
    } else if (!driverExampleShowsErrors(ctx)) {
      out.push({
        id: 'B-005', est: learn['drivers'] ?? 0, target: 'skill', status: 'rewritten', precondition: 'B-005 is fixed, but the skill\'s driverFromAsync example has no `errors()` path',
        title: 'B-005 is fixed, but agents still code around it: show the error path in the skill\'s driver example.',
        change: 'Extend the driverFromAsync example with `.errors()` handling, so agents stop wrapping fetch in try/catch.',
        evidence,
      })
    } else if (c.workarounds > 0) {
      out.push({
        id: 'B-005', est: learn['drivers'] ?? 0, target: 'framework (E2/E3)', status: 'rewritten', precondition: 'B-005 is fixed and the skill shows `errors()`',
        title: `B-005 is fixed and documented, yet ${c.workarounds} trial(s) still wrapped the async call by hand.`,
        change: 'Look at where those agents put the side effect (driver / EFFECT / intent; PLAN-2 F1) before changing docs again.',
        evidence,
      })
    } else skip('B-005', title0, 'done: fixed in the tracker, the skill shows `errors()`, and no trial coded around it')
  }

  // 8. G-018
  if (cat['G-018'] && perSy('G-018') > 0) {
    const c = cat['G-018']
    const evidence = `${c.sygnal} Sygnal trials (task 08) hit it in exact-HTML comparisons or noted it; ${f1(c.frictionSecondsTotal)} s total.`
    out.push(
      fixed('G-018')
        ? { id: 'G-018', est: perSy('G-018'), target: 'release check', status: 'rewritten', precondition: 'G-018 is marked fixed', title: '`data-sygnal-ready` (G-018) is marked fixed but still showed up in markup comparisons.', change: 'Check the trials ran a build with the fix.', evidence }
        : { id: 'G-018', est: perSy('G-018'), target: 'framework', status: 'new', precondition: `tracker G-018: ${status('G-018')}`, title: 'Stop adding `data-sygnal-ready` to every child root (G-018) unless a `<Suspense>` ancestor needs it.', change: 'Emit the attribute only under Suspense (or only in dev), so extracting a component keeps the markup identical.', evidence }
    )
  }

  // 9. Canonical forms
  {
    const ct = agg.canonical
    const sh = ct.forms?.shorthandKeys
    const raw = ct.forms?.rawEventsObjects
    const title0 = 'Teach only the canonical model forms'
    if (sh && (sh.trials || raw?.trials)) {
      const evidence = `${sh.total} shorthand keys in ${sh.trials} trials; ${raw?.total ?? 0} raw EVENTS objects in ${raw?.trials ?? 0}; \`CHILD.select(Component)\` (canonical) in ${ct.forms.childSelectFn?.trials ?? 0}, string form in ${ct.forms.childSelectString?.trials ?? 0}. sygnal-check found ${Object.keys(ct.sygnalCheck).length ? Object.keys(ct.sygnalCheck).join(', ') : 'no diagnostics'} in final code.`
      if (teachesCanonicalModel(ctx)) {
        out.push({
          id: 'canonical-forms', est: 0, target: 'diagnostics', status: 'rewritten',
          precondition: 'SKILL.md already teaches the object form + `event()` and shows no shorthand keys in code',
          title: `The skill teaches only canonical forms, yet ${sh.trials}/${ct.trials} solutions use \`'ACTION | SINK'\` keys and ${raw?.trials ?? 0} raw EVENTS objects.`,
          change: 'Find where agents copied them from (component-patterns.md, docs pages, library source) and whether strict mode / sygnal-check ran in those trials (PLAN-2 E1).',
          evidence,
        })
      } else {
        out.push({
          id: 'canonical-forms', est: 0, target: 'skill + docs', status: 'new', precondition: 'SKILL.md code samples still use shorthand keys, or never show `event()`',
          title: `${title0}: ${sh.trials}/${ct.trials} Sygnal solutions use \`'ACTION | SINK'\` shorthand keys and ${raw?.trials ?? 0} use raw \`EVENTS: s => ({ type, data })\`.`,
          change: 'Replace shorthand in the skill with the object form plus `event()`, and list shorthand only on the alternative-forms page.',
          evidence,
        })
      }
    }
  }

  // 10. Harness metrics
  {
    const title0 = "Record each trial's token and duration totals in results/<run>.json."
    if (recordsHaveUsage(records)) skip('harness-usage', title0, 'done: the scored records carry tokens / duration (score.mjs --tokens / --duration-ms)')
    else {
      out.push({
        id: 'harness-usage', est: 0, target: 'eval harness', status: 'rewritten',
        precondition: 'score.mjs supports --tokens / --duration-ms / --cost-usd, but these records have none',
        title: 'Re-score these trials with usage: score.mjs takes `--tokens`, `--duration-ms` and `--cost-usd` (orchestrate.mjs passes them automatically).',
        change: 'For subagent trials, pass the Agent tool\'s `total_tokens` / `duration_ms`; for new runs use the headless runner, which records cost and billed tokens from the result event.',
        evidence: `Peak context (the only reliable token measure in subagent transcripts) is ${f1((agg.overallShared.sygnal?.peakContext.mean ?? 0) / 1000)}k vs ${f1((agg.overallShared.react?.peakContext.mean ?? 0) / 1000)}k on shared tasks.`,
      })
    }
  }

  const active = out.sort((a, b) => b.est - a.est).map((r) => ({ ...r, title: r.est > 0 ? `${r.title} (est. ≤ ${f1(r.est)} s/trial)` : r.title }))
  return { active, suppressed }
}

/** Active recommendations only (kept for callers of the PLAN-1 API). */
export function recommendations(agg, records, skill, ctx = null) {
  return recommendationSet(agg, records, skill, ctx).active
}
