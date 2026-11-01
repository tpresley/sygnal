# Collaborative state through a CRDT (research)

**Status:** productized as the experimental `sygnal/yjs` subpath (P0–P2 of §9) on `claude/build-yjs`; see "Productized" at the end. The spike below is kept as it was. Branch `claude/explore-crdt-state`, from `claude/advanced-integration` (7.2.0-preview.0).
**Question:** can part of a Sygnal state tree be shared between clients through a CRDT (Yjs first) and still keep "one state tree, reducers in the model, effects as data"?
**Short answer:** yes, without changing the core. A driver owns the `Y.Doc`. A behavior (`uses: { board: shared() }`) sends each new value of `state.board` to the driver as data, and brings remote changes back in as an action. Reducers don't change and know nothing about Yjs. The spike passes 24 tests: two- and three-client convergence, offline merge, per-user undo, presence, a real y-websocket server, and a randomized fuzz (300 runs × 40 actions passed locally). A local operation costs 14–155 bytes on the wire and 0.02–0.7 ms of driver time at 10–1000 items. It adds 0 B to the core.

Related: `../fullstack-contracts/README.md` §4.5 (`$sync`: server-pushed invalidation, the "5% version") deferred full sync engines. This document covers the client-replica / CRDT half of that decision. It doesn't cover the server-authoritative half (Zero, Electric); see §2.3.

---

## 1. Recommendation in one paragraph

Ship an experimental **`sygnal/yjs`** subpath (Yjs and y-protocols as **optional peer dependencies**, D209) with two exports:
- `makeYjsDriver({ doc, awareness?, text? })`: the app passes in its own doc and its own provider (y-websocket, Hocuspocus, Liveblocks, y-indexeddb, …), so Sygnal ships no network code.
- `shared({ presence?, history? })`: a behavior that binds one top-level state key to the doc.

Local writes are **diffed** (the last local value against the new one) into Yjs operations. Remote changes arrive as one **`<key>.REMOTE` action** whose reducer applies only if the slice is unchanged since the driver last saw it. Arrays of objects with `id` map to **id-keyed collections with fractional order keys**. Every structured value on the slice's object path is a **root-level Yjs type named by its path**, because the spike showed that nested types created concurrently lose data (§3.6). Undo is per user, through `Y.UndoManager`, as a driver command. Presence is a source. Before shipping: decide the open questions in §8, especially whether to declare the shape (schema) instead of inferring it, and teach `sygnal-check` that a `shared()` slice keeps the host's initialState (SYG127 is a false positive today).

## 2. Prior art and fit

### 2.1 CRDT libraries

| | Model | Arrays / moves | Text | Undo | Size (gzip, tree-shaken) | Fit for Sygnal |
|---|---|---|---|---|---|---|
| **Yjs** 13.6.33 (latest; 14.0.0 in beta as `yjs@beta`, 14.0.0-16) | Shared types: Y.Map / Y.Array / Y.Text / Y.Xml*, mutable API, transactions with an `origin`; updates are compact binary | Y.Array insert/delete, **no move** (a move is delete + insert, which loses concurrent edits to the moved element) | Y.Text, the best editor bindings (ProseMirror, TipTap, CodeMirror, Monaco, Lexical, BlockNote) | `Y.UndoManager`, scoped by type and **by transaction origin**: per-user undo for free | ~21 KB (Doc + Map + UndoManager); ~29.6 KB with all exports + awareness | **Best first target.** Huge provider ecosystem (y-websocket, Hocuspocus, y-webrtc, y-indexeddb, Liveblocks, Tiptap Cloud, PartyKit). Origins make echo suppression and per-user undo straightforward |
| **Automerge** 3.5.0 (`@automerge/automerge`, `automerge-repo`) | JSON document with full history; `change(doc, d => { mutate })`, immutable snapshots out | Lists; no native move | Text with marks (`splice`, `updateText`); 3.0 cut memory use >10x | No built-in per-user undo manager | Wasm, several hundred KB | **Closest to Sygnal's model:** a JSON document in, an immutable JSON document out, and `updateText`-style diff APIs. The wasm size and missing undo make it the second target. The spike's diff approach maps onto `Automerge.change` directly |
| **Loro** 1.17.1 (`loro-crdt`) | Containers: Map, List, **MovableList**, **Tree** (movable), Text (Fugue / Peritext), Counter; version DAG / time travel | **Native move**: MovableList keeps each element in exactly one position after concurrent moves; Tree prevents cycles | Rich text | `UndoManager` (local) | Wasm, large | **Best data model** for kanban columns (MovableList) and outlines (Tree): it removes the spike's fractional-key workaround. The wasm cost and the smaller provider ecosystem argue for a second adapter on the same driver contract |
| **Liveblocks** (`@liveblocks/client`, `@liveblocks/yjs` 3.24) | Hosted rooms: LiveObject / LiveList / LiveMap storage, presence, comments; a Yjs provider | LiveList has `move` | via Yjs | Room-level history | SDK | A **provider**, not a model: with `@liveblocks/yjs` it plugs into the spike's driver unchanged. Paid hosting, so no calls were made from this spike |

