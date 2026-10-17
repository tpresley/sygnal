# S-2: runtime graphs in the renderer

PLAN-10 S-2 (D503). Question: what does the spike page need to render a runtime `inspect()` graph
(`source: 'runtime'`), how should instances map onto cards, and what would `inspect()` have to add?
Feeds V-3, P-1 and A-8's runtime part.

**Answer:** the page renders runtime graphs with a small adapter in front of its model (about 90
lines), no change to `inspect()` needed for a first version. Instances are grouped **one card per
(parent card, component name), `×N`**, with the instances and their state in the detail panel. Four
of the page's static health checks are wrong at runtime and must be switched off or reworded. The
missing piece for P-2 (static + runtime together) is a **definition id at runtime**: names are
ambiguous (two `Signup`, two `Row` in plan5-showcase; eight `Chat` in ai-showcase).

## Files

| File | What it is |
|---|---|
| `runtime/kanban.runtime.json` (+ `.initial.json`, `.state.json`) | kanban through `renderComponent` (mock DOM) + `t.inspect({ actions })`, after a short session (add lane, add / delete task, move a lane); `.initial` before any interaction |
| `runtime/plan5-core.runtime.json` (+ `.state.json`) | plan5-showcase "core" section in Chromium (Vite dev, `__SYGNAL_DIAGNOSTICS__.inspect({ actions: 80 })`) after clicking the demos: 9 `run()` apps, 23 instances |
| `runtime/plan5-lists.runtime.json` (+ `.state.json`) | plan5-showcase "lists": 3 apps, 23 instances (`Row ×13`, `Card ×5`) |
| `runtime/kanban.probe.test.js` | the throwaway vitest that wrote the kanban samples (how to run it is in its header) |
| `runtime/make-runtime-page.mjs` | applies the S-2 patches to a copy of `template.html` → `runtime/template-runtime.html`, renders `runtime/out/*.html` |
| `runtime/out/*.html` | the runtime pages (grouped); `plan5-lists.instances.html` is the one-card-per-instance alternative |

The `.state.json` files are per-instance `currentState` read from the devtools bridge
(`__SYGNAL_DEVTOOLS__._components`), because `inspect()` has no state values.

## The spike page on a runtime graph, unchanged

It throws on load: `c.file.split('/')` (a runtime component has no `file`). With that guarded, the
tree is still wrong: children are resolved **by name**, so the four `LaneComponent` instances become
one child of the root plus three disconnected roots.

## Differences from the static graph

Measured on the three samples against `sygnal-check --graph --json` of the same app.

