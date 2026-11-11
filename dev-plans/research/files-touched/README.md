# Why a Sygnal change touches more files than the React one

**Status (2026-11-09).** Diagnosis and rewritten reference solutions are done, and `App.drivers` is built to shippable quality on this branch: diagnostic, fix text, `--fix`, graph, docs, one template. No model was run (the eval data on disk only). **Maintainer decision, 2026-11-09: `App.drivers` is the canonical place for feature drivers; `run(App, {...})` stays for what differs per environment.** Applied on this branch: `PLAN-1-canonical-forms.md` C21, the docs, the examples and the `create-sygnal-app` templates. No strict-mode code for the `run()` form (`BACKLOG-8.0.md` B8-5).

Starting point: the same feature touches 1.1–1.3× more source files in the Sygnal arm on every model, and 1.31× in the reference solutions (2.87 against 2.38 files), per `dev-plans/research/read-side-eval/` on branch `claude/musing-tu-93ce47`. Tests are excluded from that count; the test files are discussed separately below.

## Result in one paragraph

The gap is almost entirely the edit to `main.js`. Entry-point driver wiring is 64% of the reference gap and 89% of the pooled trial gap. The second cause is the TypeScript fixtures' `types.ts` / `events.ts`. The guess that "intent, model and view live in more places" is **wrong** for files: existing components are touched equally (2.09 vs 2.11 per task in the references, 2.01 vs 2.03 in trials), and new component files are equal too. A root-level `App.drivers` static, which moves the wiring to the file the feature already edits, takes the reference gap from 1.31× to 1.14× and pooled trials from 1.19× to 1.02×. It costs 5 B in the gate. Every "supply the driver implicitly" option is weaker on the numbers and worse on the framework's own thesis.

## Cause table

Exact decomposition: per task, Sygnal files − React files = sum over files of (Sygnal touch rate − React touch rate), grouped by cause, so the rows add to the gap with no remainder. Reproduce with `node dev-plans/research/files-touched/classify.mjs` (writes `cause-table.md`, including the per-task list of which file was extra).

### Reference solutions (45 tasks; 2.87 vs 2.38, gap 0.49 files per task, 1.31×)

| Cause | Sygnal | React | Net | Share of gap | S/R if removed |
|---|---|---|---|---|---|
| Entry point `main.js` (driver wiring) | 0.31 | 0.00 | +0.31 | **64%** | 1.13× |
| Types / events file (`types.ts`, `events.ts`, TS tier only) | 0.11 | 0.02 | +0.09 | 18% | 1.26× |
| Hand-written driver file (`quoteDriver.js`, `searchDriver.js`, `chatSocket.js`) | 0.07 | 0.00 | +0.07 | 14% | 1.28× |
| Routes module (`routes.js`) | 0.04 | 0.00 | +0.04 | 9% | 1.30× |
| New component file | 0.18 | 0.13 | +0.04 | 9% | 1.23× |
| New helper module | 0.07 | 0.11 | −0.04 | −9% | 1.28× |
| Existing component or module | 2.09 | 2.11 | −0.02 | −5% | (not meaningful) |

Notes from the per-task list:

