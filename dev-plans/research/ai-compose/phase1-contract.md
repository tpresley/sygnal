# PLAN-9 Phase 1: the contract between workers

Every Phase 1 worker reads this file first. It fixes the module layout, the formats and interfaces,
and who owns what, so that parallel branches merge cleanly. When something here is wrong, say so in
your final message: don't silently diverge.

## Workers and branches (each in its own worktree, cut from `origin/plan9-integration`)

| Worker | Branch | Owns |
|---|---|---|
| CORE | `p9-core` | 0-S2's key identity (cherry-pick `8d8ae48c`), G-751 tree-shaking, G-750 move fix, a duplicate-sibling-identity dev warning (SYG453), the size gate (D467) |
| A | `p9-compose` | K-1 `defineCatalog`, K-2 `catalog.render` (+ G-752 lens memo), K-3 layout utilities, `byId` (in `sygnal`, D463), the Backend interface, C-1 the `compose` behavior, T-1 `composeWith`, X-1 runtime diagnostics, the `compose` export wiring |
| B | `p9-decisions` | B-1 and B-2: `compose.decisions()` |
| C | `p9-llm` | B-3: `compose.llm()` |

The coordinator merges the branches into `plan9-integration`, resolves conflicts in shared files
(`src/ai.d.ts`, `src/extra/ai/index.ts`, `src/index.ts`, `codes.ts`, `explanations.js`) and
regenerates the generated files (`explanations.json`, the errors doc).

## Module layout

```
src/extra/ai/compose/
  types.ts        (A) Catalog, Part, Container, Param, Layout, Node, Tree, Backend, ComposeSlice; shared by all
  catalog.ts      (A) defineCatalog → Catalog (normalized + validated)
  layout.ts       (A) fromTree, toTree, removeNode, finish (the deterministic finishing step), keys
  render.ts       (A) catalog.render
  behavior.ts     (A) compose(catalog, options): the behavior
  testing.ts      (A) composeWith(t, catalog, tree, { stream? })
  decisions.ts    (B) decisions(options): Backend   (create it; A ships a stub with this name that B replaces)
  llm.ts          (C) llm(options): Backend         (same: A's stub, C replaces)
  index.ts        (A) export const compose = Object.assign(behavior, { decisions, llm, answer })
src/extra/lens.ts (A) byId(field, id, idKey = 'id'): a { get, set } lens, exported from 'sygnal'
```

Types go in `src/ai.d.ts` under a `// ---- PLAN-9 compose` section. Sub-sections are owned by worker:
A's types; then `// PLAN-9 B: compose.decisions` (B); then `// PLAN-9 C: compose.llm` (C). Add only
inside your own sub-section. `byId`'s type goes in `src/index.d.ts` (A). Everything is side-effect
free, outside `src/core/`, and exported from `src/extra/ai/index.ts` (and from `sygnal/ai`, as
today).

## The catalog (normalized form, A)

`defineCatalog(decl)` returns a `Catalog`:
- `parts: Record<id, Part>` and `containers: Record<id, Container>`, which share one id namespace.
  The built-ins are `page` (the root: slot `default`) and `row` (slot `default`, `direction: 'row'`).
- `get(id)`.
- `options(state)`: every selectable option. Each one is `{ option, part, params?, description }`,
  where `option` is the part id or `part:recordValue` for record params.
- `guidance`, `limits` (`{ maxParts = 12, maxDepth = 4 }`), `examples`.
- `render(slice, state, opts)` (K-2).

Part fields: `component`, `props` (object or `(params, state) => object`), `description`, `state`
(`'key'` | lens | `(node) => lens`) or `local: init`, `params`, `in` (default `['page']`; entries
`'container'` or `'container:slot'`), `group`, `maxUses` (default 1), `required`, `pin`
(`'start'|'end'`), `companions`, `category`, `result`.

Params:
- `{ options: { value: description }, default, label?, ask? }`
- `{ type: 'number', min?, max?, default, bins: { number: description } }`
- `{ type: 'text', maxLength?, default?, required?, label? }`
- `{ type: 'list', items?: { maxLength? }, min?, max?, required?, default? }`
- `{ from: (state) => [{ value, name?, aliases?, description }], label? }` (a record param; at most
  one per part)

Normalized (integration; `types.ts` `Param` is canonical, and every module reads it): each param
gets `kind: 'options' | 'number' | 'text' | 'list' | 'record'` in place of its discriminator (`type`
is not kept), and only the fields above (an options param always has a `default`: its first option
when none is given; `required` is a boolean). Backends read `kind`, never `type` / `from` / `options`
presence. Places (`in`) are normalized to `'container:slot'` entries (`'page'` → `'page:default'`;
a container alone → each of its slots); the built-in row has `in: []` (it goes where its parts may).

Containers: `{ slots: { name: description | null }, minSlots?, arranged?, direction?, render }`,
where `render` is a VIEW FUNCTION `({ key, node, slots, children, ui, control }) => vnode`.

## The layout and the tree

```ts
type Layout = { root: 'page', nodes: Record<string, Node> }
type Node   = { part: string, params?: Record<string, unknown>, slots?: Record<string, string[]> }
type Tree   = Array<{ part: string, params?: object, children?: Tree | Record<string, Tree> }>
```

- **Node keys are identities:** the part id; `part:recordValue` for a record node; repeats `~2`, `~3`;
  containers by id (`row`, `row~2`, `tabs`).
