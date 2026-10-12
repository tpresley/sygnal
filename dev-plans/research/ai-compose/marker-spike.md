# 0-S1: the `<Composed>` marker spike

PLAN-9 spike 0-S1, 2026-10-11. Code: branch `exp/p9-composed` (commit `fce942d6`, not pushed), in the
worktree `.claude/worktrees/agent-a06621c8efbaecb24`.
- Marker: `src/core/markers/composed.ts`, `src/composed.ts`, plus `src/index.ts` and `src/index.d.ts`.
- Example: `examples/ai-compose-api/`. `lib/catalog.jsx` has `show()` and `VIA`; set `COMPOSE_VIA=marker`
  to run every app through the marker.
- Tests: `marker.test.jsx`, `marker-bench.test.jsx`, `realdom-move.test.jsx`.
- Size probes: `size/{base,render,marker}.jsx`.

Re-run by the coordinator: 36 pass, plus 1 expected failure (the core bug, below).

## Recommendation: ship as low-priority sugar (M-1, Phase 3)

**No host is needed.** A `pres` template rewrite is enough, the same mechanism Portal and Transition
use. During the owner's reconcile walk it replaces the marker with
`catalog.render(getIn(state, from), state, { at, composeKey, scope, frozen, answer, card })`.
- The parts become ordinary owner children with the same `sel::id` identity, so parity with
  `render()` holds by construction.
- `from` takes a key or a path (`['cards', 'byId', id]` for chat cards).
- It is registered by `enableComposed()`, which `defineCatalog` calls, not at module level. Registering
  at module level, as Portal does, cost kanban +174 B (G-751).

A Collection-style host was rejected: it would copy reconcile/inject (100+ core lines) and keep the
parts in the host's own Map.

## Numbers

- **kanban size gate:** 42,690 B before and with `Composed` exported, so 0 B.
- **Marker cost when imported:** a probe app is 40,010 B with `render()` and 40,227 B with the
  marker, so **+217 B gzip** (+623 B min).
- **Size gate (c), informational:** `src/core/**` goes from 18,244 to 18,475 B, only because the file
  sits in `src/core/markers`. It could live outside the core.
- **Core diff:** 0 lines changed in existing core files. New files: `markers/composed.ts` (+39),
  `composed.ts` (+12), index (+1), types (+4).
- **Invariants:** none touched (identity, teardown, flush, dirty-checking). It uses the `pres`
  registry and `owner.failed()`.
- **perf-gate (3 runs):** every count is the same as the baseline.
- **12-part micro-benchmark** (jsdom, real DOM driver): the same DOM patches (1 per step) and view
  calls (12 at mount, 8 per step) in both forms. Reorders take 1.26–1.59 ms in both; the difference
  is noise.
- **inspect():** 13 components, and every part's parent is the host.
- **HMR** (checked live with `app.hmr()` in jsdom): the composition and local part state are restored.

## Findings

1. **A core bug, independent of PLAN-9 (G-750).** In a real DOM, a component instance with an `id`
   that moves to an *earlier* parent element in one patch crashes the DOM driver.
   - `Inst.inject` reuses the cached `outv`; snabbdom's `createElm` overwrites the shared `vnode.elm`,
     and removing it from the old parent then throws NotFoundError (`data-sygnal-error="patch"`).
   - The repro uses plain Sygnal: Counters with `id` in two `<div>` columns. Moves to a later parent
     and sibling reorders work.
   - The mock DOM hides it, so the prototype's "survives a move out of tabs" test would fail in a
     browser.
2. **Errors are contained differently.** A throwing container view or `props()` replaces the whole
   host view with `render()`. With the marker, only the composition is replaced (SYG408).
3. **The marker reads the owner's state cell,** so view-computed compositions need `render()`.
4. **For K-2 (G-752):** `local` parts re-render on every host state change, because `lensOf` builds a
   new lens each render. Memoize lenses per node key.
5. **G-751:** markers registered at module level are not tree-shaken. `package.json` has no
   `sideEffects` field, so Portal is in kanban's bundle today, and D157's "pays nothing" doesn't hold
   for markers exported from the main index.
