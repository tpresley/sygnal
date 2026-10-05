#!/usr/bin/env node
/**
 * npm run test:next — PLAN-4.6 R1-R4 test matrix (deleted at R5, when the next core is the core):
 * the suites whose features the next component core (src/core/) implements so far, run with
 * SYGNAL_CORE=next (test/setup-core.js, and the 'sygnal/diagnostics' setup file in the examples,
 * set the internal flag run() and renderComponent() read).
 *
 * Each phase adds its files here (R2: Collection/Switchable/markers, R3: statics, replies,
 * behaviors, R4: diagnostics, devtools, testing internals, SSR, integrations). test/parity/ is
 * always run whole: an area or test a later phase brings is skipped on the next core with that
 * phase in its title (test/parity/harness.js).
 *
 * Usage: node scripts/test-next.mjs [--no-examples]
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** R1: the runtime (store, queue, flush, cells, calculated, context, tag children, actions, teardown); R2 below */
export const FILES = [
  'test/parity/',
  'test/p46-r1-core.test.js',
  'test/p46-r1-pragma-data-c.test.js',
  'test/copied/kanban.copied.test.js',
  'test/copied/todomvc.copied.test.js',
  'test/diagnostics-legacy.test.js',
  'test/diagnostics/events.test.js',
  'test/diagnostics/rxjs.test.js',
  'test/dist-cjs-app.test.js',
  'test/driverFromAsync-dispose.test.js',
  'test/driverFromAsync-early-reply.test.js',
  'test/g224-timer-trigger.test.js',
  'test/p3-g152-data-attr.test.js',
  'test/p3-g172-root-intent-no-model.test.js',
  'test/p3-g176-ready-slow-render.test.js',
  'test/p4-2a-gs11-onerror.test.js',
  'test/p4-2a-gs11-wrappers.test.js',
  'test/p4-3a-element-run.test.js',
  'test/p4-p2b-element-vite.test.js',
  'test/p45-b3-initialize-per-instance.test.js',
  'test/p45-r-g261.test.js',
  'test/p45-r-g271.test.js',
  'test/p45-r3-dom-poke.test.js',
  'test/plan2-e11-fake-timers.test.js',
  'test/review-2e2/b022-syg406-severity.test.js',
  'test/review-2e2/r4-strict-restore.test.js',
  'test/testing-simulate-closest.test.js',
  'test/xstream-extras-3d.test.js',
  // R2: hosts (Collection, Switchable), markers (Portal, Transition, ClientOnly, Suspense, lazy, Slot),
  // fragments, D174, and the R1 review fixes (G-294...G-305)
  'test/p46-r2-hosts.test.js',
  'test/p46-r2-review.test.js',
  'test/p46-g290-symboltree.test.js',
  'test/clientonly.test.js',
  'test/g047-new-item-render-3d.test.js',
  'test/g144-fragment-isolation.test.js',
  'test/g145-bubbling-out-of-children.test.js',
  'test/kanban-timing.test.js',
  'test/p4-2a2-uid-roots.test.js',
  'test/p45-d-g255-g256.test.js',
  'test/p45-d-teardown.test.js',
  'test/p45-r2-dom-poke.test.js',
  'test/plan2-3f-context.test.js',
  'test/plan2-3f-switchable.test.js',
  'test/plan2-e4-real-dom.test.js',
  'test/review-2e2/b025-switchable-mock.test.js',
  'test/review-2e2/g040-html-collection.test.js',
  'test/slot.test.js',
  'test/suspense.test.js',
  // R3: statics (timers, resources, connections, route, head), replies and fetch/socket scope
  // chains, driverFromAsync, behaviors (uses / undo / pager / selection), persist, commands,
  // ELEMENT commands, controls, View Transitions; the R2 review fixes (G-306...G-317)
  'test/p46-r3-review.test.js',
  'test/p46-r3-g315-strip.test.js',
  'test/command.test.js',
  'test/copied/signup-form.copied.test.js',
  'test/driverFactories.test.js',
  'test/head.test.js',
  'test/p3-2a-socket.test.js',
  'test/p3-5-1-fake.test.js',
  'test/p3-5-4a-switchable.test.js',
  'test/p3-5-4c-router-fake.test.js',
  'test/p3-6b-test-traps.test.js',
  'test/p3-g160-connections-fake.test.js',
  'test/p3-g167-statics-no-model.test.js',
  'test/p3-g189-reply-after-delayed-send.test.js',
  'test/p3-head-pause.test.js',
  'test/p3-resource-empty-string.test.js',
  'test/p4-2a2-ssr-behaviors.test.js',
  'test/p4-3a-element-commands.test.js',
  'test/p4-3a-recipes.test.js',
  'test/p4-3b-doc-samples.test.js',
  'test/p4-3b2-persist-astro.test.js',
  'test/p4-3b2-persist-hydrate.test.js',
  'test/p4-3c-timers.test.js',
  'test/p4-3d-recipes.test.js',
  'test/p4-3r-persist.test.js',
  'test/p4-4g1-doc-samples.test.js',
  'test/p4-4g1-undo-coalesce.test.js',
  'test/p4-4p-controls-doc-samples.test.js',
  'test/p4-p1b-doc-samples.test.js',
  'test/p45-r-g257.test.js',
  'test/plan2-4r-fetch.test.js',
  'test/plan2-e2-fetch-driver.test.js',
  'test/router-docs.test.js',
  'test/router-ssr.test.js',
  'test/router.test.js',
]

/** the examples whose features are all in the phases done (R2 added kanban, todomvc, advanced-feature-tests) */
export const EXAMPLES = ['advanced-feature-tests', 'ai-panel-spa', 'getting-started', 'hmr-smoke', 'kanban', 'playground', 'ssr', 'todomvc', 'ts-example-2048']

const env = { ...process.env, SYGNAL_CORE: 'next' }
const run = (cmd, args) => spawnSync(cmd, args, { cwd: repo, env, stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1

let status = run('npx', ['vitest', 'run', ...FILES])
if (!status && !process.argv.includes('--no-examples')) status = run('node', ['scripts/test-examples.mjs', ...EXAMPLES])
process.exit(status)
