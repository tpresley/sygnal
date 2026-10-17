# S-1: the app-graph page for large apps

PLAN-10 §1.0 S-1 (D507). Question: what keeps the page readable and fast at 200, 500 and 2,000
components, with hundreds of event types? The spike is readable to about 50.

**Short answer.** Group by directory and **fold the groups above ~150 components**: the page opens on
one card per directory with bundled edges, and you open a directory (or search) to go deeper.
Focus mode on select, the search results list, the outline and the EVENTS table answer the five
questions at every size. Keep the spike's own layered layout, wrap wide layers, keep SVG and switch to
canvas only when more than ~400 nodes would be drawn. **No layout library is worth a dependency.**

## Method

Everything is in [`large/`](large/) (its own `package.json`; nothing here is a sygnal-check dependency):

| File | What it does |
|---|---|
| `gen.mjs` | Seeded synthetic InspectGraph: N components (App → Shell → Header / Router (a Switchable of feature pages) / Footer; one subtree per feature, depth 3–10; Collections, Switchables, slots; ~35 % view-only leaves, some in their parent's file; shared components with many parents; cross-feature renders; AdminApp above 200 and EmbedWidget above 500 as extra entries; N/5 event types, NAVIGATE emitted by 2.5 % of components and selected by the Routers + PageTracker; context providers at App, StoreShell and the feature pages; generic names repeated across features; diagnostics; agent surfaces; `form`/`chat` behavior actions). It uses the A-1/A-3/A-6 fields (`viewOnly`, `entry`, ids on links), which match what `plan10-integration` now emits. `addOne()` adds one component for the stability check. `--all` also scans every `examples/*/src` together |
| `model.mjs` | Pure, Node-testable: the model, groupings (directory, entry, Louvain communities), the projection (filters, focus, subtree folds, group folds with bundled edges, EVENTS as pairs or bus nodes), five layouts, crossings, area, stability |
| `explore.html` + `render.mjs` | The experimental page: one self-contained file (model inlined, libraries only when asked) with every strategy as a switch, an "auto by size" preset, SVG and canvas renderers, minimap, outline, icicle and EVENTS table views |
| `measure-node.mjs` | Layout time, crossings, drawing size, the zoom needed to fit 1440×900, stability (one component added) |
| `measure-browser.mjs` | Chromium (Playwright 1.63, cached browser): time to first paint, layout and draw time, frame intervals over 150 frames of zoom + pan (`window.__bench`), at the fit zoom and zoomed in (`--zoom 1`) |
| `task-check.mjs` | The five questions, answered by clicking and typing in the page |
| `shots.mjs` | The screenshots below |

Corpora:

| Corpus | Components | Render edges | Event types (pairs) | Context reads | Roots | Notes |
|---|---|---|---|---|---|---|
| syn-50 | 50 | 61 | 13 (37) | 7 | 1 | |
| syn-200 | 200 | 237 | 43 (91) | 31 | 2 | 68 view-only |
| syn-500 | 500 | 580 | 103 (283) | 81 | 3 | 136 duplicate names |
| syn-2000 | 2,000 | 2,441 | 403 (1,115) | 317 | 3 | depth 10, 683 duplicate names, 28 agent surfaces, 14 with errors |
| examples | 139 | 60 | 6 | 5 | many | all `examples/*/src` scanned together; mostly separate small trees |
| a private 33-component Vike app | 33 | 5 | 2 | 2 | 29 | 29 page entries, 3 view-only, only 6 distinct component names, 24 info diagnostics; artifacts kept out of the repo |

"fit k" below is the zoom at which the whole drawing fits a 1440×900 window minus the sidebar. Card
names are 14 px × k: **below about 0.45 the canvas cannot be read without zooming.**

## Results

### 1. Layout engines (Node, M-series laptop)

Render edges only; crossings are straight segments between the cards' ports.

| Corpus · strategy | Engine | Layout | Crossings | Drawing (px) | fit k |
|---|---|---|---|---|---|
| syn-200 · flat (spike) | layered (spike) | 1.4 ms | 976 | 14,202 × 1,674 | 0.08 |
| | tidy (d3-hierarchy) | 0.5 ms | 569 | 18,788 × 1,514 | 0.06 |
| | dagre | 54 ms | 416 | 18,274 × 1,834 | 0.06 |
| | ELK layered | 125 ms | 428 | 17,363 × 1,962 | 0.07 |
| syn-2000 · flat | layered | 15–25 ms | 140,469 | 148,140 × 1,834 | 0.008 |
| | tidy | 1.7 ms | 81,682 | 204,188 × 1,674 | 0.006 |
| | dagre | 2,780 ms | 62,436 | 206,606 × 2,154 | 0.006 |
| | ELK | **41,665 ms** | 63,036 | 195,076 × 5,544 | 0.006 |
| syn-2000 · directory groups, open | layered (each group on its own, boxes packed) | 13 ms | 44,033 | 18,008 × 14,376 | 0.06 |
| | ELK (groups as compound nodes) | 8,074 ms | 37,968 | 174,137 × 13,044 | 0.007 |
| syn-2000 · directory groups, folded (71 cards) | layered | 0.7 ms | 221 | 12,744 × 1,006 | 0.09 |
| | **layered, wrapped rows** | 0.3 ms | 556 | 3,088 × 1,629 | **0.38** |
| | dagre | 21 ms | 173 | 16,990 × 1,006 | 0.07 |
| | ELK | 136 ms | 86 | 12,753 × 1,748 | 0.09 |
| syn-500 · directory groups, folded (23 cards) | layered, wrapped | 0.1 ms | 41 | 1,668 × 1,073 | 0.70 |
| syn-200 · directory groups, folded (11 cards) | layered | 0.1 ms | 3 | 1,668 × 642 | 0.70 |

- Every engine draws a 2,000-node tree as a strip 150,000–200,000 px wide: real component trees are
  wide and shallow (depth ≤ 10, thousands of leaves). **No layout makes 2,000 cards readable at once;**
  the engines only trade crossings (dagre and ELK have half the spike's) for time.
- ELK and dagre cost seconds at 2,000 (ELK 42 s on the main thread; it would need a Web Worker) and
  win nothing visible once the graph is folded. d3's tidy tree is fast but draws only a spanning tree
  (the shared components' other parents become long crossing edges).
- **Wrapping wide layers** (a layer of more than ~1.2·√n cards continues on the next row) is the one
  layout change worth making: the folded 2,000 overview goes from k 0.09 to 0.38 (and 500 to 0.70).

### 2. Layout stability (one component added; needed for live mode, W-1)

Share of the common nodes that moved more than 20 px:

| Strategy | Engine | 50 | 200 | 500 | 2,000 |
|---|---|---|---|---|---|
| flat | layered | 28 % | 41 % | 77 % | 79 % |
| flat | tidy | 40 % | 96 % | 89 % | 94 % |
| flat | dagre | 56 % | 65 % | 25 % | 55 % |
| flat | ELK | 100 % | 70 % | 100 % | 100 % (median 59,000 px) |
| **directory groups, open** | **layered** | 12 % | **6 %** | **1.4 %** | **7.6 %** |
| directory groups, open | ELK | 92 % | 100 % | 100 % | 100 % |
| directory groups, folded | any | 0 % | 0 % | 0 % | 0 % |

Laying out each directory group on its own keeps an edit local: only the edited group moves (and the
groups packed after it, when its box changes size). ELK reorders globally on every change. With the
groups laid out separately, W-1 can also pin the other groups' positions and animate only the one that
changed.

### 3. Rendering (Chromium, headless, 1440×900)

Time to first paint is navigation start to the second animation frame after the first draw. Frame
intervals are over 150 frames of zoom + pan; the headless browser caps them at 16.7 ms, so 16.7 means
"no dropped frames".

| Corpus · strategy | Drawn nodes | SVG elements | First paint SVG / canvas | Frame p50 at fit, SVG / canvas | Frame p50 zoomed in (k = 1), SVG / canvas |
|---|---|---|---|---|---|
| syn-200 · spike flat | 200 | 3,038 | 75 / 41 ms | 16.7 / 16.7 | not run |
| syn-500 · spike flat | 500 | 7,757 | 96 / 54 ms | 16.7 (p95 33) / 16.7 | **100** / 16.7 |
| syn-500 · groups open, bus | 509 | 7,807 | 98 / 57 ms | 16.7 / 16.7 | **67** / 16.7 |
| syn-500 · groups folded (auto) | 23 | 513 | 52 / 47 ms | 16.7 / 16.7 | 16.7 / 16.7 |
| syn-2000 · spike flat | 2,000 | 30,705 | 296 / 92 ms | **267** / 16.7 | **1,750** / 33 |
| syn-2000 · groups open, bus | 2,034 | 30,783 | 283 / 89 ms | 16.7 (semantic zoom) / 16.7 | **267** / 16.7 |
| syn-2000 · groups folded (auto) | 71 | 1,968 | 82 / 80 ms | 16.7 / 16.7 | 16.8 / 16.7 |
| syn-2000 · subtrees folded at depth 4 | 402 | 8,467 | 121 / 78 ms | 16.7 / 16.7 | not run |
| examples (open strategies) | 146 | ~1,700 | 55–64 / 42–46 ms | 16.7 / 16.7 | not run |
| the private app (any strategy) | 25–34 | ≤ 500 | 39–49 / 38–42 ms | 16.7 / 16.7 | not run |

- **SVG is fine up to ~300–400 drawn cards.** Above that, panning drops frames once card text is on
  screen (100 ms per frame at 500, 1.75 s at 2,000). Semantic zoom (cards lose their text and the
  overlays below k 0.4) is what keeps the far-out view smooth: the same 2,000 cards pan at 16.7 ms
  with it and 267 ms without.
- **Canvas** holds 60 fps at every size (33 ms at 2,000 flat, zoomed in) and paints first in under
  100 ms, but loses CSS theming, per-element hover/focus, accessibility and the SVG export.
- Page size: the page without data is 76 KB (22 KB gzipped) with the model inlined; the graph JSON adds
  48 KB at 50 components, 179 KB at 200, 461 KB at 500 and 1.8 MB at 2,000 (151 KB gzipped). Model +
  projection + layout run in 6–25 ms at 2,000; the page is ready in < 100 ms with the folded default.

### 4. Strategies, one by one

| # | Strategy | Verdict |
|---|---|---|
| 1 | **Collapsible subtrees** (`+N` badge, a `−` on hover; auto-fold below depth D) | Keep the manual fold. Auto-fold by depth is a poor default: depth cuts across features (2,000 at depth 4 still draws 373 cards, fit k 0.15, 42,000 crossings; at depth 3, 122 cards with 24,000 crossings because the folded cards keep all the cross-links) |
| 2 | **Collapsible clusters**, edges bundled with counts | **The default above ~150.** By directory: 11 / 23 / 71 cards for 200 / 500 / 2,000, names people know, stable. By entry: degenerate (one group per app with one entry; 89 groups on the examples), but it equals "by page" for a many-entry app. By communities (Louvain on render + EVENTS + context): balanced groups (36 of ~55 at 2,000), but they have no names (named after their shallowest member), change when the code changes, and form no hierarchy, so the folded view is a hairball (22,714 crossings for 36 cards) |
| 3 | **Focus mode** (ancestors to the entry, children to depth 2, EVENTS / context peers, breadcrumbs, "Show all") | **Default on select above ~60.** 11–17 cards at every size, 0–2 crossings, legible (k 0.65–0.82). The overlays are limited to the focused component's own events and context reads; otherwise an ancestor such as App or Shell pulls in every event it selects |
| 4 | **Semantic zoom** (below k 0.4: card text, edge labels, EVENTS/context edges hide; group labels grow) | **Always on.** It is the cheapest performance win for SVG (above) and makes the far view a map of directories |
| 5 | **EVENTS bus nodes** | Only where they save edges. One bus node per type *adds* edges here (1,086 pairs → 1,289 edges + 403 nodes at 2,000) because most types have one emitter and one selector; a bus where emitters × selectors > emitters + selectors (NAVIGATE: 50 × 3) gives 34 buses and 915 edges. Between folded groups the pairs bundle anyway. Placement is the weak part: a lane right of the drawing is far from both ends; with hundreds of types the EVENTS table reads better than any drawing |
| 6 | **Views that aren't node-link** | **Outline** (render tree from each entry, lazy, a duplicate name shows its directory, "also in N" for extra parents): always visible in the sidebar; the most useful single view at 2,000. **EVENTS table** (type → emitters → selectors, sortable, filter): the right answer to "who handles X?" at any size. **Icicle** (sized by components / actions / state keys, coloured by kind / health / directory, click to zoom): good for "where is the app big / broken", not for wiring. Sankey: not built; it would be the bus view drawn left to right and has the same limits. A component × event grid would be 600 × 400 cells at 2,000: not built |
| 7 | **Filters** (directory, kind, only problems, hide view-only leaves, hide behavior actions, AI surface only) | Keep, in a menu. "Only problems" keeps the problem components plus their ancestors (dimmed). They matter less than search: nobody filters to a directory when they can search a name |
| 8 | **Layout engines** | See §1: keep the spike's layered layout, add layer wrapping and per-group layout. No library |
| 9 | **SVG vs canvas, minimap** | SVG by default; canvas when > 400 nodes would be drawn (only when someone opens everything). The minimap (a cached canvas of the drawing + the viewport) is cheap and helps once the drawing is larger than the window |
| 10 | **Stability** | Per-group layout: 1.4–7.6 % of nodes move on an edit at 500–2,000; folded: 0 %. Pin the untouched groups and animate the changed one (W-1) |

### 5. Task check

The five questions, adapted to each corpus (for the examples: who handles `DELETE_LANE`, where does
`LaneComponent` get `draggingLaneId`, what renders `TaskCard`; for the private app the questions were
picked from its own graph), answered by clicking and typing in the page in Chromium. **All 90 answers
were right**, in the same number of steps at every size and with every preset, because the answers come
from the page's tools, not from the drawing:

| Question | How it is answered | UI steps |
|---|---|---|
| Who handles NAVIGATE? | search → pick the EVENTS result → the trace bar lists emitters → selectors (or the EVENTS table) | 3 |
| Where does Checkout get `currency`? | search → pick the component → the detail panel reads `currency ← StoreShell` | 3 |
| Which components can an agent change? | open "AI agent surface" in the health list | 1 |
| What renders CartLine? | search → pick → "rendered by" in the detail panel | 3 |
| Which components have errors? | the error groups of the health list are open from the start (and the stat tile) | 0 |

Whether the answer is **also visible on the canvas** afterwards (its components drawn as their own
cards, in the viewport, at k ≥ 0.45) is where the strategies differ:

| Preset | 50 | 200 | 500 | 2,000 |
|---|---|---|---|---|
| spike (flat) | Q1, Q2 | none | none | none |
| auto (folded above 150 + focus on select) | Q1, Q2 | Q2 (Q4 at k 0.44) | Q2 (Q4 at k 0.40) | Q2 (Q4 at k 0.44) |
| folded, no focus | Q2 | Q2 | Q2 | Q2 |

On the examples and the private app every preset shows Q1, Q2 and Q4 on the canvas. Q1 ("who handles
an event") is never visible at 200+: the selectors sit in folded groups or far apart; tracing an event
should open the groups of its ends (a follow-up for V-4). Driving the page as an agent worked through
text alone: `#q` + Enter, then reading the detail panel and the trace bar; screenshots were needed only
to judge the drawing.

### 6. The real many-entry app

A private 33-component Vike app (the user's; numbers only): 29 of its 33 components are page entries,
there are only 6 distinct component names, and there are 5 render edges. Whatever the strategy it
draws 29 small islands; the spike's packing fits it at k 0.6, and every question is answered on the
canvas. What it shows instead:

- **Names don't identify components in a Vike app.** Cards titled `Page` are useless; the page has to
  title an entry by its route directory (`pages/<route>/`) when the name is a framework convention or repeats.
  The duplicate-name hint (the directory, skipping a trailing `components/`) helps in the outline,
  search and EVENTS table, but the card title should be the route.
- **The layout around the pages is not an edge.** Vike's `+Layout` wraps every page but is an unrelated
  island in the graph; an implicit "wraps" edge from the layout to each page would make it one tree.
- **Directory groups = routes.** For a routed app, the directory is the route, so folding by directory
  is folding by page; "by entry" gives the same groups.
- An event emitted by 13 components and selected by none (its selector lives in a package component the
  scan doesn't see) is exactly the case a bus node shows well (one node, 13 arrows in, a ⚠ out).

## Recommended defaults by size

N = scanned components (view-only included).

| | N ≤ 60 | 60 < N ≤ 150 | N > 150 |
|---|---|---|---|
| Grouping | directory boxes, open | directory boxes, open (each group laid out on its own) | **directory groups folded**: one card each, bundled edges `×N`; click to open one |
| Layout | the spike's layered | layered, per group | layered with **wrapped rows** for the overview; per group inside |
| EVENTS | emitter → selector pairs | bus nodes only where they save edges | pairs bundled between groups; buses where they save edges |
| Focus mode on select | off | **on** (depth 2) | **on** (depth 2) |
| Semantic zoom | on | on | on |
| Minimap | off | on | on |
| Renderer | SVG | SVG | SVG; canvas when > 400 nodes would be drawn |
| Always | search with a results list (components, event types, *why* it matched), the detail panel, the health list, the outline in the sidebar, the EVENTS table view; filters in a menu | | |

Not as defaults: auto-folding subtrees by depth, community grouping, entry grouping (except that it
equals directory grouping for routed apps), the icicle (keep as a view if cheap), canvas below 400 nodes.

The page code for all of this (model + projection + layered/wrap layout + both renderers + views) is
about 35 KB of model and 76 KB of page before minifying, all hand-written; the spike's template was 64 KB.

## Libraries

| Library | Bytes (min / gzip) | What it would buy | Verdict |
|---|---|---|---|
| d3-hierarchy 3.1.2 | 15 KB / 5.8 KB | tidy tree, partition (icicle), treemap | No: the tidy tree only draws a spanning tree and moved 90–96 % of nodes on an edit; the icicle's partition is 10 lines |
| @dagrejs/dagre 1.1.4 | 96 KB / 29 KB | fewer crossings (about half the spike's) | No: 2.8–4 s at 2,000, no gain once folded, 25–65 % of nodes move on an edit |
| elkjs 0.10.0 | 1,586 KB / 465 KB | layered with compound nodes (directory boxes), fewest crossings | **No**: 42 s at 2,000 (8 s grouped) on the main thread, every node moves on an edit, and it is 25× the page |

**No optional dependency is recommended** (D506's default holds). None of them helps with the actual
problem (thousands of leaves under a wide, shallow tree); folding does.

## What worked, what didn't

Worked: folding by directory with bundled counts; per-group layout (stability for free); wrapping wide
layers; focus mode limited to the focused component's own overlays; semantic zoom; search that lists
results instead of only highlighting (it works whatever is folded and reveals the hit: opens its group,
unfolds its ancestors, clears filters); the outline and the EVENTS table.

Didn't: any layout of all 2,000 cards; a bus node per event type (more edges, not fewer); the bus lane
far from both ends; auto-folding by depth; communities as the grouping; fitting to a trace whose
components are spread over the whole app (Q1).

## What I could not measure

- **Real frame times.** Headless Chromium caps rAF at 60 Hz and has no GPU compositor like a desktop
  window; the numbers rank the strategies but are not what a laptop screen shows. Firefox and WebKit
  were not measured.
- **People.** The task check was run by an agent through the page's UI (90 answers, all right). No
  person timed the five questions; the "visible on the canvas" check is a proxy for "a person sees it".
- **A large real app.** The largest real graphs are the examples together (139) and the private app
  (33). The 200–2,000 numbers come from the generator, whose shape (fan-out, depth, event density) is a
  guess based on those apps.
- Edge crossings count straight segments between ports, not the drawn Béziers; EVENTS and context
  crossings are listed by `measure-node.mjs` but not used in the verdicts.
- ELK in a Web Worker (it would keep the page responsive, not make it faster) and ELK's interactive
  (position-keeping) mode were not tried.

## Screenshots

`large/shots/` (synthetic corpora only):

| File | Shows |
|---|---|
| `2000-spike-flat.png` | the spike's layout at 2,000: a 148,000 px strip (the thin line) |
| `2000-auto-folded.png` | the default above 150: 71 directory cards, wrapped rows, semantic zoom |
| `2000-open-shop.png` | one group opened inside the overview |
| `2000-focus-checkout.png` | focus mode after searching `Checkout`: 14 of 2,000 components, breadcrumbs, `currency ← StoreShell` |
| `2000-events-table.png` | the EVENTS table filtered to NAVIGATE: 50 emitters → 3 selectors |
| `2000-icicle.png` | the icicle by component count, coloured by kind |
| `200-auto-open-groups.png` | 200 with open directory boxes, semantic zoom far out |
| `200-subtrees-depth4.png` | subtrees auto-folded below depth 4 |

```bash
npm --prefix dev-plans/research/graph-viz/large ci        # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
node dev-plans/research/graph-viz/large/gen.mjs --all
node dev-plans/research/graph-viz/large/render.mjs syn-2000 [--libs d3,dagre,elk]   # out/syn-2000.html
node dev-plans/research/graph-viz/large/measure-node.mjs
node dev-plans/research/graph-viz/large/measure-browser.mjs [--zoom 1]
node dev-plans/research/graph-viz/large/task-check.mjs
```

## Follow-ups for V-4 (proposed, not numbered)

- Card titles: the route for Vike `+Page` / `+Layout` entries, and the directory when a name repeats.
- Graph data: an implicit `wraps` edge from a Vike `+Layout` to its pages (with A-6's entry detection).
- Tracing an event opens the groups that hold its emitters and selectors.
- A second grouping level for very large apps (`src/features/*` as one card above ~60 groups).
