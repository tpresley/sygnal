# D471: removing the lowercase marker tags (next major) — prepared, not applied

Patch: `removal-variant.patch` (this folder; against p9-lowercase 8029c4fe, `git apply`).

## What the patch removes

1. `src/collection.ts`, `src/switchable.ts`: no `import './core/hosts/…'` on module load. Each
   marker gets `$reg` (the pragma calls it, as Portal/Transition/Suspense since G-751) and calls
   it in its body.
2. `src/core/hosts/collection.ts`, `src/core/hosts/switchable.ts`: `hosts.x = …` becomes
   `export const enableCollection / enableSwitchable = () => { hosts.x = … }`.
3. `src/pragma/index.ts`: the `/^(collection|switchable)$/i` host bit in `bits()` (the string tags
   are no longer hosts; the capitalized markers are components, so never "plain").
4. `src/core/instance.ts` (reconcile + inject): a host is looked up only for a marker vnode
   (`data?.m && hosts[sel]`), so `<collection>` renders as an element even after Collection
   registered the host. VirtualCollection's marker already has `m: 1`.
5. `src/index.d.ts`: the `collection` / `switchable` JSX intrinsic elements.

Not in the patch (also for the major):
- `<clientonly>`: `pres.clientonly` (core/markers/clientonly.ts, registered by runtime.ts) still
  unwraps a string tag; give the pre a `data.m` check (careful: reconcile stops walking when a pre
  returns its input, so check at dispatch or rewrite to a plain element). Same for `<portal>`,
  `<transition>` (pres) and `<suspense>` (posts) once their marker registered (G-751).
- `src/extra/ssr.ts`: renderToString treats `sel === 'collection'` (and the others) by sel;
  require `data.m` there too.
- Tests that assert the lowercase tags work: `test/p9-g751-marker-treeshake.test.js` (the
  "always-on hosts" expectations become "none"), `test/p46-r7-fixes.test.js` (G-350 host bits),
  `test/p9-d471-lowercase-tags.test.js` (becomes "renders an unknown element"); test fixtures
  that build `{ sel: 'collection' }` by hand (`test/ssr.test.js`, `test/p5-4j/4k-review.test.js`).
- SYG426: the dev check can go (or turn into a "removed in 7.0" SYG612-style error); the
  sygnal-check rule SYG426 stays useful with its --fix (severity error, "removed").
- `type-tests/app.tsx` uses `<collection>` (kept in 6.x to type-check the deprecated tag).
- Docs: drop the deprecation sentences in reference/api.md and guide/switchable.md; add a
  migrating-to-7 entry.

## Measured (Apple silicon, `node scripts/size-gate.mjs`; small apps built the same way with
## examples/kanban's Vite + sygnal/vite, `nativeGlobalThis: false`, `gzip -c`; script: measure.mjs)

| bundle | 6.3.0 branch | removal variant | win |
|---|---|---|---|
| kanban (a), gated | 42,504 B | 41,772 B | −732 B (Switchable's host dropped; kanban uses Collection) |
| kanban (b), default | 38,485 B | 37,746 B | −739 B |
| src/core/** alone (c) | 18,346 B | 18,365 B | +19 B (the `enable*` wrappers, `data?.m` checks) |
| marker-free app | 39,963 B | 37,030 B | **−2,933 B** |
| Collection-only app | 39,987 B | 39,269 B | −718 B |
| Switchable-only app | 39,956 B | 37,789 B | −2,167 B (keeps part of the Collection host: `resolve`) |

The root vitest under the variant: the failures were the lowercase-tag tests listed above (by
design); three load-related timeouts (p5-1r G-363, p9-decisions, vite-plugin-dev) passed when
re-run alone.
