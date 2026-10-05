#!/usr/bin/env node
/**
 * npm run test:next — PLAN-4.6 test matrix (deleted at R5, when the next core is the core): the
 * whole root vitest suite with SYGNAL_CORE=next (test/setup-core.js, and the 'sygnal/diagnostics'
 * setup file in the examples, set the internal flag run() and renderComponent() read), then every
 * example on the next core.
 *
 * R1-R3 listed the files whose features the next core had; since R4 every file runs, except the
 * tests below, each with its reason (PLAN-4.6 §4: a test may be left out only when it tests an
 * internal R5 deletes or a removed form, or pins a behaviour a decision changes; never to skip a
 * behaviour). The disposition column follows 06-test-inventory.md:
 * - DELETE-R5: a removed form (D162-D164); R5 deletes the test (or its runtime half) with it.
 * - CURRENT-ONLY: the current core's mechanism (scheduler, render lag, sinks objects, the
 *   diagnostics core's instance hooks); its behaviour is covered on the next core by the test named.
 * - DECIDED: the old behaviour a decision changes on the next core (the parity / R4 tests pin the new one).
 *
 * Usage: node scripts/test-next.mjs [--no-examples] [--list]
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** whole files left out on the next core: file -> reason */
export const EXCLUDED_FILES = {
  'test/p45-r-g262.test.js': 'DELETE-R5: collection()/switchable() helpers as root peers (.peers, factories; D162/D164)',
  'test/p45-r-g264.test.js': 'DELETE-R5: component() + .components + a string tag (D162/D163)',
  'test/p45-r-g269.test.js': 'DELETE-R5: component() + .peers (D162/D164)',
}

