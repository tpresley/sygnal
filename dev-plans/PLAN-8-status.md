# PLAN-8 Status Tracker

Tracks progress for [PLAN-8.md](PLAN-8.md) ("Coming from React / Vue" docs pages).

**Numbering:** a reserved block, decisions **D400–D449**, gaps **G-700–G-749** (PLAN-7 runs in parallel on the shared sequence).

**Integration branch:** `plan8-integration`, cut from `main` `b02eb715` on 2026-10-10, in the worktree `.claude/worktrees/react-vue-docs-proposal-d4e244`.

**State:** All items done (2026-10-10): N-1, R-1, V-1, W-1, Q-1. Open: rank the S- candidates with the user and choose which go into a later plan.

## Decisions

| # | Date | Decision |
|---|---|---|
| D400 | 2026-10-10 | New sidebar group "Coming from…" after Getting Started (user) |
| D401 | 2026-10-10 | React, Vue and the Port-an-App walkthrough all in PLAN-8 (user) |
| D402 | 2026-10-10 | Neutral tone; Sygnal's concrete advantages called out in `Where Sygnal helps` tips; no benchmarks (user) |
| D403 | 2026-10-10 | Other frameworks wait for a later plan (user) |
| D404 | 2026-10-10 | Slugs `coming-from/{react,vue,port-an-app}`; labels "From React", "From Vue", "Port an App" |
| D405 | 2026-10-10 | Foreign code first, Sygnal demo directly under it; no tabs around demos |
| D406 | 2026-10-10 | Improvement candidates recorded as S-/G- items, not implemented in PLAN-8 |

## Items

| Item | State | Notes |
|---|---|---|
| Phase 0 | done | plan, tracker, branch |
| N-1 navigation | done | "Coming from…" group after Getting Started; links from Quick Start's intro and the homepage |
| R-1 React page | done | 6 demos (counter, todos, resources + demo server, timers, Collection + PARENT, slices + calculated + context); table, pitfalls, testing, adoption |
| V-1 Vue page | done | 9 demos (the R-1 set plus templates → JSX, `STATE.watch` autosave with a demo server, slots) |
| W-1 walkthrough | done | book finder in 5 steps; 3 demos, 2 live-files, a demo server; React and Vue code for steps 4 and 5 in folds |
| Q-1 verification | done | full gate below |

## Verification log

- 2026-10-10: `npm --prefix docs run build` (+ link check) green; `check-live --only=coming-from` 18/18 on Chromium; `check-doc-samples` 0 strict / 0 a11y findings (the new pages' React/Vue blocks skipped by marker). Every demo exercised in the browser pane (clicks, typing, aborted requests in the demo server's notes) and matched the text; phone width has no page overflow.
- 2026-10-10, after review fixes (step 2's search box uncontrolled, the Booking context reads `state.guests`, the slot section corrected after probing G-702): docs build + link check green; full `check-live` 109/109 on Chromium, Firefox and WebKit; `check-doc-samples` 0 strict / 0 a11y findings and no findings of any kind on the new pages.

## Sygnal improvement candidates (gaps)

| # | Item | Found on | What a React/Vue developer runs into | Proposed change | Area | Size |
|---|---|---|---|---|---|---|
| G-700 | S-1 | `react.md` §1, every page | `onClick={…}` (any `on*` function prop) on an element: Sygnal attaches nothing, renders the function's source as an `onClick="…"` attribute (mock DOM, SSR), and reports nothing at run time or in `sygnal-check` (probed 2026-10-10). It's the first thing a React or Vue developer writes | A diagnostic in the dev runtime and in `sygnal-check` (a new 1xx code: "views don't bind events: give the element a class and add an intent entry", with the intent line to add); the pragma could also drop function-valued `on*` props so no source text reaches SSR HTML | diagnostics + checker (+ pragma) | S |
| G-701 | S-2 | `vue.md` (templates → JSX) | `class={…}` takes clsx-style objects and arrays (G-096), but `className={{ on: x }}` goes to the DOM property: `class="[object Object]"` in the browser, no class in the mock DOM (probed). `guide/accessibility.md` and SYG731's docs show `className={{ … }}` as the way to toggle a class, so the docs teach a form that silently fails | Route an object or array `className` through the same class map as `class` in the pragma; or document `class=` for conditional classes and fix `accessibility.md` | pragma (core) or docs | S |
| G-702 | S-3 | `vue.md` Slots, both pitfall tables | Events on slot / `children` content reach the child that renders it, not the parent that wrote it (Vue and React developers expect the parent); the parent's selector is SYG104 (probed). `advanced/slots.md` shows parent-written buttons in a slot without saying who hears them | (a) Docs: a section on `slots.md` and `parent-child.md`, and a SYG104 message that names the case ("matches slot content passed to Card; Card renders it"). (b) Scope slot and `children` vnodes to the component that wrote them, so the parent's intent hears them: a behavior change in isolation, needs a decision | (a) docs + diagnostics; (b) core | (a) S, (b) L |
| G-703 | S-4 | `port-an-app.md` step 5 | A list loaded from the server and then edited locally (the `want` flags) can't be a resource: `data` is replaced on refetch and isn't an editable Collection array. The walkthrough fell back to `BOOTSTRAP` + an `HTTP` reply action + a hand-written `status` field, the pattern `resources` exists to remove | A resource option that seeds a state field (`{ url, into: 'books', map }`) and keeps the resource's status; or a "load once, then edit" recipe on `resources.md` | resources (core) or docs | M |
| G-704 | S-5 | `vue.md` Slots | `advanced/slots.md` writes `{...(slots.header \|\| [])}`; `{slots.header}` works, also for a missing slot (probed), and reads like Vue's `<slot name>` | Simplify the samples on `slots.md` | docs | XS |
| G-705 | S-6 | `vue.md` §2 | Every controlled field takes `value={…}`, an intent line and a reducer, where Vue writes one `v-model`. The `form` behavior covers whole forms; binding in the view is ruled out (PLAN-1 D1) | Optional: a behavior that wires listed field names to `set` (`uses = { fields: bind(['draft']) }`), staying in intent/model | behaviors | M |
| G-706 | S-7 | the pitfall tables | Coding agents bring the same React habits (the eval failures behind the pitfall tables were agent trials), but `llms.txt` and the skill have no React → Sygnal mapping | A compressed version of the React table in the `sygnal-dev` skill (outside `llms.txt`'s line budget), checked by an eval task that starts from a React-style prompt | skill | S |

