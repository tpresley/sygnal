# SP-F1: statics see context

**Question.** Can the declaration statics (`resources`, `timers`, `connections`, `head`, …) get
`(state, context)` so a routed page reads `route` from context instead of copying route params
into its own slice (Temper #37)? Which statics, what skip condition, and what does it cost in core
bytes (size gate 43,000 B, 156 B headroom on the PLAN-13 integration branch)?

**Built** (branch `exp/p13-f1`):
- `checkStatics()` (`src/core/statics.ts`) passes `inst.context()` as the second argument to a
  function static and to each function of an object static. That covers every static the core
  sends, generically: `resources`, `timers` (behaviors' timers accessor forwards it),
  `connections`, `head`, `browser`; a constant (`route = 'ROUTE'`) is unchanged.
- **Variant A, the skip condition by identity:** the statics re-run when the state, the shown flag
  **or the context object** changed. `context()` is memoized per write version and keeps the same
  object when its values are shallow-equal (D168), so an unrelated write re-runs nothing.
- **Variant B, per-key read tracking** as views do (a Proxy records the keys read; re-run only
  when one of them changed).
- `test/sp-f1-statics-context.test.js`: a key-bound page with
  `resources = { item: (s, { route }) => `/api/items/${route.params.id}` }` under a root with
  `context = { route: s => s.route }`: navigation sends `/api/items/2`, its reply lands, the page's
  slice has no `route`, and a root write that changes no context entry doesn't call the static.

**Numbers.**

| | kanban gzip (a) | Δ | core alone gzip |
|---|---|---|---|
| integration branch | 42,844 B | — | 18,710 B |
| A (identity) | 42,863 B | **+19 B** | 18,725 B |
| B (read tracking) | 42,909 B | +65 B | 18,818 B |

Full library suite on A: 5,156 passed, no regressions (existing statics ignore the new argument).

**What A costs at run time.** A context change that a static doesn't read re-runs it (cheap: a
function call), and `objIsEqual` drops the unchanged value, so nothing is re-sent. Only a context
entry that returns a new object on every write (`user: s => ({ ...s.user })`) makes the statics
re-run on every flush, as it already makes the views re-render.

**Performance (added on request).** `test/sp-f1-bench.test.js` on `exp/p13-f1`: N Collection items
declare `resources = { r: (s, c) => ({ url, tags: [c.route.name] }) }` under a root whose context
has `route` (read) and `tick` (not read); M actions per case through `renderComponent`, timed to the
render after each, median of 5 runs (ms per action):

| case | A, N=1,000 | B, N=1,000 | A, N=5,000 | B, N=5,000 |
|---|---|---|---|---|
| `tick` changes (unread key) | 14.4 (A again: 14.6) | 14.3 | 19.3 | 17.9 |
| a write that changes no context entry | 14.2 (14.7) | 14.3 | 16.8 | 16.9 |
| `route` changes (read key, same request) | 14.7 (14.3) | 14.8 | 18.9 | 19.7 |

At 1,000 items the variants are within run-to-run noise. At 5,000, re-running a static costs about
0.5 µs per call: B saves about 1.4 ms per unread-key change and spends about 0.9 ms more per read-key
change (its Proxy and Set). The flush itself dominates either way. **Conclusion: no performance
reason to pay B's extra 46 B; A stays the recommendation.**

**Left for F-1 proper.**
- SSR: `withResources(def, state)` in `src/extra/ssr.ts` gets the context too; the component's own
  context entries are computed from its state after the resources today, so pass the parent's
  context merged with its own entries computed on the pre-resource state (one reorder).
- Types: `resources` / `timers` / `connections` / `head` function types get `context` as a second
  parameter (`ComponentContext`).
- sygnal-check: SYG170 (a context read no ancestor provides) and the graph's context reads should
  include the statics' second parameter (`model/context.js`); otherwise an unprovided read there
  goes unreported.
- Docs: resources / timers / sockets / head guides, the routing guide's per-page pattern
  ("read `route` from context"), llms.txt / skill.

**Recommendation: variant A** (+19 B, 137 B headroom left). Read tracking costs 3× the bytes to
save calls that are already cheap and send nothing. It also unblocks F-3: pages that read `route`
from context need no `share` of read-only keys.