/** single tests left out on the next core: file -> { test title: reason } */
export const EXCLUDED_TESTS = {
  'test/b029-abort-non-state-sinks.test.js': {
    'custom driver sink: a conditional ABORT sends nothing to the driver, with no diagnostics': "DELETE-R5: an 'A | SINK' key (D164); the object-form half of the same test is covered by its PARENT/EFFECT cases",
    'EFFECT: returning ABORT is not reported as an ignored value (SYG219)': "DELETE-R5: an 'A | EFFECT' key (D164)",
  },
  'test/bugfixes-1f.test.js': {
    '.components: a registered name renders that component': 'DELETE-R5: .components (D163)',
    '.hmrActions is validated (SYG604) like under run()': 'DELETE-R5: hmrActions (D164)',
    '.hmrActions fire during an HMR update': 'DELETE-R5: hmrActions (D164)',
  },
  'test/bugfixes-1h.test.js': {
    'a sink is deferred behind a same-tick STATE reducer and then sees its result (B-003)': 'CURRENT-ONLY (06 §2, D165): microtask reducers; parity/timing pins synchronous reducers',
  },
  'test/devtools-timetravel.test.js': {
    'renderComponent basic check': 'CURRENT-ONLY (06 §2): STATE sink internals; p46-r4-devtools covers time travel on both cores',
  },
  'test/diagnostics-core.test.js': {
    'hooks dispatch to registered checks when on': "CURRENT-ONLY: the diagnostics core's instance hooks called by the current core; on the next core the dev entry's adapter (checks/next.ts) dispatches them (diagnostics/*, p46-r4-diagnostics)",
    'a DiagnosticError from onReducer does not kill the state stream': 'CURRENT-ONLY: as above (a check registered without the dev entry)',
    'a DiagnosticError from onRender does not kill the view stream': 'CURRENT-ONLY: as above',
  },
  'test/p3-1a-replies.test.js': {
    'unisolated instances sharing one HTTP source (no scope) each get only their own reply': 'DELETE-R5 (06 §4): component({ ...isolateOpts }) (D162); parity/fetch covers replies per item',
  },
  'test/p4-2r-fixes.test.js': {
    'hmrActions fire in the swapped-in app only': 'DELETE-R5: hmrActions (D164)',
  },
  'test/p4-pf1-collection-lookups.test.js': {
    'items without ids are keyed by index; a write-back adds the index as their id (unchanged behaviour)': "DECIDED (G-306, D169): an id-less item's index id isn't written back; parity/collection, p46-r2-review",
    'an id of 0 is replaced by the index (unchanged behaviour)': 'DECIDED (G-307): id 0 is an id; p46-r2-review',
    'duplicate ids: one item instance per id, and a write-back gives every duplicate the first match (unchanged behaviour)': 'DECIDED (D177): only the first duplicate renders, with SYG424; parity/collection',
  },
  'test/p45-b2-fused-walk.test.js': {
    'form fields are stamped (G-146), their plain siblings are not': 'CURRENT-ONLY: the render-lag stamp (G-146/P45-C); next-core reducers are synchronous and the render follows in the same microtask flush, so no render shows a state older than an input',
    'a hoisted vnode with a field is stamped on every render': 'CURRENT-ONLY: as above',
    'a field and a component in vnodes built with snabbdom h() are found': 'CURRENT-ONLY: as above (the stamp half; the component half runs in p46-r1-core)',
    'a component registered by name (.components) inside a plain tree is instantiated': 'DELETE-R5: .components (D163)',
    'the children of a child component are preprocessed in the parent (a Transition inside)': "CURRENT-ONLY: where the current core's view walk replaces markers; the next core's reconcile walk (R2) handles markers in children (p46-r2-hosts)",
  },
  'test/p45-d-lazy-wiring.test.js': {
    'peers: rendered into the view, with the same sources': 'DELETE-R5: .peers (D164)',
    'hmrActions: sent to the instance after a hot swap only': 'DELETE-R5: hmrActions (D164)',
    'a Collection item has sinks for the drivers only (no props$, children$, CHILD, dispose$; READY and PARENT only when used)': 'CURRENT-ONLY: the per-instance sinks object (the next core has none; 1-2 streams per item, R2 counts)',
  },
  'test/p45-r2-statics.test.js': {
    'component({ view, model, initialState }): initialState deeply, model at the top level': 'DELETE-R5: component() (D162)',
  },
  'test/p45-r3-scheduler.test.js': {
    'more than 100 renders wait for the clock; advancing it now and then keeps them going': 'CURRENT-ONLY (06 §2): the timer loop guard; parity/reentrancy G-283/G-284',
  },
  'test/plan2-1b.test.js': {
    'strict checks report through run()': 'DELETE-R5: a positional view (D164; next: SYG612)',
  },
  'test/testing-simulate.test.js': {
    'targets one Collection item (the first match, or the one picked by the selector)': "DELETE-R5: an 'A | PARENT' key (D164)",
    'collects a driver sink even when no driver is provided': "DELETE-R5: an 'A | HTTP' key (D164); plan2-2a G-064 covers driverless sinks",
    'works with a single-stream intent': 'DELETE-R5: single-stream intent (D164)',
    'onReducer sees the real action; no synthetic action reaches onIntent/onModel': "DELETE-R5 / CURRENT-ONLY: an 'A | STATE' key, and a check registered without the dev entry",
    'restores the mode when the component throws during setup': "DELETE-R5: SYG605 ('|' in an intent name, reserved for the removed 'A | S' keys)",
    'collects diagnostics into t.diagnostics and expectNoDiagnostics() throws on warn/error': 'CURRENT-ONLY: a check registered without the dev entry (t.diagnostics itself: plan2-2a, p4-2b-gs1)',
  },
  'test/testing-utility.test.js': {
    'simulateAction resolves shorthand model entries': "DELETE-R5: 'A | SINK' keys (D164)",
    'DISPOSE with model shorthand fires EFFECT': "DELETE-R5: 'A | SINK' keys (D164)",
  },
  'test/diagnostics/strict-entry.test.js': {
    'renderComponent({ strict: true }) reports SYG501/SYG504 with the dist checks; off by default': 'DELETE-R5 (runtime half, 06 §4): positional view + pipe key; next: SYG612',
  },
  'test/diagnostics/strict.test.js': {
    'reports a view that takes (props, state, context)': 'DELETE-R5 (runtime half): positional view; next: SYG612 (p46-r4-diagnostics)',
    "reports 'ACTION | SINK' keys with the object-form rewrite": 'DELETE-R5 (runtime half): pipe keys; next: SYG612',
    'reports once per component name across live instances': 'DELETE-R5 (runtime half): positional view',
  },
  'test/diagnostics/wiring.test.js': {
    'does not report matched actions, shorthand entries, built-ins or synthetic __ actions': "DELETE-R5 (06 §3): an 'A | EFFECT' key",
    'does not report built-ins, hmrActions, shorthand-expanded entries or single-stream intents': 'DELETE-R5 (06 §3): pipe key, hmrActions, single-stream intent',
  },
  'test/review-2e2/b023-emitter-stamp.test.js': {
    'onBusEmit and the sink value name the emitting component': "DECIDED (D165, PLAN-4.6 §5): FIFO run-to-completion: an action's EVENTS cascade (ROOT_EV) runs before the next simulated input (HELLO); the emitter names it pins hold (p4-2c-actions, inspect)",
  },
  'test/review-2e2/g043-syg213-message.test.js': {
    'SYG213 message says both run, and both do': "DELETE-R5: an 'A | SINK' key next to the longhand (D164)",
  },
}

/** the examples run on the next core (all of them since R2) */
export const EXAMPLES = ['advanced-feature-tests', 'ai-panel-spa', 'getting-started', 'hmr-smoke', 'kanban', 'playground', 'ssr', 'todomvc', 'ts-example-2048']

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const titles = Object.values(EXCLUDED_TESTS).flatMap((o) => Object.keys(o))
// vitest -t: every test whose full name contains none of the excluded titles
const pattern = `^(?!.*(?:${titles.map(esc).join('|')})).*$`

if (process.argv.includes('--list')) {
  for (const [f, r] of Object.entries(EXCLUDED_FILES)) console.log(`${f}  (whole file)  ${r}`)
  for (const [f, o] of Object.entries(EXCLUDED_TESTS)) for (const [t, r] of Object.entries(o)) console.log(`${f} > ${t}  ${r}`)
  process.exit(0)
}

const env = { ...process.env, SYGNAL_CORE: 'next' }
const run = (cmd, args) => spawnSync(cmd, args, { cwd: repo, env, stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1

let status = run('npx', ['vitest', 'run', ...Object.keys(EXCLUDED_FILES).flatMap((f) => ['--exclude', f]), '-t', pattern])
if (!status && !process.argv.includes('--no-examples')) status = run('node', ['scripts/test-examples.mjs', ...EXAMPLES])
process.exit(status)