### 2.2 How UI frameworks bind them

| Binding | How it works | Lesson for Sygnal |
|---|---|---|
| **SyncedStore** (`@syncedstore/core` 0.6.0, last published 2023) | A Proxy over Y.Doc; you mutate `store.todos.push(...)` directly; reactivity through MobX / Vue / Svelte adapters | Mutation as the write API conflicts with "reducers return new state". Unmaintained, so it isn't a dependency candidate either |
| **valtio-yjs** 0.7.0 (`bind(proxy, ymap)`) | Two-way binding: valtio's proxy mutations become Y ops, Y events patch the proxy | The closest analogue to the spike's diff. valtio gets the ops from its proxy, the spike gets them by diffing immutable snapshots. Same echo suppression by origin |
| **zustand-middleware-yjs**, Liveblocks' `@liveblocks/zustand` / `@liveblocks/redux` | Wrap the store's `set`. The new state is diffed / patched into shared storage, and remote changes `set` the store. A `storageMapping` names which top-level keys are shared, and `presenceMapping` names presence | **The pattern the spike follows:** an immutable single store, a mapping of shared top-level keys, a diff after each write, remote changes as store writes. Liveblocks' Redux enhancer is the nearest relative of "remote changes as actions" |
| **Automerge-repo React hooks** (`useDocument` → `[doc, changeDoc]`) | Immutable doc in, a `changeDoc(fn)` mutator out | Shows the "reducers emit ops" alternative (§3.2, option B) |

### 2.3 Sync engines (server-authoritative)

| | What it is | Fit |
|---|---|---|
| **ElectricSQL** (current "Electric Sync": Postgres → shapes over HTTP, read-path only; writes through your API) | Live partial replication of Postgres tables to the client | A **resource that never goes stale**: an HTTP-streaming source, close to `makeFetchDriver` resources plus the socket driver. It doesn't need a CRDT |
| **Zero** (Rocicorp) | Client replica + ZQL live queries + server-authoritative custom mutators (optimistic on the client, re-run on the server), Postgres behind it | A driver whose source is the replica. Queries map to resources, and mutators are data (`{ mutate: 'addIssue', args }`), which fits effects-as-data well. Server-authoritative conflict resolution, not a CRDT |
| **Replicache** | Zero's predecessor (client storage layer), now in maintenance mode | Don't target it; target Zero if anything |

**Fit summary.** Sygnal's invariants are a single state tree, pure reducers, and effects as data. The *store-mapping* family (Liveblocks Redux / Zustand, zustand-yjs) keeps all three: reducers stay pure, the CRDT sits behind a driver, and remote changes come in as actions. Proxy bindings (SyncedStore, valtio-yjs) give up pure reducers. Sync engines are a different product, a server-authoritative replica, that would be a driver plus resources. They are worth a separate spike, and they don't conflict with this one: a CRDT slice and a Zero driver can live in the same app.