- `fromTree(catalog, tree, previous?)` reuses `previous`'s keys for the same (part, params identity).
- `params` holds only non-default values.
- `finish(catalog, layout, state)` (A, used by both backends):
  - drop unknown parts and slots (SYG250);
  - required parts, `companions` and `pin`;
  - `in` enforcement (a part outside its allowed places goes to its first allowed place);
  - `minSlots` unwrap; a single-part row is unwrapped; empty `auto` containers removed;
  - `maxParts` / `maxDepth`; cycle guard. **maxDepth** (integration): the page is depth 0 and its
    children depth 1; a container at depth d moves to the page when d > maxDepth (structure's
    `composer.mjs` rule). `decisions()` reads with it, `llm()`'s schema and repair offer a container
    at depth d only when d <= maxDepth (the research `llm-composer.mjs` counted leaves: its m is m - 1
    here).

  It is idempotent.

## The Backend interface (A defines it; B and C implement it)

```ts
interface Backend {
  sink: string                                    // 'HTTP' (decisions) | the LLM sink (llm)
  start(a: { catalog, state, prompt, previous: Layout | null, names }): { request, pending }
  reply(a: { catalog, state, pending, reply, names }):
    { layout?: Layout | null, unavailable?: true, preview?: Layout, request?, pending?, decisions?: unknown }
  delta?(a: { catalog, state, pending, delta }): { preview?: Layout }
  fake(a: { catalog, state, pending, target: Tree }): unknown   // the reply body that leads to `target` (for composeWith)
}
// names = { ok, error, delta, key } (e.g. { ok: 'page.REPLY', error: 'page.FAILED', delta: 'page.DELTA', key: 'compose' })
```

- `request` is a ready sink value: a `decide()` request object for HTTP, or a chat request for LLM.
  It carries `key: names.key`, `latest: true`, and the `ok` / `error` / `delta` names.
- `pending` is plain JSON, kept in `state.<slice>.pending`.
- **Done:** `layout` (already passed through `finish`). **Nothing fits:** `layout: null, unavailable: true`.
  **Another step:** `request` + `pending` (+ an optional `preview`).
- `decisions` is whatever the explain panel should show: the decisions backend's raw answers, or the
  LLM's `asked_for` plan.
- **Phase 1:** when `previous` is given, a backend may compose fresh. B-4 edits come in Phase 2, and
  the interface stays the same.
- `fake` must invert the backend's own encoding:
  - decisions: build `answers()` for the pending step's questions so that reading them yields
    `target` (structure's `selftest.mjs` does exactly this);
  - llm: the JSON text of the tree in the backend's schema.

## The behavior (A)

`compose(catalog, { backend, form?, prompt?, key = 'compose' })` → `state[slice]`:

```
{ prompt, status: 'idle'|'composing'|'preview'|'done'|'unavailable'|'error',
  layout: Layout | null, preview: Layout | null, pending, decisions, error: string | null,
  ui: Record<nodeKey, object>, local: Record<nodeKey, object> }
```

- Actions:
  - `COMPOSE`: data is a string, `{ prompt, fresh? }`, or the form's submit;
  - `SET_LAYOUT`, `REMOVE` (a nodeKey), `CONTROL` (`{ key, name, value }` → `ui[key]`);
  - `DONE` (data: the layout; host entries run after);
  - internal `REPLY`, `DELTA`, `FAILED`.
- The only declared sink is `backend.sink`.

## Rendering (A)

`catalog.render(slice, state, { scope?, frozen?, answer?, at? })`:
- It renders `slice.preview ?? slice.layout`.
- Each part gets `key={scope ? scope + '/' + nodeKey : nodeKey}` (0-S2's key identity: CORE delivers
  it; until merged, A may also pass `id`), its lens (memoized per node key, G-752), its params as
  props or through `props()`, and the props `node`, `scope`, `frozen`, `answer`.
- `local` state goes through a lens into `slice.local[nodeKey]`.
- Containers call their view with `control(name, value)`, which yields data attributes the behavior's
  intent turns into `CONTROL`.
- A frozen render wraps everything in `<fieldset disabled>`.

## Diagnostic codes

| Worker | Codes |
|---|---|
| CORE | SYG453 duplicate sibling identity (dev warning) |
| A | SYG161 container `render` is a component with a model; SYG162 a part with neither `component` nor `render`; SYG250 unknown part/slot in a layout (dropped); SYG251 invalid param value in a layout; SYG252 record `from` not an array of `{ value }`; SYG450 `in` names an unknown container/slot; SYG452 duplicate node keys; SYG681 a backend option problem (no `model`) |
| B | SYG680 a required text param under a decision backend (info: the part is LLM-only); SYG682 a decision model returned a choice outside the criteria |
| C | SYG683 an LLM layout still invalid after repair |
| (later) | SYG160 (H), SYG451 (M-1), SYG684–686 (H, from 0-S3) |

For each code, add it to both tables in `codes.ts` and add its explanation to
`sygnal-check/src/explanations.js`. Don't hand-edit `explanations.json` or the errors doc; the
coordinator regenerates them after merging.

## Tests

- Unit tests for your modules go in `test/p9-<area>-*.test.js` (root vitest).
- A's behavior suite runs once per backend. Until B and C are merged, A tests with its own minimal
  fake backends.
- The coordinator adds a matrix over the real `decisions()` and `llm()` after merging.
- No network: B and C test encodings with recorded replies or `answers()`.
- The research `evals/` stay opt-in (E-3).
- Run the root `npx vitest run` and `npm run test:types` before you finish. The full gate is the
  coordinator's job at merge, except for CORE, who runs the full gate.
