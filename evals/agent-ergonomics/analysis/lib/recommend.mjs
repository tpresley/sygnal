// Data-driven recommendations. Each rule reads the aggregates, and emits a
// recommendation only when its evidence is present, with the numbers inline.
// Ranked by the estimated seconds per Sygnal trial they would save.

const f1 = (x) => (x == null ? '—' : (Math.round(x * 10) / 10).toString())
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)

export function recommendations(agg, records, skill) {
  const out = []
  const d = agg.delta
  const item = (k) => d.items.find((x) => x.item === k)?.delta ?? 0
  const sy = records.filter((r) => r.arm === 'sygnal' && r.phases)
  const re = records.filter((r) => r.arm === 'react' && r.phases)
  const cat = Object.fromEntries(agg.catalog.map((c) => [c.id, c]))
  const perSy = (id) => cat[id]?.frictionSecondsPerSygnalTrial ?? 0
  const status = (id) => cat[id]?.status ?? 'open'
  const sigCount = (re2) => agg.failures.signatures.filter((s) => s.arm === 'sygnal' && re2.test(s.signature)).reduce((a, s) => a + s.count, 0)
  const learn = agg.overall.sygnal?.learn ?? {}

  const libFiles = agg.skill.library.sygnal.sygnal?.files ?? {}
  const viteReaders = Object.entries(libFiles).filter(([f]) => /dist\/vite/.test(f)).reduce((a, [, n]) => Math.max(a, n), 0)
  // 1. B-007
  if (cat['B-007']) {
    const c = cat['B-007']
    const forms = { 'import { run as X }': 0, 'import * as S': 0, '`import.meta.hot` comment': 0, "`S['ru'+'n']`": 0, 'vitest config without the plugin': 0 }
    for (const r of sy) {
      const t = (r.selfReported ?? []).join(' ') + ' ' + JSON.stringify(r.catalog)
      if (/run as \w+|startApp|mount\b/.test(t)) forms['import { run as X }']++
      if (/import \* as|namespace import|S\.run|sygnal\.run|sygnal\['run'\]/.test(t)) forms['import * as S']++
      if (/import\.meta\.hot/.test(t)) forms['`import.meta.hot` comment']++
      if (/'ru'\s*\+\s*'n'/.test(t)) forms["`S['ru'+'n']`"]++
      if (/config without|without the sygnal Vite plugin/i.test(t)) forms['vitest config without the plugin']++
    }
    out.push({
      est: perSy('B-007') + (learn['vite-plugin'] ?? 0),
      target: 'framework + release check',
      title: `B-007 (Vite plugin rewrites \`run(\` in test files) is the largest single cost: ${f1(perSy('B-007'))} s per Sygnal trial; tracker status: ${status('B-007')}.`,
      change: 'Make sure the 44daa86 fix is in the Phase 4 tarball, and add a fixture test in the plugin suite for each failing shape the agents produced: `app = run(App)` inside `beforeEach`, `const app = run(App, drivers, { mountPoint })` inside a test body, and `run(` in a comment. Re-check with this analyzer that the B-007 row drops to zero.',
      evidence: `${c.sygnal} Sygnal trials affected (${c.inResults} with failing runs, ${c.inReports} named it in their report, ${c.workarounds} used a workaround). ${sigCount(/__sygnal|app is not defined|Unexpected token|Parse failure|semicolon/)} failing runs with \`__sygnal is not defined\` / \`app is not defined\` / parse errors; ${f1(c.frictionSecondsTotal)} s in total, ${f1(c.frictionSecondsPerAffected)} s per affected trial. ${viteReaders} trials found their workaround by reading the plugin in \`node_modules/sygnal/dist/vite\` (that reading is inside the friction time).`,
    })
  }

  // 2. Test recipe in the skill / llms.txt
  {
    const wrote = sy.filter((r) => r.wroteTest).length
    const appr = {}
    for (const r of sy) for (const a of r.testApproach ?? []) appr[a] = (appr[a] ?? 0) + 1
    const reAppr = {}
    for (const r of re) for (const a of r.testApproach ?? []) reAppr[a] = (reAppr[a] ?? 0) + 1
    const hasTesting = Object.values(skill.files).some((f) => f.sections.some((s) => /test/i.test(s.heading)))
    const testLearn = (learn['testing-utility'] ?? 0) + (learn['run-mount-api'] ?? 0)
    const ta = item('phase:test-authoring')
    if (wrote) {
      out.push({
        est: Math.max(0, ta) + testLearn,
        target: 'skill + llms.txt',
        title: `Add a "Testing your change" section to the skill and llms.txt: ${wrote}/${sy.length} Sygnal agents wrote their own test, with no documented way to do it.`,
        change: "Show one canonical recipe that works on the released build: mount the real app in jsdom (`document.body.innerHTML = '<div id=\"root\"></div>'; const app = run(App, drivers, { mountPoint: '#root' })`, an `await tick()` helper, dispatch real events, `app.dispose()` in `afterEach`), plus when to use `renderComponent` and its limits. Put it in SKILL.md itself (every agent reads SKILL.md whole; only some open component-patterns.md).",
        evidence: `The installed skill ${hasTesting ? 'has a' : 'has no'} testing section. Kept Sygnal tests drive the app via ${Object.entries(appr).map(([a, n]) => `${a} ×${n}`).join(', ') || 'nothing'}; React agents converge on ${Object.entries(reAppr).map(([a, n]) => `${a} ×${n}`).join(', ') || 'nothing'}. Test-authoring takes ${f1(ta)} s/trial more in Sygnal; reading testing.ts / run() source ${f1(testLearn)} s/trial. Failed build/test runs: Sygnal ${f1(agg.overallShared.sygnal?.failedRuns.mean)} per trial vs React ${f1(agg.overallShared.react?.failedRuns.mean)}.`,
      })
    }
  }

  // 3. renderComponent defects
  {
    const t01 = sy.filter((r) => r.task.startsWith('01-'))
    const t01n = t01.length
    const t01b006 = t01.filter((r) => r.catalog?.result.includes('B-006')).length
    const ids = ['B-006', 'G-016', 'G-015'].filter((id) => cat[id])
    const s = ids.reduce((a, id) => a + perSy(id), 0) + (learn['testing-utility'] ?? 0)
    if (ids.length && s > 0) {
      out.push({
        est: s,
        target: 'framework (1C)',
        title: `Fix \`renderComponent\`'s mock DOM and action plumbing (${ids.join(', ')}): ${f1(s)} s per Sygnal trial.`,
        change: 'Give the mock DOM source the same enriched API as the real driver (`.data()`, `.value()`, `.checked()` …, B-006); buffer or await the first event/action after mount (`await t.ready()`, G-016); let `simulateAction` run every sink of the model entry, not only STATE (G-015). Add a test per item that uses the starter apps\' own intents (`DOM.change(\'.toggle\').data(\'id\', Number)`, `DOM.input(...).value()`).',
        evidence: ids.map((id) => `${id}: ${cat[id].sygnal} trials, ${f1(cat[id].frictionSecondsTotal)} s total (${status(id)})`).join('; ') + (t01b006 ? `. ${t01b006}/${t01n} task-01 Sygnal trials hit \`.data is not a function\` on the starter's own intent when they tried renderComponent.` : '.'),
      })
    }
  }

  // 4. Harness guard
  if (cat['HARNESS-GUARD']) {
    const c = cat['HARNESS-GUARD']
    const reMean = c.frictionSecondsPerReactTrial
    const reWall = agg.overall.react?.wall.mean
    out.push({
      est: item('friction:HARNESS-GUARD'),
      target: 'eval harness',
      title: `Run trials without the coordinator's worktree guard: it refused commands in ${c.sygnal} Sygnal and ${c.react} React trials, ${f1(c.frictionSecondsPerSygnalTrial)} s vs ${f1(reMean)} s per trial.`,
      change: 'Spawn Phase 4 trials headless from the trial dir (run.md step 2, "stronger isolation"), or from a coordinator session that is not worktree-pinned, so `cd X && cat > f <<EOF … && npm test` chains run. Keep the method identical across arms and note the change against the baseline, or subtract HARNESS-GUARD time (this analyzer reports it separately) when comparing.',
      evidence: `It is ${pct(reWall ? reMean / reWall : null)} of a React trial's wall time, which compresses the Sygnal/React ratio and adds noise; ${c.inResults} trials had refused calls. Sygnal pays more (Δ ${f1(item('friction:HARNESS-GUARD'))} s/trial) because its agents run more compound commands.`,
    })
  }

  // 5. Learning the API from source
  {
    const readers = agg.skill.libraryReaders.sygnal
    const files = Object.entries(libFiles).filter(([f]) => /\.\w+$/.test(f)).sort((a, b) => b[1] - a[1]).slice(0, 6)
    const apiTopics = Object.entries(learn).filter(([t]) => !['skill-load', 'skill-reference', 'testing-utility', 'vite-plugin', 'run-mount-api'].includes(t)).sort((a, b) => b[1] - a[1])
    const s = apiTopics.reduce((a, [, v]) => a + v, 0)
    if (readers) {
      out.push({
        est: s,
        target: 'skill + llms.txt',
        title: `Put the API facts agents dig out of \`node_modules/sygnal\` into the skill: ${readers}/${sy.length} Sygnal trials read framework source or dist (React trials: ${agg.skill.libraryReaders.react}).`,
        change: 'Add a compact API reference to SKILL.md / llms.txt covering what they searched for: how a child reads parent props (spread into the view arg; 4th reducer arg), `CHILD.select(Component)` payload shape, `run(App, drivers, { mountPoint })` and its return value, `ABORT`, which DOM events bubble and how to listen for `blur`/`focus` (agents grepped the dist for `focusout`/`nonBubbling`), and the xstream operators available (`debounce` from `xstream/extra/debounce`, no RxJS).',
        evidence: `Learn time by topic (s/trial, all Sygnal trials): ${apiTopics.map(([t, v]) => `${t} ${f1(v)}`).join(', ')}. Most-read paths: ${files.map(([f, n]) => `\`${f}\` (${n})`).join(', ')}. React agents read no library source at all.`,
      })
    }
  }

  // 6. Props / parent-child docs (G-003)
  {
    const t08 = agg.byTask['08-extract-rating']
    const pc = learn['parent-child-props'] ?? 0
    if (pc > 0.5 || t08) {
      out.push({
        est: pc,
        target: 'skill',
        title: 'Document props in child components (G-003) next to PARENT/CHILD in SKILL.md.',
        change: 'One short example: parent renders `<StarRating value={state.food} name="food" />`; child view reads `({ state, value, name })`, child model gets props as the 4th reducer argument, and sends `PARENT: (state, data, next, props) => ({ name: props.name, value: data })`; parent `CHILD.select(StarRating)`.',
        evidence: `learn: parent-child-props ${f1(pc)} s per Sygnal trial.${t08 ? ` Task 08 (extract a component with props) is the slowest tier-1 Sygnal task: ${f1(t08.sygnal?.wall.mean)} s vs ${f1(t08.react?.wall.mean)} s for React, with ${f1(t08.sygnal?.phases.learn)} s of learn time per trial.` : ''} \`component-patterns.md\` sections 18/19 (events, parent-child) are among the most-read.`,
      })
    }
  }

  // 7. B-005
  if (cat['B-005']) {
    const c = cat['B-005']
    out.push({
      est: (learn['drivers'] ?? 0),
      target: 'framework (1F) + skill',
      title: `Fix \`driverFromAsync\` swallowing rejections (B-005): every agent that met it coded around it (${c.workarounds} workaround(s), ${c.inReports} report(s)).`,
      change: 'Forward rejections to the app (an `{ error }` value or an error stream) and fix the null/undefined resolve crash; update the skill\'s driverFromAsync example (it uses `if (!response.ok) throw`, which leads straight into the bug) to show the error path end to end.',
      evidence: `Trials: ${c.trials.join(', ')}. The cost is not in failures (agents read the source first) but in reading it: learn: drivers ${f1(learn['drivers'] ?? 0)} s/trial, and longer driver code (task 05 Sygnal adds ${f1(agg.byTask['05-driver-quote']?.sygnal?.locAdded.mean)} lines vs ${f1(agg.byTask['05-driver-quote']?.react?.locAdded.mean)} in React).`,
    })
  }

  // 8. G-018
  if (cat['G-018'] && perSy('G-018') > 0) {
    const c = cat['G-018']
    out.push({
      est: perSy('G-018'),
      target: 'framework',
      title: 'Stop adding `data-sygnal-ready` to every child root (G-018) unless a `<Suspense>` ancestor needs it.',
      change: 'Emit the attribute only under Suspense (or only in dev), so extracting a component keeps the markup identical.',
      evidence: `${c.sygnal} Sygnal trials (task 08) hit it in exact-HTML comparisons or noted it; ${f1(c.frictionSecondsTotal)} s total.`,
    })
  }

  // 9. Canonical forms
  {
    const ct = agg.canonical
    const sh = ct.forms?.shorthandKeys
    const raw = ct.forms?.rawEventsObjects
    const readShorthand = (agg.skill.sections.find((s) => /Model Shorthand/.test(s.section) && s.section.startsWith('references'))?.trials) ?? 0
    if (sh && (sh.trials || raw?.trials)) {
      out.push({
        est: 0,
        target: 'skill + docs (Phase 3)',
        title: `Teach only the canonical model forms: ${sh.trials}/${ct.trials} Sygnal solutions use \`'ACTION | SINK'\` shorthand keys and ${raw?.trials ?? 0} use raw \`EVENTS: s => ({ type, data })\`.`,
        change: "SKILL.md's \"Model Shorthand Syntax\" section is read by every agent and is what they copy. Replace it with the object form plus `event()` (C5/C6), and list shorthand only on the alternative-forms page; otherwise 2A strict mode will flag most agent-written code.",
        evidence: `${sh.total} shorthand keys in ${sh.trials} trials; ${raw?.total ?? 0} raw EVENTS objects in ${raw?.trials ?? 0}; \`CHILD.select(Component)\` (canonical) in ${ct.forms.childSelectFn?.trials ?? 0}, string form in ${ct.forms.childSelectString?.trials ?? 0}. component-patterns "17. Model Shorthand" was opened in ${readShorthand} trials. sygnal-check found ${Object.keys(ct.sygnalCheck).length ? Object.keys(ct.sygnalCheck).join(', ') : 'no diagnostics'} in final code, so the wiring itself was right.`,
      })
    }
  }

  // 10. Harness metrics
  out.push({
    est: 0,
    target: 'eval harness',
    title: 'Record the Agent tool\'s own token and duration totals per trial in results/<run>.json.',
    change: 'Transcript `output_tokens` are partial (each streamed message logs an early count, often 16), so output tokens cannot be recovered afterwards. Store `total_tokens` / `duration_ms` from the Agent result next to `wallSeconds`, and run `analysis/analyze.mjs` as step 6 of run.md.',
    evidence: `Peak context (the reliable token measure here) is ${f1((agg.overallShared.sygnal?.peakContext.mean ?? 0) / 1000)}k vs ${f1((agg.overallShared.react?.peakContext.mean ?? 0) / 1000)}k on shared tasks; the transcripts' summed output tokens are ~100–2,000 per trial, which is implausibly low.`,
  })

  return out.sort((a, b) => b.est - a.est).map((r) => ({ ...r, title: r.est > 0 ? `${r.title} (est. ≤ ${f1(r.est)} s/trial)` : r.title }))
}
