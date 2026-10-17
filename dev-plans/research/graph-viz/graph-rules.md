# X-1: graph-wide checks as sygnal-check rules (measurement)

PLAN-10 X-1 under D512: a graph-wide check ships as a rule only when it has **no false positives on
the examples and the docs samples**. Otherwise it stays a health item on the graph page. This file
records what was measured, the result for each candidate and why.

**Result:** SYG170 and SYG171 ship (warn, static). SYG172 does not; "reachable from no entry" stays
off the rule list (the page has no such health item either).

## What was measured

Each candidate was prototyped, then run on:

- every `examples/*` app (17), each as one project;
- the docs samples as `scripts/check-doc-samples.mjs --out` writes them (840 files: the docs site,
  `llms.txt`, the skill, the template `AGENTS.md` files), once as one project and once one file at a
  time (one sample with an unresolvable `run()` makes the shared project's entries `unknown`, which
  silences SYG170 for every sample; the per-file run removes that cover);
- the sygnal-check fixtures (`test/fixtures/*`, one project per directory);
- `dev-plans/research/graph-viz/fixture`;
- a private Vike app (33 components, 29 entries; read only, counts only).

The first prototype computed all three from the `--graph` JSON with the page's own model
(`graphView/model.js`: `orphanReads`, `parentsOf`, `childSelects`, `entry`). The shipped rules work
on the project model through `model/renderGraph.js` (the render edges and entries, moved out of
`graph.js`; `--graph` output is unchanged).

## Results

| Candidate | Prototype findings | False positives | Shipped rule's findings | Shipped |
|---|---|---|---|---|
| SYG170 context read, no provider | 10 (page model: 3 ai-ask, 1 plan5-showcase, 1 strict fixture, 4 docs, 1 private app) | 10 | 0 | yes |
| SYG171 PARENT nobody reads | 26 with no scanned parent, 1 with parents | 27 | 0 | yes |
| SYG172 reachable from no entry | 62 with known entries (12 examples, 50 fixtures), 353 more under `entry: 'unknown'` | 62 (all) | — | no |

What the shipped rules evaluated (the cases that reached the final test, so 0 findings is not 0
coverage): SYG170 checked 13 (component, field) reads whose whole chain ends at a `run()` /
`defineElement()` entry (ai-ask 3, ai-compose 2, ai-panel-spa 2, kanban 2, plan5-showcase 1,
graph-shop 3); all were provided. SYG171 saw 40 components with a `PARENT` sink: 18 are selected
by some intent, 2 have parents whose intent it can't read fully (ai-panel-spa's `setup(CHILD)`
helper; a strict fixture), the other 20 have no scanned parent.

### SYG170: every prototype finding was a false positive

| Where | Finding | Why it is false |
|---|---|---|
| ai-ask `App` (3) | `context.chatModels`, `cardBackends`, `offline` | App provides them itself. The core merges a component's own `.context` over its parent's (`instance.ts` `context()`), so a reader sees its own entries. The page's walk starts at the parents |
| strict fixture `Lane` (1) | `context.theme` | the same: `Lane.context = { theme }` |
| private Vike app (1) | a field no scanned component provides | the reader is a Vike `+Page`: vike-sygnal adds `pageData`, `routeParams`, `urlPathname` and the `+Layout` / `+Wrapper` contexts (`onRenderClient.ts`, `onRenderHtml.ts`) |
| plan5-showcase `Cart` (1) | `context.t` | Cart is shown as source text (`?raw`), never rendered; nothing scanned starts it |
| docs (4) | `Cart` (guide/context, recipes/i18n), `App` (integration/ssr) | fragments: the provider is in another block, or `renderToString(App, { context })` provides it |

The rule therefore counts the reader's own `.context` and reports only a **closed chain**: every way
up from the reader ends at a component `run()` or `defineElement()` starts, and no entry call has a
component the checker can't resolve. It is silent for a root nothing starts, a capitalized
top-level function that renders a component on the chain without being rendered itself (a plain
component the units can't show), a Vike root, JSX passed into another component (that component
places it, so it is the runtime parent; `instance.ts` `reconcile()` stops at component vnodes), and
a `.context` it can't read. Known blind spot (a false negative or, rarely, a false positive): a
reader also rendered through a dynamic tag (`const C = pick(); <C />`) under a provider the static
edges don't show. None of the measured sets has one.

### SYG171: every prototype finding was a false positive

| Where | Finding | Why it is false |
|---|---|---|
| ai-panel-spa `SetupCard` | parent `RootComponent` has no `CHILD.select(SetupCard)` | it does, in a helper: `const setup = (CHILD) => CHILD.select(SetupCard)` outside the intent function |
| ai-ask, ai-showcase cards (10), docs (16) | no scanned parent | catalog parts (the chat renders them; `compose.answer` goes to PARENT), `defineElement()` elements (`events: { PARENT: 'score-change' }`), fragments whose parent is in another block |

The rule needs at least one scanned parent and no slot edge, no intent anywhere selecting the
child (a select one level too high is SYG129), and every parent's intent fully readable: no
`uses` (a behavior may read `CHILD`), no rest pattern on the sources, `CHILD` / `sources` used only
as `CHILD.select(X)` / `sources.X` with every X resolved. A parent without an intent is readable
(nothing can hear the child).

### SYG172: not shipped

Every component reported with known entries is reachable in the running app or is meant to stand
alone:

| Where | Count | Why it is false |
|---|---|---|
| ai-ask | 6 | `Assistant` is rendered through a variable picked from state (`<Assistant key=… />`); the five cards are catalog parts |
| ai-compose | 2 | catalog parts |
| ssr | 2 | rendered by `renderToString` in `server.js`, not by `run()` |
| vike | 1 | `+Wrapper.jsx`, applied by vike-sygnal's config |
| plan5-showcase | 1 | `Cart` is displayed as source (`?raw`), on purpose |
| fixtures (p7-c4, strict) | 50 | one directory holds many independent cases; one has an entry, so every other case looks unreachable |
| ai-showcase, docs | 353 | silent only because an entry is `unknown`; per sample they'd be the same "a fragment with no `run()`" |

The entries the checker knows (`run()`, `defineElement()`, Vike pages) are not all the ways a
component starts: catalogs, `renderToString`, dynamic tags, framework config files, tests. A rule
would need each of those modelled before it could be trusted, and the info severity the plan
allows doesn't help an editor user who sees it on every catalog part. The graph page can show
unreachable components as a view (it knows the user is looking at the whole app), not as a
finding.

## Page health list (reference behaviour)

Two of the SYG170 false positives come from `graphView/model.js` itself and also show on the page's
"Context read with no provider" health item (not changed here; `graphView/` is outside X-1):

1. The provider walk starts at the parents, so a component that reads its own `.context` is listed
   (ai-ask's App: 3 items; the strict fixture's Lane).
2. Vike pages and their layouts/wrappers: framework-provided fields (`pageData`, `routeParams`,
   `urlPathname`) and wrapper contexts are listed (1 item in the private app).

Both are proposed as follow-ups in the X-1 report.