- `main.js`: 14 tasks (05, 11, 13, 17, 22–26, 30, 44–47). Every one of them also touches `App.jsx`.
- Hand-written driver files are mostly a reference-solution style, not the framework: trials write them at a rate of 0.00–0.01 per task, because agents use `resources` / `makeFetchDriver`. The references predate those built-ins (05, 11 and 22 could use them; 26's `draft.js` could be inline).
- `routes.js` is offset by React's own extra module in the same task (25 has `tasks.js` on the React side). It costs nothing net against React in task 25; task 43 edits one line in the existing file.
- New components: 13 adds `CourseItem.jsx` where React keeps an `<li>`, because a list item with its own actions is a component in Sygnal. 32 adds a `SalesChart.js` widget. React adds as many elsewhere (13 `api.js`, 47 `agentTools.js`).
- Existing files, the genuine design costs: 28 (`App.jsx` must reset the slice because state outlives the child), 40 (the child emits an event React computes in the parent), 45 and 47 (agent tools live on each component, not in one module). Those are offset by React's own (38, 39, 12, 41).

### Trials (passing trials, newest mainline run per cell)

| Group | Sygnal vs React | Ratio | `main.*` share of gap | Types share | All others |
|---|---|---|---|---|---|
| Opus 5.5 (36 tasks) | 2.56 vs 2.01 | 1.33× | 78% | 25% | −3% |
| Sonnet 5.5 (33) | 2.61 vs 2.44 | 1.12× | 128% | 0% | −28% |
| Haiku 4.5 (29) | 2.88 vs 2.65 | 1.11× | 45% | 70% | −15% |
| Haiku 5.5 (4) | 2.75 vs 2.45 | 1.21× | 333% (small gap) | 0% | |
| All models pooled (102) | 2.67 vs 2.35 | 1.19× | **89%** | 29% | −18% |

The React arm's entry-file rate is 0.00 on every model. Agents put React's providers (`<BrowserRouter>`, `QueryClientProvider`) in `App.jsx`, even though both frameworks have a `main` entry; that is the model `App.drivers` copies. Sygnal agents touch the entry on nearly every driver task (rate 0.8–1.0 for 05, 11, 13, 17, 22–26, 28, 30, 44–47), and the 398 trials that do also edit `App.*` every time (`scenarios-table.md`).

### Checking the guess

| Guess | Verdict |
|---|---|
| Wiring a driver in `main.js` | Right, and it is most of the gap |
| An extra module (`src/routes.js`) | Small (9% references, ~9% pooled trials), and offset in practice |
| Intent, model and view living in more places | Wrong for files. It is real inside files (next section) |

## Reading a feature: files versus spread inside a file

`reading.mjs` (`reading-table.md`) reads the 45 finished reference solutions, tests excluded.

| Question | Sygnal | React | S/R |
|---|---|---|---|
| Files the diff touches | 2.87 | 2.38 | 1.31× |
| Files with behaviour (no entry point, types file or route table) | 2.40 | 2.36 | **1.09×** |
| Local-import closure of those files (everything a reader may follow) | 3.53 | 3.60 | **1.04×** |
| Change regions inside them (`git diff -U0` hunks) | 9.67 | 8.67 | 1.18× |
| Kinds of code changed per task (view / intent / model / context / state / a declaration vs hooks / effect / handler / JSX) | 6.78 | 5.49 | 1.28× |

So the two kinds of spread separate cleanly. To understand a feature, a reader opens about the same number of files in both frameworks (1.04–1.09×); the extra file in a Sygnal diff is the one that says which driver is wired, which is one line of no behavioural interest. The spread that is real is inside a file: a Sygnal change lands in more separate regions and more kinds of section (intent, model and view are separate top-level statements, while a React handler sits next to its state). That cost is the design's trade: each section has one job. It is a cost, of about 1.2–1.3×, and it is paid in scrolling within one file, not in opening another. Note the sections measure is a heuristic: a React handler defined inline in JSX counts as view.

## Fixes, measured

Reference numbers come from real rewritten trees (`rewrite.mjs`), checked by the hidden suites (see "Verification"), except where marked estimate. "Gap closed" is the share of (ratio − 1) removed. `scenarios-table.md` has every number.

| Fix | References | Pooled trials | Opus | Gap closed (refs / trials) |
|---|---|---|---|---|
| Today | 1.31× [1.16, 1.48] | 1.19× [1.12, 1.27] | 1.33× | |
| A. Vite plugin or `run()` default supplies a zero-option driver | 1.26× (as written), 1.20× if five references used built-ins | 1.08× (upper bound) | 1.14× | 16–35% / 58% |
| **F1. `App.drivers` on the root** | **1.14× [1.04, 1.25]** | **1.02× [0.98, 1.06]** | 1.06× | **55% / 89%** |
| F2. TypeScript state and event types next to the code | 1.27× | 1.15× | 1.27× | 12% / 19% |
| F1 + F2 | 1.11× [1.01, 1.22] | 0.99× [0.95, 1.03] | 1.02× | 66% / 105% |
| F1 + F2, references updated to built-ins (estimate) | 1.04× [0.97, 1.13] | n/a (trials already do this) | | 87% / |
| + no `routes.js` (estimate) | 1.03× | n/a | | 89% / |

A closes less because it can only act where a driver takes no options: `queryCache()` (24), a chat transport (44–46) and a router (25) all need configuration, so `main.js` comes back for exactly those features.

### Option comparison: standard drivers without an edit to `main.js`

| | A. `sygnal/vite` infers drivers | B. `run(App)` supplies defaults | C. `App.drivers` (F1) |
|---|---|---|---|
| Size gate (kanban, gated at 40,457 B) | 0 B (kanban declares none), not built | **+11,242 B** (51,699 B, measured: static imports of fetch, timer and socket drivers in `run.ts`). A dynamic `import()` can't work: `start()` is synchronous and hands the sources to the root at construction | **+5 B** (40,462 B, measured) |
| App not using the feature | Pays nothing | Pays for all drivers | Pays 5 B, once, for the merge; no driver code |
| `baseUrl`, `queryCache`, a transport | Only via `run(App, {...})`, so `main.js` returns | The same | In the static: `App.drivers = { HTTP: makeFetchDriver({ cache: queryCache() }) }`; `run()`'s argument overrides by name |
| Outside Vite | Silently absent in any build that doesn't go through `sygnal/vite` (esbuild, webpack): the same code runs differently | Works | Works everywhere (`run()`, terminal, agent-ui, react-native, Vike and Astro client all pass through `start()`) |
| Tests (`renderComponent`) | Unaffected | Unaffected | Ignored: `useDefaultDrivers: false` (`test/root-drivers.test.js`) |
| Readability | Nothing in the source shows the driver | Nothing in the source shows the driver | One line, in the file a reader of the feature already has open |

**Where the line should be.** A driver is a capability granted to an app, with effects outside it (the network, sockets, storage). The grant should be written once, in source, where a reader of the feature sees it. C keeps that: it moves the same line, unchanged, closer to its use. A and B remove the line, so a reader of a diff that adds `App.resources` can no longer tell whether a real HTTP client exists, and a future `sygnal-check` must re-derive the rule the plugin applied. The plugin may *suggest* (it already reports SYG643) and `sygnal-check --fix` could write the line; neither should supply it silently.

Rejected alternatives: pre-wiring every driver in the template's `main.js` breaks "an app pays nothing" (it is B in the template). A `.drivers` static on any component needs the runtime to install drivers after start and to resolve two declarations of the same sink, which is real core cost and a merge rule to explain; root-only is the simple case and the eval shows it is enough (every trial that edits `main.*` already edits `App.*`).

A zero-byte variant exists: keep the runtime unchanged, and have templates and starters write `run(App, App.drivers)`. It costs nothing in the gate. Its downside is that an app whose `main.js` is plain `run(App)` silently ignores `App.drivers` (SYG643 fires for `timers`, `connections`, `resources`; not for an arbitrary custom sink), and every existing app needs the one-line change first.

## Prototype and size

`App.drivers`, implemented:

- `src/core/runtime.ts`: `start()` merges the root's `drivers` static into the drivers when `useDefaultDrivers` is on (so `renderComponent` ignores it); `run()`'s second argument still overrides by name.
- `src/index.d.ts`: the static on the root component type.
- `sygnal-check`: `App.drivers` is a recognized static and counts as wiring for SYG643 and SYG609 (`src/model/apps.js`, `project.js`).

Tests: `test/root-drivers.test.js` (7 tests: real `run()` with `makeFetchDriver` and `makeTimerDriver`, override by name, two apps sharing a static, `renderComponent` ignoring it, no static, SYG643 quiet with the static and firing without) and `sygnal-check/test/root-drivers.vtest.js` (2 tests). Both pass after `npm run build`.

Size gate: **+7 B in all**: 40,464 B against the previous 40,457 B. That is +5 B for the runtime, then +2 B when `App.drivers` became canonical and the gated kanban app itself moved `DND` to the static (the line's position changes the result by 1 B; this is the smallest of three placements measured). The default bundle is 35,677 B.

The prototype's own measurement: 40,462 B. `BUDGET` in `scripts/size-gate.mjs` and `CLAUDE.md` are raised by that delta; the raise was approved through the coordinator session on 2026-11-09 under the maintainer's delegation. Branch `claude/sygnal-evolution-strategy-6b922c` raises the same budget for an element's `dataset` fix (to 40,466 B), so the two must be re-measured together at merge; gzip deltas don't add. Default bundle unchanged at 35,680 B; `src/core/**` alone +4 B gzip. Moving SYG646, the fix text and the graph into the dev entry and the checker added nothing to the app bundle.

Follow-up work on this branch, after the prototype:

- **SYG646** (error, dev entry and `sygnal-check`): `drivers` on a component that isn't the root. Same conditions as SYG224 statically: a `run()` in the scanned files renders it and none has it as its root. Vike's Layout/Wrapper shell gets its own message.
- **SYG643 / SYG609 fix text** leads with `App.drivers`; the explanations give `run()` as the environment form.
- **`sygnal-check --fix`** writes `App.drivers = { HTTP: makeFetchDriver() }` and the import, or adds to an existing object literal. Only for a driver with no options (timers, sockets, resources, browser sources; for SYG609 `HTTP` and `WS`), one app, and statics assigned at the top level.
- **`--graph`**: a root component gets `drivers: [{ name, driver, from: 'static' | 'run' }]` (`schema/inspect.schema.json`, text output), with `run()`'s argument overriding by name.
- **Docs, examples, templates** (after the maintainer's decision): every page that wired a feature driver in `main.js` now shows the root's `drivers` static. `guide/drivers.md` documents `run()`'s argument as the override, and `advanced/alternative-forms` lists a feature driver in `run()`. `reference/errors.md` regenerated. See "What stayed in `run()`" below.
- **F2** (docs only): `integration/typescript.md` and `reference/types.md` declare `SygnalEvents` next to the emitter and keep a state type in its own file. The eval's TS starters are untouched because they are paired with the reference solutions. `create-sygnal-app`'s TS templates already keep `State` in `App.tsx` and have no `types.ts` or `events.ts`, so they needed no change.

### What stayed in `run()`

The rule (C21) keeps a driver in `run()`'s argument when it differs per environment or has to be created at start-up. These stayed, on purpose:

| Where | Driver | Why |
|---|---|---|
| `examples/todomvc` (`index.html`), `todomvc-worker/worker.ts` | `STORE`, `ROUTER` | `todomvc-worker` imports the same `app.tsx`, and `lib/routerDriver.ts` imports `director`, which reads `document` when loaded: a static would crash the worker on import. The page and the worker really do differ here. |
| `examples/filter-wizard`, `plan5-showcase` Quotes and Signup | `HTTP` with a fake `fetch` | a stand-in backend; `filter-wizard`'s `ROUTER` did move |
| `examples/advanced-feature-tests` | `MOCK` | a mock |
| `plan5-showcase` Board, `guide/view-transitions`, `reference/api` | `DOM: makeViewTransitionDOMDriver(...)` | replaces the default DOM driver for one mount point |
| Worker, three, custom-target and React Native pages | `DOM: target.driver` | a renderer target |
| `ai-showcase` assistant `AGENT`, webmcp `WEBMCP` / `AGENT_CALL` | per-run drivers | they need the running app or the mount point (the assistant's `LLM` and `HTTP` did move) |
| `ai-showcase/src/building/kimi.js` | `LLM` | one runner shared by every step's own root component |
| `guide/ai-chat` (development / production), `recipes/ai-summarize` (hosted fallback) | `LLM` | the transport differs per build or per browser |
| `guide/collaborative-state` | `SHARED` | creating the provider opens the connection, and a static's value is built on import |

Vike and Astro templates are unchanged: Vike registers drivers in `+drivers.js`, and neither has a `main.js`. Their `AGENTS.md` still says `run(App, { HTTP: … })`, which predates this work.

A static's driver is one instance for every `run()` of that root, where a `start()` that builds drivers inside gets a new one each time. `ai-showcase`'s Restart and `plan5-showcase` re-run a root after `dispose()`; `test/root-drivers.test.js` covers that for the timer and fetch drivers. I did not click through those two apps in a browser.

### Release notes for whoever ships this

The static exists only from the release that contains this branch, so these templates must move off `"sygnal": "^7.4.0"` to that release, or they break: `template-vite-pwa`, `template-vite-pwa-ts`, `template-mcp-app`, `template-mcp-app-ts` (the code uses `App.drivers`). `template-vite` and `template-vite-ts` changed only in `AGENTS.md`, which also names the static, so they should move too. The version is left for release time. The eval's reference solutions and starters still use `run()`.

### Text for `llms.txt`, `llms/` and `skills/sygnal-dev/` (not applied; another session is restructuring them)

For the driver paragraph of `llms.txt` and the skill:

> A feature's drivers go on the root component: `App.drivers = { HTTP: makeFetchDriver() }`, and `main.js` stays `run(App)`. `run(App, { ... })` is only for what differs per environment (a test double, a per-deploy `baseUrl`, a renderer target); it overrides the static by name. Root only (SYG646 elsewhere); `renderComponent` ignores it; no driver is needed in tests.

For the recipes that say `main.js: run(...)` (the HTTP, resources and timers recipes, `SKILL.md` lines 184, 210, 229, 236), replace that text with:

> `App.drivers = { HTTP: makeFetchDriver() }` on the root.

For the TypeScript topic file:

> `declare module 'sygnal' { interface SygnalEvents { … } }` goes in the component that emits the event; keep a state type in the component's file and `import type` it from children (no runtime cycle).

## Verification of the rewritten references

`verify-rewrites.mjs` runs each rewritten reference against the task's unchanged hidden suite, against the packed prototype build; the TypeScript rewrites also go through `tsc`. The hidden suites mount the app by importing `src/main.js` (`mountApp` in `hidden/_support/dom.js`), so the rewritten JS references really run `run(App)` with `App.drivers` and its real drivers.

Every rewritten task gives exactly the same result as its unrewritten reference, test for test, so no rewrite changed behaviour:

| Result, original and rewritten alike | Tasks |
|---|---|
| All pass | 05, 11, 18, 19, 20, 23, 24, 26, 30, 45, 46 |
| Same failures on both | 13 (0/8), 17 (6/8), 22 (0/7), 25 (8/9), 44 (1/8), 21 (8/9 and a `tsc` error in `DetailsPanel.tsx`) |

The six failing tasks are references that already fail today on this build; they are stale or broken independently of this work. The read-side analysis found the same kind of staleness (22 and 38–40) and warned that others might be stale. I did not diagnose each one, and the failures were observed only on the prototype build; the prototype's sole runtime change is a spread of an absent static for those unrewritten references. Their file counts are still meaningful, but "the rewrite works" is only demonstrated on the 11 passing tasks (8 of them through `App.drivers`: 05, 11, 23, 24, 26, 30, 45, 46).

## The other candidates

### Routes module

`routes.js` exists because the router is imported in `main.js` (its driver) and in pages (`href`). With F1 the driver moves to `App.jsx`, but the pages still need `href`. Two ways to drop the file, neither worth doing:

1. Declare the router in `App.jsx` and import `href` from it in the pages. That is an import cycle (`App` imports the pages, the pages import `App`). It happens to work while `href` is only read at render, and fails with a TDZ error the moment a page reads it at module level; `renderComponent(TaskPage)` also loads `App` first. The eval's reference would be rewritten around a hazard.
2. Pass `href` through `App.context`. It works with no cycle, but `routes.js` also holds helpers (`taskOf`), so it stays or becomes `tasks.js`, which is what the React arm has in that same task. The file count doesn't change.

Value: ≤ 2 points of the gap at best. **Not worth an API change.** Keep `routes.js`.

### Canonical forms and templates

Nothing pushes agents to split components: no rule in `skills/sygnal-dev/SKILL.md`, `llms.txt` or `create-sygnal-app` says one component per file, and the data agrees (new component files −0.04 to +0.04 per task). The templates' `src/components/` layout is React-typical, not a driver of the gap.

What does need changing:

- **TypeScript docs and fixtures.** `docs/src/content/docs/integration/typescript.md:298` and `reference/types.md:205` show `// src/events.ts`, and the eval's TS starters split `types.ts` / `events.ts` where React's don't. `declare module 'sygnal' { interface SygnalEvents { … } }` works in any module, so it can sit in the emitting component. The state type can sit in `App.tsx`, exported; children `import type` it (erased, no runtime cycle). The rewritten 18–20 compile; 21 has the same `tsc` error as the unrewritten reference (see "Verification").
- **The skill and `llms.txt`**, once F1 ships: the driver recipes say `main.js: run(…)` (`skills/sygnal-dev/SKILL.md:184`, `210`, `229`, `236`); they would say `App.drivers` instead.

### Test files

Not part of the 1.31×: the count excludes tests, and the test-file count is the same in both arms (usually one). The line count is a real difference: Opus 83 against 46 per task, or 69 against 46 averaged per trial over the mainline runs (Sonnet 25 against 5), driven by the skill's "Test" step (Sonnet writes a test in 87% of Sygnal trials against 24% of React's).

For a reviewer it is both: more lines to read, but behaviour-level (`renderComponent` + `simulateEvent`) and a direct statement of intent, and React's tests are shorter partly because Sonnet doesn't write them at all. Earlier evidence: experiment e9 (`results/PHASE3-RESULTS.md:185`) found that equalizing or removing the test instruction doesn't close the time gap, and that agents honour "don't write tests" when told. **No skill change recommended on this data.** Whether a reviewer is helped by the tests can't be told from free data; the read-side eval strips tests from fixtures, so it wouldn't answer this either.

## Recommendation

| Fix | Release | Size | Gap closed (refs / trials) | Verdict |
|---|---|---|---|---|
| F1 `App.drivers` (core + types + checker + docs + a non-root diagnostic) | Minor (additive; `run(App, drivers)` keeps working) | +5 B (budget raised on this branch) | 55% / 89% | **Do it** |
| F2 Types next to code (docs, TS starters, reference fixtures) | Docs only; no code | 0 B | 12% / 19% | **Do it** |
| Update the eval's references 05, 11, 22, 26 to current built-ins | None (eval maintenance) | 0 B | ~20 points of the reference gap (estimate, no trial impact) | Worth doing with the next eval change |
| A. Vite plugin inference | Minor | 0 B | 16–35% / up to 58% | Not worth it: implicit, Vite-only |
| B. `run()` defaults | Minor | +11,242 B | same as A | No |
| Routes API change | Would be minor | n/a | ≤ 2 points | No |
| Skill test instruction | n/a | 0 B | none | No change |

Nothing needs a major release. The canonical-forms change is made (C21); `run()`'s argument stays as the override, and 8.0 may add a strict code (B8-5).

Caveats on the estimate: the numbers count files, and moving the driver line doesn't shrink the diff (churn is unchanged). The trial numbers are counterfactual rewrites of past diffs by file name (trial workspaces are gone, so `main.js` contents can't be read); F1 assumes an agent would put wiring in `App.*`, which is what agents already do for React's providers, but no model has been run with the new form. The React arm is mostly hooks with little library, so a TanStack-heavy React app has its own wiring.

## Reproduce

```bash
npm run build
node dev-plans/research/files-touched/classify.mjs
node dev-plans/research/files-touched/reading.mjs
node dev-plans/research/files-touched/rewrite.mjs <out>
node dev-plans/research/files-touched/scenarios.mjs <out>
node dev-plans/research/files-touched/verify-rewrites.mjs <out> <work>
npx vitest run test/root-drivers.test.js
npx --prefix sygnal-check vitest run --root sygnal-check test/root-drivers.vtest.js
node scripts/size-gate.mjs
```

`diff-size.mjs` is a copy of the analysis on branch `claude/musing-tu-93ce47` with its imports adjusted. `<out>` and `<work>` must be outside the repository.

## Six references that fail their own hidden suite (for the eval session)

Observed on the unrewritten references with this branch's prototype build (`verify-rewrites.mjs` setup). Not diagnosed. Test name, then the first line of the failure.


**13-course-portal 0/8**

- adds a Courses tab after Profile and does not load anything at startup: `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- lists the courses with seats and the right button for each: `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- enrolling and leaving update the seats, the button and the header count: `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- the Profile page lists the enrolled courses in course-list order: `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- keeps enrollments and seats across page switches and never loads twice: `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- a response that arrives after the user left the page is still used: `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- shows an error with Retry for a failed load, and Retry loads again: `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- the existing pages keep working: `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`

**17-address-lookup 6/8**

- an unknown ZIP shows a message and moves focus to the City field, keeping its text: `AssertionError: expected <input name="zip" …(1)></input> to be <input name="city"></input> // Object`
- other failures show "Lookup failed." and also move focus to the City field: `AssertionError: expected <input name="zip" …(1)></input> to be <input name="city"></input> // Object`

**21-ts-selection-panel 8/9**

- typecheck: tsc --noEmit passes (strict): `AssertionError: tsc reported errors: expected 'src/DetailsPanel.tsx(4,7): error TS23…' to be '' // O`

**22-chat-socket 0/7**

- joining a room opens one WebSocket to /ws/rooms/<room> and shows its status: `AssertionError: expected [] to have a length of 1 but got +0`
- lists received messages and sends typed ones as JSON, without adding them itself: `AssertionError: expected [] to have a length of 1 but got +0`
- switching rooms closes the old connection, opens the new one and clears the list: `AssertionError: expected [] to have a length of 1 but got +0`
- "Leave room" closes the connection for good; joining again starts fresh: `AssertionError: expected [] to have a length of 1 but got +0`
- a dropped connection shows "Reconnecting…" and retries every second until one opens: `AssertionError: expected [] to have a length of 1 but got +0`
- a first connection that fails to open is retried too: `AssertionError: expected [] to have a length of 1 but got +0`
- switching rooms or leaving cancels a pending retry: `AssertionError: expected [] to have a length of 1 but got +0`

**25-router-spa 8/9**

- "Leave" completes the navigation and discards the change; an unchanged form leaves at once: `AssertionError: expected '/tasks/2/edit' to be '/' // Object.is equality`

**44-streaming-chat 1/8**

- sends the message and streams the reply into the conversation: `Error: no new request to /api/chat; sent: none`
- sends the whole conversation on the next message: `Error: no new request to /api/chat; sent: none`
- Stop cancels the request and keeps the text received so far: `Error: no new request to /api/chat; sent: none`
- Stop before any text arrives: `Error: no new request to /api/chat; sent: none`
- an HTTP error shows the alert; Retry sends the conversation again: `Error: no new request to /api/chat; sent: none`
- an error in the stream drops the partial reply; Retry sends the conversation again: `Error: no new request to /api/chat; sent: none`
- a network error shows the alert; a new message removes it: `Error: no new request to /api/chat; sent: none`

## Open questions for the maintainer

1. ~~Should `App.drivers` become the canonical place for feature drivers?~~ **Decided 2026-11-09: yes.** `run(App, {...})` is kept for what differs per environment (a test double, a per-deploy `baseUrl`). No strict code now; `BACKLOG-8.0.md` B8-5 records what one would need.
2. Should the eval's TS starters and old reference solutions move to the new layout, knowing that changes the eval's baseline?
3. Six references (13, 17, 21, 22, 25, 44; listed below) fail their own hidden suite on this build, before any rewrite. Repair them as part of the read-side work's staleness pass (`verify.mjs` across all tasks)?
4. Is a paid head-to-head wanted to confirm the trial numbers with the new form and guidance? The numbers here assume agent behaviour, nothing has measured it.