## 3. Design

### 3.1 Which slice is shared

| Option | Pros | Cons |
|---|---|---|
| **A. A behavior on a key: `uses: { board: shared() }`** (spike) | Uses the existing `uses` merge loop, so the core is unchanged (D114). Namespaced actions (`board.REMOTE`), and the slice is a top-level key like other behaviors' | One key per use; SYG127 assumes a behavior owns its slice's initial value (§6) |
| B. A component static `shared = ['board']` / `{ board: { text: [...] } }` | Reads naturally; one place for the shape | Needs a definition hook in the core (bytes), or a new registry entry |
| C. A lens (`shared({ get, set })`) | Can share a deep sub-path | The driver then needs stable paths for root-level types (§3.6), and lenses are opaque |
| D. Driver only (the app wires `LOCAL` / `REMOTE` itself) | No magic | Every app repeats the same 4 model entries and the `base` check |

**Decision (spike):** A. It costs nothing in the core, and it's how persist / undo / pager already attach. B is the likely public sugar *over* A if a schema is added (§8 Q1).

### 3.2 How local reducer writes become CRDT operations

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Diff next against previous** (spike) | The behavior feeds each new `state.board` to the driver (`board.LOCAL`, a sink-only action from the STATE stream). The driver diffs it against the last value it saw and writes the difference in one `doc.transact(…, origin)` | Reducers unchanged; **every** writer is covered (host reducers, Collection item reducers through their lens, another behavior's undo, persist's RESTORE, devtools state edits); testable without Yjs | O(slice) diff per change (cheap: §5); intent is inferred (a delete + add of the same id isn't a move; an edit can't express "insert at position" in text except by prefix/suffix) |
| B. Reducers emit ops | `ADD: { SHARED: (s, d) => ({ insert: ['items', d] }) }` and the state comes back from the doc | Exact intent (moves, text splices) | Every reducer is written twice (state + ops), or state is only read from the doc, so the model isn't the writer any more. Breaks `renderComponent` tests that check state after an action without a doc |
| C. Proxy-recorded mutations (Immer patches) | Reducers written with `produce`; patches become ops | Exact intent, one write | Pulls Immer into reducers; still misses writes that aren't Immer-based |

**Decision:** A, made **3-way and idempotent**:
- 3-way: the diff is `last local value → new local value`, never `document → new value`. Keys and items the user didn't touch are left alone even when the document holds newer remote values for them.
- Idempotent: a value the document already holds isn't written again. A stale `last` (the doc moved on before the app's state caught up) therefore never reverts or duplicates a remote change. The test `3-way writes › a stale local snapshot…` covers it.
- B remains useful for exact text intent: a future `{ SHARED: { text: { path, delta } } }` command from an editor binding (§3.7).

### 3.3 How remote updates enter (the model stays the only writer)

On a document change from anywhere else (a peer, a reconnect sync, the UndoManager), the driver reads the slice. It **reconciles** the result against the last value, reusing every deep-equal object so Collection items keep their identity and skip rendering. It then emits `board.REMOTE` with `{ value, base }`:

```ts
'board.REMOTE': (s, { value, base }) => s.board === base ? { ...s, board: value } : ABORT
```

If local changes are already queued (`s.board !== base`), the REMOTE is dropped, the queued LOCAL writes them to the doc, and the driver then emits a fresh REMOTE with the merged content. A remote value never overwrites an unsynced local edit, and the reducer stays pure. Remote changes show up in the action log, devtools and `t.actions` like any other action.

### 3.4 Presence / awareness

Presence is **not state that's synced through the doc**. It is a source (y-protocols `Awareness`, which every provider offers). `shared({ presence: 'peers' })` writes the other clients' states to `state.peers` through `board.PRESENCE`. A model entry sets this client's own state as data: `FOCUS: { SHARED: (_, id) => ({ presence: { editing: id } }) }`. The test checks that presence never reaches the document.

