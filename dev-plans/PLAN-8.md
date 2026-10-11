# PLAN-8: "Coming from React / Vue" docs pages

**Goal:** give developers who know React or Vue a fast way into Sygnal: a page in their own vocabulary that maps what they know onto Sygnal, explains the few real differences in thinking, and lets them run and edit every Sygnal sample on the page. Along the way, record every place where writing those pages shows that Sygnal itself could be easier for them.

**Release:** docs only. No `sygnal`, `sygnal-check` or `create-sygnal-app` release. The site picks the pages up on its next deploy.

**Status:** Phase 0 (this plan). Tracker: [`PLAN-8-status.md`](PLAN-8-status.md). The proposal it builds on: [`research/coming-from-react-vue.md`](research/coming-from-react-vue.md). The user's answers to its §6 questions (2026-10-10) are D400–D403 below.

**Branches:**
- integration: `plan8-integration` (cut from `main` `b02eb715`);
- subagent branches, if any: `p8-*`.

**IDs:**
- items N- (navigation), R- (React page), V- (Vue page), W- (walkthrough), Q- (verification), S- (Sygnal improvement candidates);
- decisions and gaps use a **reserved block, D400–D449 and G-700–G-749**: PLAN-7 runs in parallel and keeps allocating from D297 and G-657, so PLAN-8 does not continue the shared sequence.

**Inputs:**
- The proposal: [`research/coming-from-react-vue.md`](research/coming-from-react-vue.md) (formats, translation tables, the five shifts, layout, the sample section).
- The live-block tooling: `docs/src/plugins/remark-live.mjs` (header: fence meta words, drivers, the demo server), `docs/src/live/modules.ts`.
- The canonical forms: `llms.txt`, `dev-plans/PLAN-1-canonical-forms.md`. Every Sygnal sample on the new pages is strict-clean.
- The eval evidence for the pitfalls: `evals/agent-ergonomics/README.md` (tasks 06, 07, 14, 15) and `results/`.

**Invariants:**
- **No Sygnal source changes.** Nothing under `src/`, `sygnal-check/src/`, `types`, `llms.txt` or the skill. Improvement ideas go into §4 as S- items with G- numbers; they are implemented by a later plan, not this one. This keeps PLAN-8 clear of PLAN-7.
- **Every Sygnal sample on the new pages is live** (` ```jsx live `, with ` ```js live-server ` / `live-file` where needed), except configuration and test snippets that can't run in a panel (`run()`, `vite.config`, `renderComponent`).
- **React and Vue code is static** and marked `// docs-check: skip` (or `<!-- docs-check: skip -->`), with a frame title naming the framework.
- **Accurate code on both sides.** React samples use React 19 function components and hooks; Vue samples use Vue 3.5 `<script setup>` SFCs. No strawmen: each is the code a competent developer would write.
- **What the page shows is what runs** (remark-live's rule): no hidden setup.

**Words:** "the React page", "the Vue page", "the walkthrough"; "a shift" for one of the five differences in thinking; "a demo" for a live block.

---

## 0. Decisions

| # | Decision |
|---|---|
| D400 | A new sidebar group **"Coming from…"** right after Getting Started, with React, Vue and the walkthrough (user, 2026-10-10) |
| D401 | **All three pages in this plan**: React, Vue and the Port-an-App walkthrough (user, 2026-10-10) |
| D402 | **Neutral tone, with Sygnal's advantages called out where they're real**: a short `:::tip[Where Sygnal helps]` aside after a comparison, stating a concrete, checkable difference (no dependency arrays; superseded requests aborted; every action listed in one place; tests that dispatch actions; diagnostics for wiring mistakes). No benchmarks, no "better than" (user, 2026-10-10) |
| D403 | Svelte, Solid, Angular and other framework pages wait for a later plan (user, 2026-10-10) |
| D404 | Slugs `coming-from/react`, `coming-from/vue`, `coming-from/port-an-app`; sidebar labels "From React", "From Vue", "Port an App" |
| D405 | Layout per comparison: the React/Vue block first, the Sygnal demo directly under it; no tabs around demos (a demo in a hidden tab is a risk for `check-live`) |
| D406 | Sygnal improvement candidates are recorded (§4, the status tracker's gap table), not implemented in PLAN-8 |

## 1. Navigation (N-1)

- `docs/astro.config.mjs`: the "Coming from…" group after Getting Started (D400, D404).
- `getting-started.md`: replace "If you've used React, you'll feel right at home…" with a sentence linking the React and Vue pages.
- `index.mdx`: a "Coming from React or Vue?" card linking both.

## 2. Pages

### R-1: Sygnal for React developers (`coming-from/react.md`)

1. **What carries over**: JSX, function components, props, keys, a virtual DOM, Vite, familiar names for Suspense/lazy/portals/error boundaries. Sygnal is closest to `useReducer` + Redux, with effects moved out of components.
2. **Translation table** (proposal §2.1), every row linked to its guide page.
3. **Five shifts**, each a React block, a Sygnal demo, and what changed:
   1. events are named in `intent`, not bound in JSX;
   2. state changes are reducers keyed by action;
   3. side effects are sinks, not hooks (`resources` with a demo server; `timers`; `persist`);
   4. data goes up through `PARENT` (+ `Collection`);
   5. one state tree; children get slices (`state="key"`, `.context`, `calculated`).
4. **Pitfalls** from the evals, each with its SYG code.
5. **Adopting Sygnal in a React codebase**: `fromReact()` and `defineElement()`.
6. Where next.

### V-1: Sygnal for Vue developers (`coming-from/vue.md`)

Same skeleton in Vue vocabulary (proposal §2.2), the same Sygnal demos where the comparison is the same, plus:
- **JSX for template authors** (before the shifts): `v-if`, `v-for`, `:class`, interpolation, no directives;
- **mutable reactivity → immutable reducers**;
- the Vue names Sygnal shares (`<Transition>`, slots → `<Slot>`, `<Teleport>` → `<Portal>`, `<KeepAlive>` → `<Switchable>`);
- interop through `defineElement()` only (no Vue adapter).

### W-1: Port an App (`coming-from/port-an-app.md`)

One small app ported in five steps (boxes → static views → state and actions → intents → effects), each step a demo that builds on the last (`live-file` modules). At each step a collapsed `<details>` holds the React and Vue code for that step. The app needs: a list loaded from a demo server, a filter input, list items that report a click up, a derived count, and a detail panel. Linked from the end of both pages.

## 3. Verification (Q-1)

- `npm --prefix docs run build` (compiles every demo, link check);
- `node docs/scripts/check-live.mjs` with `BROWSER=chromium`, `firefox`, `webkit`: all three pass;
- `node scripts/check-doc-samples.mjs`: the new Sygnal samples are strict-clean; React/Vue blocks skipped by marker;
- `npx vitest run test/docs-errors.test.js` (unchanged, a sanity check);
- a read-through of each page in the browser pane (light and dark, phone width).

## 4. Sygnal improvement candidates (S-)

Each S- item gets a G- number in the tracker with: the page and sample that showed it, what a React/Vue developer runs into, the proposed change, its area (core, checker, docs, `llms.txt`), and a rough size. They are candidates for a later plan, ranked at the end of PLAN-8.

## 5. Order of work

1. Phase 0: this plan, the tracker, the branch, committed.
2. N-1 and R-1 (R-1 establishes the demos V-1 reuses).
3. V-1.
4. W-1.
5. Q-1 across all three pages, then fixes.
6. Close: rank the S- items in the tracker, update the memory file.