| Field / aspect | Static | Runtime | Consequence for the page |
|---|---|---|---|
| unit | one entry per component definition | one entry per **live instance** (kanban: 3 components → 8 instances; lists: 6 → 23) | group them (below) |
| `id` | `'file:line'` | instance number (`'0'`…), global across the page's apps; gaps where an instance was disposed (kanban: `5` gone after a delete) | cards need their own key; instance ids are only for the detail panel and flashes |
| `parentId` | always `null` | the real parent instance; `null` for every `run()` root (plan5-core: **9 roots**, one per demo app) | the tree comes from `parentId`, not from `children` names |
| `file`, line | yes | **absent** | no click-to-code, no directory clusters; the card shows instance ids instead of `file:line` |
| `children[]` | `{ name, via, from }` | `{ name, via, count }`: no `from` (Collection labels show `[ ]`), no id | build edges from `parentId`; `from` is lost |
| view-only components | missing (A-1) | **present** (`Greeting`, `Total`, `Score`, `Home`, `TaskPage`, `NotFound`, `Topic` in plan5-core) | runtime already has what A-1 adds statically |
| Switchable | the pages the view names | **every page mounted** (`Home`, `TaskPage`, `NotFound` all live; only one shown) | show which page is shown (`InstanceView.shown`, not in `inspect()`) |
| `actions[].trigger` | declared (`intent`, `next`, `reply`, `agent`, `unknown` = nothing triggers it) | observed: `next` / `reply` only once one ran; **`unknown` = not seen yet** (lists: `Groceries.CHILDREN`) | "Actions nothing triggers" (shown as "never", red) is a false alarm at runtime |
| built-in actions | rarely listed | listed per instance (`INITIALIZE`, `RESOURCE`, `HYDRATE`…): lists 23 builtin vs 0 static | fine; collapse them in the detail panel |
| `selectors[].matched` | "the view source renders it" | "the **latest render** has it" (kanban: 10 of 32 `false`: the rename input, the new-task input, the move-left button of the first lane) | "Selectors not in the view" is a false alarm at runtime |
| `eventsEmitted` / `events[type].emitters` | declared emits | **emitted so far** (kanban before any click: `DELETE_LANE`, `MOVE_LANE_LEFT/RIGHT` have no emitter; after the session one does) | "Events nobody emits" is a false alarm; say "not emitted yet" |
| `contextConsumes` | the view's reads | `null` | no context edges (the core tracks reads, see fields below) |
| `uses`, `commands`, `timers`, `agent` | yes | absent | static-only sections stay empty |
| `controls` | from the view | from the render (only in plan5-core here) | same shape |
| `resources` | absent | runtime only (`status`, `hasData`…) | show in the detail panel |
| `recentActions` | absent | with `inspect({ actions })`: `type`, `data`, `component`, `instance`, `sinks`, `cause`, `at` | flashes, per-card counts |
| state | keys only | keys only (`stateKeys` from `currentState`) | values must come from the host (devtools has them) |
| diagnostics | per run of the rules | **sticky**: SYG105 for `MOVE_LANE_LEFT` stays after the lane emitted it (reported once per process) | show runtime diagnostics with their time, or re-evaluate on `inspect()` |

`inspect()` cost in Chromium (mean of 20 calls): 0.16 ms on plan5-core (23 instances, 15 KB of JSON)
and 0.9 ms on plan5-lists (23 instances, 12 KB), so a host can call it after every batch of changes.

## The mapping

Compared on `out/plan5-lists.html` (grouped) and `out/plan5-lists.instances.html`.

- **One card per (parent card, component name), `×N` (recommended).** `People → Row ×13`,
  `Board → Card ×5`, `Groceries → Item ×2`: six cards, the same shape as the static graph, so the
  static layout, overlays and search work unchanged. Root instances group by name, so a restarted or
  duplicated `run()` app shows as `×2`. The card's own fields are the union over its instances (an
  action's trigger is the "best" seen; a selector is matched if any instance matched it).
- **One card per instance (rejected as the default).** The lists page becomes 23 cards in two very
  wide rows that can't be read at fit zoom; a 200-row list would be unusable. Keep it only as the
  detail panel's instance list, and maybe as a "expand this card" action later (V-4).
- **Live state:** in the detail panel, an "Instances" section: one row per instance id, with its
  item key (`state.id` when present) and its state as collapsible JSON (open when there is one
  instance). State is fetched by the host for the selected card only (devtools already answers
  `GET_STATE` and posts `STATE_CHANGED`); never inlined in the graph.
- **Recent actions:** a "Recent actions" chip list per card (`RESOURCE ×6`, `NEXT ×1`), each a trace
  link.
- **Flash on actions:** the page exposes `window.__sygnalGraph.action(record)` (in V-1: a host
  adapter method); the prototype maps `record.instance` to its card and plays a 0.9 s ring
  (a steady outline under `prefers-reduced-motion`). P-1 calls it from the devtools `ACTIONS`
  message, which already carries the instance. `__sygnalGraph.replay()` replays `recentActions`.
- **Health at runtime:** the four derived checks above are off; two faint "not seen yet" groups
  replace them ("Actions not seen yet", "EVENTS selected, not emitted yet"). Diagnostics by code
  stay.