### 3.5 Undo per user

| | Sygnal `undo()` / `undoable()` on the shared key | `Y.UndoManager` (spike) |
|---|---|---|
| What it reverts | the whole slice to a snapshot, **including other users' later changes** (a global undo) | only this client's transactions (`trackedOrigins: [local]`); a remote change made after this client's edit survives |
| Coalescing | `coalesceMs` | `captureTimeout` |
| Wiring | behavior | a command: `UNDO: { SHARED: { undo: 'board' } }`, `REDO: …`, and `shared({ history: 'history' })` → `state.history = { canUndo, canRedo }` |

**Decision:** the UndoManager for shared slices. Sygnal's `undo()` on a shared key should be a diagnostic ("undo() on a shared() slice reverts other users' changes; use `{ SHARED: { undo } }`"), and `undo()` on non-shared keys keeps working next to it. The spike had to add the slice's path-named root types to the UndoManager scope *inside* the transaction that creates them; adding them after the transaction misses the first change.

### 3.6 Arrays: Collection items with ids, moves, and a data-loss finding

- **Arrays of objects with `id`** map to an id-keyed `Y.Map` of item maps, plus a fractional order key `$o` per item. The array is the items sorted by (`$o`, id).
  - Concurrent adds both survive. An edit and a toggle of the same item on different fields both survive.
  - A move is **one register write**. An edit to a moved item survives the move, and an item moved to two places concurrently ends in one place (LWW on its key) with no duplicates.
  - Delete wins over a concurrent edit; there is no resurrection.
  - The order pass keeps the longest increasing run of existing keys and rekeys only the rest, so one move writes one key (≈52 bytes). It runs only when this side's id order changed.
- **Other arrays** map to a `Y.Array` of JSON values, spliced by common prefix and suffix.
- **Finding (data loss):** the first version stored `board.items` as a nested `Y.Map` set under the key `items`. Two clients that create that map concurrently (both offline, or both seeding an empty doc) produce two Y.Maps under one LWW key, and **one client's whole collection is silently lost**. `test/mapping.test.ts` shows it in raw Yjs. The fix is that every structured value on the slice's object path is a **root-level type named by its path** (`doc.getMap('board.items#c')`), and the parent holds a marker. Root types merge by name. Inside items, values stay nested types: an item is created by one client, so the race is rarer, and it is LWW at creation. Any real binding (and any app using Yjs by hand) must handle this.
- Fractional keys: the spike has its own `between()`. A real version should depend on `fractional-indexing` (4.0.0, maintained; D209) or offer Loro's MovableList as the backend.

### 3.7 Text

By default a string is LWW: two users editing one title concurrently → one wins. `makeYjsDriver({ text: ['text'] })` makes those fields `Y.Text`, so concurrent edits merge by character ("oh hello" + "hello world" → "oh hello world" in the test). The splice is inferred from the prefix and suffix of the old and new values, and rebased over a concurrent remote splice. That's good for inputs and approximate for overlapping edits. Rich-text editors should bind their own Y.XmlFragment / Y.Text through the existing widget path (`defineWidget`, y-prosemirror / y-codemirror) and keep it out of the state tree. The driver can expose `SHARED.type(path)` for that.

### 3.8 Offline and reconnect, and the first value

