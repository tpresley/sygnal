#!/usr/bin/env node
/**
 * S-1 (PLAN-10): a seeded synthetic InspectGraph generator, so the large-app strategies can be
 * measured at 50 / 200 / 500 / 2,000 components and the runs repeat.
 *
 *   node gen.mjs --n 500 [--seed 1] [--out corpus/syn-500.json]
 *   node gen.mjs --all          # syn-50, syn-200, syn-500, syn-2000 and examples.json into corpus/
 *
 *   import { generate, addOne, scanExamples } from './gen.mjs'
 *   (generate / addOne live in sygnal-check/test/fixtures/graph-synth.js, the large-app tests' fixture)
 *
 * The shape is a real app's: one entry (App → Shell → Header / Router / Footer), the Router a
 * Switchable of feature pages, each feature a subtree of depth ~3–8 under src/features/<f>/,
 * Collections and Switchables, view-only leaves (often in their parent's file), shared components
 * under src/components/ rendered by many parents, a few cross-feature renders, extra entries
 * (AdminApp, EmbedWidget) above 200, EVENTS between distant components (NAVIGATE emitted
 * everywhere, selected by Router + PageTracker), context providers at App, StoreShell and the
 * feature pages, duplicate names in different features (List, Item, Header, ...), diagnostics,
 * agent surfaces and behavior-owned actions.
 *
 * Fields beyond today's graph.js (all additive, the planned A-gap fixes; the page falls back to
 * names when they are absent, as in the examples scan):
 *   viewOnly: true   (A-1)  a component with no statics
 *   entry: true      (A-6)  passed to run()
 *   children[].id, events[t].emitterIds / selectorIds   (A-3)  link by id, not by name
 *
 * The task-check targets exist at every size: Router + PageTracker select NAVIGATE; Checkout reads
 * `currency` from StoreShell (not the root); CartLine is rendered by Cart, MiniCart and
 * OrderSummary; a few components have agent surfaces; some have errors.
 */
import fs from 'node:fs'
import { mulberry32, generate, addOne } from '../../../../sygnal-check/test/fixtures/graph-synth.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export { mulberry32, generate, addOne }

export async function scanExamples() {
  const repo = path.resolve(here, '../../../..')
  const { graph } = await import(path.join(repo, 'sygnal-check/src/graph.js'))
  const dirs = fs.readdirSync(path.join(repo, 'examples')).map(d => `examples/${d}/src`).filter(d => fs.existsSync(path.join(repo, d)))
  return graph(dirs, { cwd: repo })
}

const SIZES = [50, 200, 500, 2000]
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
  const dir = path.join(here, 'corpus'); fs.mkdirSync(dir, { recursive: true })
  if (args.includes('--all')) {
    for (const n of SIZES) { const g = generate(n, 1); fs.writeFileSync(path.join(dir, `syn-${n}.json`), JSON.stringify(g)); console.error(`syn-${n}: ${g.components.length} components, ${Object.keys(g.events).length} event types`) }
    const ex = await scanExamples(); fs.writeFileSync(path.join(dir, 'examples.json'), JSON.stringify(ex)); console.error(`examples: ${ex.components.length} components, ${Object.keys(ex.events).length} event types`)
  } else {
    const n = +get('--n', 200), seed = +get('--seed', 1)
    const g = generate(n, seed)
    const out = get('--out'); if (out) fs.writeFileSync(out, JSON.stringify(g)); else process.stdout.write(JSON.stringify(g))
  }
}