The adapter is `fromRuntime()` in `runtime/make-runtime-page.mjs`; the other patches there are
the guards (no `file`), id-based child and event resolution (also what A-3 needs statically), the
×N label, the detail sections, and the flash.

## Fields `inspect()` would need (A-8, runtime part)

| Field | Purpose | Runtime cost | Recommendation |
|---|---|---|---|
| `children[].ids` (instance ids) | edges without name resolution | none: `childrenOf()` already iterates them | **add** |
| `events[type].emitterIds` / `selectorIds` (instance ids) | A-3 parity | none | **add** |
| `entry: true` on `run()` roots | A-6 parity (entries first) | none: `parentId === null` | **add** (or let the page derive it; adding keeps the field meaning the same in both sources) |
| `viewOnly: true` | A-1 parity (lighter cards) | none: the definition has no intent and no model (`def.intent`, `def.handlers.size`) | **add** |
| `app` (index of the `run()` the instance belongs to) | multi-app pages (plan5: 9 apps) | small: the root ancestor; `devMcp` already lists apps | **add** |
| `shown: false` | the hidden Switchable pages | `InstanceView.shown` exists | **add** |
| `children[].from` (Collection field) | the `[tasks]` label | the Collection host knows its lens | add if the host exposes it cheaply; else static-only |
| `contextConsumes` | context edges | the core tracks the keys the last view read (`Inst.keys`, D168) but `InstanceView` doesn't expose them | needs a getter on `InstanceView`: **core bytes** (a few), so a decision; until then static-only |
| a definition id (`def: 'src/x.jsx:12'`) | joining runtime to static (P-2), click-to-code at runtime | needs the source position at run time: a dev-only stamp by `sygnal/vite`'s transform (`Comp.__sygnalDef`), 0 bytes in builds | **the enabler for P-2**; decide with W-2 |
| `file`, `line` on the instance | click-to-code | as above | follows from `def` |
| state values | the detail panel | large, not always serializable, may be private | **do not add**; the host fetches the selected card's state (devtools `GET_STATE`) |
| source lines on actions, selectors, usages (A-4) | jump to the exact line | not known at run time | **static-only** |
| `uses`, `commands`, `timers`, `agent` | static sections | partly knowable (`def.behaviorActions`, timers) | static-only for now; the page hides empty sections |

None of the "add" fields needs a core change: they are computed in the dev entry
(`checks/inspect.ts`) from `InstanceView` / the records it keeps. They make the runtime graph a
sygnal minor (D513), separate from sygnal-check 0.10.0.

## What P-1 needs beyond the page

- The devtools panel does not call `inspect()` today (it builds its own tree from
  `COMPONENT_CREATED` etc.). P-1 needs a bridge message (`GET_GRAPH` → `GRAPH`) answered with
  `this.inspect?.({ actions: 200 })`, which exists only when `sygnal/diagnostics` is loaded
  (`sygnal/vite` loads it in dev; `diagnostics: 'off'` doesn't). Without it, the tab shows a notice.
- Re-request on `COMPONENT_CREATED` / `COMPONENT_DISPOSED` (debounced to a frame); flashes from
  `ACTIONS` without re-requesting.
- The extension loads the V-1 files from `devtools/` (copied by `devtools/build.mjs`), since the
  panel can't import sygnal-check at run time; T-2 covers the shared page.

## Open questions

1. Expose the context read keys on `InstanceView` (a few core bytes) so runtime graphs get context
   edges? Recommendation: not now; the static graph has them, and P-2 overlays the two.
2. A dev-only definition stamp from `sygnal/vite` (the join key for P-2)? Recommendation: yes, with
   W-2 (it is a Vite-only feature anyway); id format equal to the static `id`.
3. Runtime diagnostics are reported once per process, so a fixed SYG105 stays listed. Re-check on
   `inspect()` (as `checkEventBus()` already does for SYG105) or show each with its time?
   Recommendation: show the time; leave the reporting alone.