- Offline needs nothing from Sygnal: the doc keeps the local updates and the provider's sync step 1/2 (state vectors) merges them on reconnect. The in-memory network in the spike does the same exchange as y-websocket, and the websocket test exercises `provider.disconnect()` / `connect()` on the stock provider.
- Persistence across reloads is the provider's job (`y-indexeddb`). It shouldn't go through Sygnal's `persist` (a JSON snapshot can't merge).
- **The first value:** if the doc is empty when the slice first reaches the driver, it is seeded from `initialState`; otherwise the doc wins. Two clients seeding the same ids merge without duplicates, because ids are keys and the deterministic order keys are equal. Items with *random* ids seeded twice would duplicate. A real version needs `seed: 'never' | 'ifEmpty' | 'whenSynced'` (wait for the provider's `synced`) (§8 Q3).

### 3.9 Testing two peers

`renderComponent` needed nothing new. Each client is `renderComponent(Board, { drivers: { SHARED: makeYjsDriver({ doc, awareness }) } })`, joined through `createNetwork()` (60 lines, with `peer.offline()` / `peer.online()`). Tests dispatch with `simulateAction` and wait with `t.settle()`, then assert convergence: every client's state equals every client's document read. One trap: `simulateAction` returns `void`, and the first tests `await`ed it without waiting. A shipped version should offer `createNetwork` from `sygnal/yjs/testing` (or `renderComponent({ peers })`).

## 4. The spike

```
spike/
  lib/mapping.ts         JSON <-> Yjs: shape rules, 3-way idempotent write, read, reconcile, order keys (~220 lines)
  lib/sygnal-yjs.ts      makeYjsDriver (sink: { key, value } | { undo } | { redo } | { presence };
                         sources: remote(key), presence(), history(key)) and shared() (~180 lines)
  lib/memoryProvider.ts  in-memory network: relays updates/awareness, offline/online with state-vector sync
  app/Board.tsx          a collaborative todo column: plain reducers, shared board, presence, undo
  test/board.test.tsx    13 two/three-client scenarios (late join, concurrent add/edit/move/delete,
                         long offline merge, Y.Text vs LWW, presence, per-user undo, item identity,
                         same-id seeding, through the DOM)
  test/mapping.test.ts   order keys, the nested-type data loss and its fix, stale snapshots, idempotence, 1 move = 1 key
  test/fuzz.test.tsx     random sessions: 3 clients, 40 random actions, random offline (FUZZ_RUNS, default 20)
  test/websocket.test.tsx a real y-websocket server (@y/websocket-server) + WebsocketProvider over `ws`, with a disconnect
  test/measure.test.tsx  the numbers in §5 (MEASURE=1 writes ../measurements.json)
```

Run it (after the root `npm ci && npm run build`):

```bash
npm install --prefix dev-plans/research/crdt-state/spike
npm --prefix dev-plans/research/crdt-state/spike test            # 24 tests, ~4 s
FUZZ_RUNS=300 npx --prefix dev-plans/research/crdt-state/spike vitest run --root dev-plans/research/crdt-state/spike test/fuzz.test.tsx   # passed: 12,000 random actions, ~4.5 min
npm --prefix dev-plans/research/crdt-state/spike run measure
npm --prefix dev-plans/research/crdt-state/spike run typecheck  # lib + app, clean
```

All Node, no browser. Pinned versions: yjs 13.6.33, y-protocols 1.0.7, y-websocket 3.1.0, `@y/websocket-server` **0.1.1**. Versions 0.1.2 and later depend on the Yjs 14 prerelease and fail against yjs 13 with `store.getClock is not a function`. That version churn is an argument for loose peer ranges and for never bundling a provider.

## 5. Measurements (`measurements.json`, Node 22.22, one machine, medians)

Driver level: one local operation → the size of the Yjs update on the wire, and the time of the write (diff + transaction):

| op | 10 items | 100 items | 1000 items |
|---|---|---|---|
| toggle a boolean | 29 B, 0.04 ms | 29 B, 0.07 ms | 32 B, 0.26 ms |
| type one character (Y.Text) | 20 B, 0.05 ms | 20 B, 0.06 ms | 22 B, 0.27 ms |
| add an item (3 fields) | 120 B, 0.10 ms | 123 B, 0.11 ms | 155 B, 0.70 ms |
| move last to first | 52 B, 0.07 ms | 52 B, 0.08 ms | 55 B, 0.60 ms |
| remove | 14 B, 0.07 ms | 14 B, 0.07 ms | 15 B, 0.59 ms |
| rename the board (top-level string) | 37 B, 0.03 ms | 37 B, 0.02 ms | 40 B, 0.02 ms |
| remote change → next state (read + reconcile the slice) | 0.04 ms | 0.16 ms | 0.97 ms |
| the slice as JSON (what "send the whole state" would cost) | 549 B | 5,018 B | 52,634 B |
| encoded document after the 246 ops (history, tombstones) | 2.5 KB | 13.6 KB | 131 KB |

App level (100 items, 2,000 TOGGLE actions dispatched back to back, then one `settle()`): **0.017 ms/action plain vs 0.047 ms/action shared**, so about +0.03 ms per action. That includes the extra `board.LOCAL` action, the diff and one Yjs transaction per action (2,000 transactions: the STATE stream emits per action, not per flush).

Reading: bytes per op are 1–2 orders of magnitude below sending the slice and don't depend on its size. The cost grows with the slice because both write and read are O(n) over the collection: about 0.3–1 ms at 1000 items, fine for a board and too slow for 50k rows. The fixes are known and weren't needed for the spike:
- write: skip unchanged items by index identity before building maps;
- read: apply the `observeDeep` events to the previous value instead of re-reading;
- coalesce LOCAL per flush.

## 6. D209 and bytes

- **Core: 0 B.** The spike changes nothing in `src/`. It attaches through the existing `uses` merge loop (the core only calls `merge(component, key)`, D114) and the public `ABORT`. The size gate is unaffected by construction: the ~587 B headroom isn't touched.
- **The subpath:** the spike's driver + behavior + mapping is 3.2 KB gzip minified (Yjs and xstream external). It would be `sygnal/yjs` with `yjs` and `y-protocols` as **optional peerDependencies** (`peerDependenciesMeta.optional`), external in the CJS/ESM builds (`isExternal`) and not in the UMD build. Apps get Yjs updates and security fixes through npm and see it in `npm audit`. Apps that use it pay Yjs itself, ~21 KB gzip (Doc / Map / Text / UndoManager) or ~29.6 KB with awareness, plus their provider.
- **No provider in Sygnal:** the driver takes a `doc` and an `awareness`, and the app chooses y-websocket, Hocuspocus, Liveblocks or y-indexeddb. `createNetwork` (tests) is the only transport Sygnal would ship.
- **Loro / Automerge** would be sibling subpaths (`sygnal/loro`) behind the same driver contract (`remote(key)`, `presence()`, `history(key)`, sink commands). `mapping.ts` is the only Yjs-specific part.

## 7. Limitations of the spike

- The shape is inferred:
  - An empty array becomes a collection unless the field already holds a Y.Array.
  - An array with any item lacking `id` is a list. Switching kinds replaces the field.
  - Keys containing `.` or `#` would confuse the path names.
  - A field deleted on one side while another side adds into its root type leaves orphaned content.
- The text rebase is approximate for overlapping concurrent splices (it is exact when the doc already matches either side).
- Only top-level keys can be shared (`uses`), one doc map per key, and one UndoManager per slice.
- Nested structured values inside items are nested types: LWW at creation, the same race as §3.6, but per item.
- `board.LOCAL` doubles the action count in logs and devtools. A real version would hide it there, as built-in actions are, or skip the action entirely with a hook (§8 Q5).
- No auth or rooms: that's the provider's job. The README's examples use one room.

## 8. Open questions for the maintainer

1. **Schema or inference?** Inference (the spike) is zero-config but has the edge cases in §7. A declared shape avoids every ambiguity, enables type checks and lets `sygnal-check` see the shared paths. Example: `shared({ shape: { title: 'text', items: collection({ text: 'text' }) } })`, or a Standard Schema. *Suggestion:* infer by default, allow an optional `shape`, and warn (dev) when inference meets an ambiguous empty array.
2. **One behavior per key, or a component static `shared`** (B in §3.1) as sugar? The static would need a definition hook (core bytes) unless it is rewritten into `uses` by the subpath's import.
3. **Seeding:** `ifEmpty` (the spike), `never`, or `whenSynced` by default? `whenSynced` is the safe default for apps with a server, but it delays the first REMOTE until the provider has synced.
4. **Undo:** should `undo()` on a `shared()` key be a diagnostic (new SYG code) or automatically routed to the UndoManager?
5. **The LOCAL action:** acceptable as a visible built-in action, or worth a tiny hook (e.g. `onState` in the definition shim) so the slice reaches the driver without a second action? That hook would cost core bytes, so the spike says no.
6. **SYG127:** `sygnal-check --strict` reports `uses key 'board' is also a key of Board's initialState` as an error on the spike's Board. `shared()` deliberately keeps the host's value. Options: a behavior marker (`ownsState: false`) the checker reads from the factory, or a checker allow-list for `sygnal/yjs`'s `shared`.
7. **Second backend:** Loro (native MovableList / Tree, a better fit for kanban and outlines) or Automerge (JSON-shaped, history)? Both are wasm and large. Loro is the stronger data model.
8. **Server-authoritative sync** (Zero / Electric): a separate spike as a driver plus resources, or left to `$sync` + `sygnal/api` for now?

## 9. Rough plan if accepted

| Phase | Scope | Size |
|---|---|---|
| P0 | Decide Q1–Q6; replace `between()` with `fractional-indexing`; an optional `shape` | 2–3 days |
| P1 | `sygnal/yjs` subpath (driver + `shared()` + `sygnal/yjs/testing` `createNetwork`), optional peers, types in `src/yjs.d.ts`, the spike's tests moved to `test/`, the fuzz in CI at 20 runs | ~1 week |
| P2 | Incremental read (events), write skipping unchanged items, LOCAL coalesced per flush; hide `*.LOCAL` / `*.REMOTE` in devtools; SYG127 fix + an undo-on-shared diagnostic; docs page "Collaborative state" with a live demo over the in-memory network (no server needed) | ~1 week |
| P3 | Editor bindings through `defineWidget` (y-prosemirror / y-codemirror) with `SHARED.type(path)`; y-indexeddb recipe; a kanban example with two windows | ~1 week |
| P4 (optional) | `sygnal/loro` with MovableList / Tree behind the same driver contract | ~1 week |

## Sources

- Automerge 3.0 announcement: https://automerge.org/blog/automerge-3/
- Ink & Switch dispatch on the Automerge 3 beta: https://inkandswitch.com/newsletter/dispatch-011
- Loro 1.0 (movable list / tree): https://loro.dev/blog/v1.0, https://www.loro.dev/blog/movable-tree, https://loro.dev/docs/tutorial/composition
- Yjs vs Loro discussion: https://discuss.yjs.dev/t/yjs-vs-loro-new-crdt-lib/2567
- Replicache maintenance mode / Zero building on it: https://forums.basehub.com/rocicorp/mono/1, https://zero.rocicorp.dev
- Productlane's move from Replicache to Zero (April 2026): https://feedback.clerk.com/blog/zero-migration
- Versions from the npm registry on 2026-10-30: yjs 13.6.33 (beta 14.0.0-16), loro-crdt 1.17.1, @automerge/automerge 3.5.0, @liveblocks/yjs 3.24.5, valtio-yjs 0.7.0, @syncedstore/core 0.6.0 (last published 2023), fractional-indexing 4.0.0


---

## Maintainer decisions (2026-10-30)

Reviewed on the research decisions page. Unless a line says otherwise, the recommendation was approved as written.

- Q1 shape: infer by default, an optional `shape` option, and a dev warning when inference meets an ambiguous empty array.
- Q2: only `uses: { key: shared() }`. No component static.
- Q3 seeding: `whenSynced` by default, `ifEmpty` for local-only documents.
- Q4: `undo()` on a shared key is a dev diagnostic (new SYG code) pointing to the driver's per-user undo command. No automatic rerouting.
- Q5: keep the `*.LOCAL` action and hide `*.LOCAL` / `*.REMOTE` in devtools. No core hook.
- Q6 SYG127: a behavior marker (`ownsState: false`) that sygnal-check reads from the factory.
- Q7: Loro is the second backend, later (P4), not in the next preview.
- Q8: no server-authoritative spike now. Leave it to `$sync` + `sygnal/api`.

---

## Productized (P0–P2, branch `claude/build-yjs`)

`src/yjs.ts`, `src/yjs/` (`mapping.ts`, `driver.ts`, `shared.ts`, `testing.ts`), `src/yjs-testing.ts`; types `src/yjs.d.ts`, `src/yjs-testing.d.ts`; guide `guide/collaborative-state.md` with a live demo (two windows on an in-memory network). Following the decisions above:

- Q1: inferred, with `shape` (`'text' | 'list' | 'collection' | 'map' | 'value'`, `collection({ ...item fields })`, objects of fields); an empty array without a shape is reported once in dev (SYG261).
- Q2: `uses: { key: shared() }` only.
- Q3: `seed: 'whenSynced'` (default; the provider's `synced` / `whenSynced` / 'sync' / 'synced', or `synced: promise`); edits made before the sync are written onto the document's content. `'ifEmpty'` seeds at once.
- Q4: SYG260 (warn): `shared()` reports `undo()` on its key in dev; sygnal-check reports `undo({ key })` and `undoable(model, { key })` (`rules/syg260-shared-undo.js`).
- Q5: LOCAL / REMOTE handlers carry `Symbol.for('sygnal.builtIn')`; the dev action log (`checks/actionLog.ts`) calls them 'built-in', so DevTools hides them. No core change: the size gate is byte-identical (42,366 B).
- Q6: `shared()` returns `ownsState: false`; sygnal-check reads it from the first-party entry (`model/behaviors.js`, module `sygnal/yjs` only) and from a hand-written factory returning an object literal with it.

Changes from the spike found while productizing:
- `between()` → `fractional-indexing` (^4.0.0, a dependency; keys like `a0`, `a1`); keys that aren't valid ones (an older document) are rekeyed.
- A list of plain values compared its elements with the whole-array equality (a crash on `tags: ['a']`); fixed.
- The REMOTE action's driver sink acks the slice it committed, and LOCAL sends the committed slice. With the spike's single `emitted`, two remote transactions arriving before the app ran, then a local edit, could revert the newer remote value (`test/yjs-driver.test.js`, 'REMOTE').
- Root-level types that arrive in an update are placeholders until first read; Yjs then replaces them in `doc.share` under the same name. A name cache keyed on its size went stale when a client saw the document seeded before its own first value (the docs' second demo window stopped receiving changes). Found by driving the demo in Chromium; covered by a driver-level test.
- P2: incremental read (only the types a transaction changed are read again; collection items placed by binary search), writes skip unchanged items by identity and key only inserted items, LOCAL is coalesced per flush (2,000 back-to-back actions: 1 transaction).

Measurements (`MEASURE=1 npx vitest run test/yjs-measure.test.js`, Node 22, one machine, medians; local write ms / remote read ms):

| op | 10 items | 100 items | 1000 items |
|---|---|---|---|
| toggle | 29 B, 0.10 / 0.03 | 29 B, 0.09 / 0.01 | 32 B, 0.09 / 0.007 |
| type a character (Y.Text) | 20 B, 0.06 / 0.02 | 20 B, 0.09 / 0.02 | 22 B, 0.13 / 0.01 |
| add | 121 B, 0.15 / 0.05 | 122 B, 0.16 / 0.05 | 128 B, 0.12 / 0.01 |
| move last to first | 32 B, 0.19 / 0.03 | 32 B, 0.40 / 0.04 | 35 B, 0.72 / 0.02 |
| remove | 14 B, 0.16 / 0.03 | 14 B, 0.10 / 0.01 | 15 B, 0.34 / 0.02 |

The spike's remote read at 1000 items was 0.97 ms. `sygnal/yjs` is 5.6 KB min+gzip (Yjs and fractional-indexing external); `sygnal/yjs/testing` 0.6 KB.
