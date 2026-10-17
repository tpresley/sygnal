# S-3: live mode (`--graph=html --watch`, the `sygnal/vite` route, the LSP graph)

PLAN-10 S-3 (D502), design only. Feeds W-1, W-2, E-1 (and P-2).

**Answer:** a live page is cheap. A rebuild after a one-file edit takes **15 ms** on plan5-showcase
and **41 ms** on ai-showcase with the existing parse cache, and the prototype pushes a new graph
to the browser **~80 ms after a save** over SSE. Five findings shape the design:

- `fs.watch({ recursive: true })` is not available on Linux under Node 18, which the `engines` field
  still allows. A per-directory fallback measured the same latency.
- The LSP has no file watcher of its own: it uses the client's `didChangeWatchedFiles`. What to
  reuse from it is its incremental core (`core.js` `prepare`: the parse cache plus "last good" text
  for files that don't parse), not a watcher.
- Static ids contain line numbers, so **the page can't keep the selection by `id`**. The prototype
  lost the selection when two lines were added above a component. The page needs its own stable
  key.
- The token sits in the URL, and the page has `https://` docs links. Browsers' default referrer
  policy sends only the origin across origins, but the token mustn't depend on a default: the
  server sends `Referrer-Policy: no-referrer`.
- `sygnal/vite` already serves a guarded dev route (`/__sygnal/mcp`, with `refusal()`), runs
  sygnal-check on changes, and has a page bridge to the app tabs that can fetch `inspect()`. So
  W-2 is a thin route, and the same bridge is P-2's runtime source.

## Files

| File | What it is |
|---|---|
| `live/rebuild-timing.mjs` | rebuild time with and without the parse cache after a one-file edit (through `sources`), with phases |
| `live/rebuild-all-examples.mjs` | the same on every example's `src/` scanned together (124 components) |
| `live/serve.mjs` | throwaway W-1 prototype: watcher (recursive / `--per-dir` / `--poll`), debounce, `ParseCache` rebuild, `node:http` + SSE on 127.0.0.1 with a random port and token, Host check, CSP, Ctrl-C shutdown; the page keeps zoom and selection across a reload |
| `live/latency.mjs` | drives `serve.mjs` on a copy of a project: auth checks, then save → SSE latency for in-place and atomic (rename) saves, and a no-op save |

## Measurements

Node 24.14, macOS (APFS, FSEvents), median of 7 runs. "Edit" means one file's text changed through
the `sources` overlay, so exactly one file is parsed again.

| Project | Files | Components | Graph JSON | Fresh CLI `--graph --json` | Build, no cache (warm JIT) | Rebuild, nothing changed | **Rebuild after one edit** |
|---|---|---|---|---|---|---|---|
| kanban | 5 | 3 | 4 KB | – | 4.7 ms | 2.6 ms | **3.3 ms** |
| plan5-showcase | 50 | 43 | 33 KB | 142 ms | 22.2 ms | 14.7 ms | **14.5 ms** |
| ai-showcase | 54 | 31 | 51 KB | 188 ms | 60.0 ms | 42.3 ms | **41.1 ms** |
| all examples together | 183 parsed | 124 | 124 KB | – | 252 ms (first, cold JIT) | – | **76.6 ms** |

Phases of an edited rebuild (warm cache):

| Project | expand inputs | `buildProject` (1 parse + model) | rules | `buildGraph` | `JSON.stringify` |
|---|---|---|---|---|---|
| plan5-showcase | 0.3 ms | 4.7 ms | 6.1 ms | 0.7 ms | 0.1 ms |
| ai-showcase | 0.5 ms | 16.2 ms | 19.6 ms | 0.7 ms | 0.2 ms |

- The parse cache saves only the parsing (about a third). The model and the rules are rebuilt for
  every file, and the rules are about half of a rebuild. A per-file model cache would be the next
  step, but it isn't needed at these sizes. S-1's 500- and 2,000-component corpora should be timed
  with `rebuild-timing.mjs` before W-1 is built.
- A watcher in one process saves the 140–190 ms of Node start, import and cold JIT that each CLI
  run pays.

Save → SSE event at the client (`latency.mjs`, plan5-showcase copy, 50 ms debounce, 5 of each):

| Watcher | In-place write | Atomic save (write temp, rename) |
|---|---|---|
| `fs.watch` recursive (FSEvents) | **78 ms** | **78 ms** |
| one `fs.watch` per directory (11 dirs) | 78 ms | 79 ms |
| `fs.watchFile` polling, 200 ms | 248 ms | 252 ms |

So the debounce dominates: event delivery is about 10 ms, the rebuild about 15 ms and the SSE
write under 1 ms. An atomic save fires 2 events, merged into one rebuild by the debounce. A save
that doesn't change the text rebuilds (it takes the cache hit), gets the same JSON, and **sends
nothing**. Auth checks: page 200; no token, wrong token or a foreign `Host` 403; another path 404.

## W-1 design: `sygnal-check --graph=html --watch`

**Command line.** `sygnal-check --graph=html --watch [paths] [--port <n>] [--no-open]`, plus the usual
`--strict`, `--a11y`, config and `ignore`. It prints the URL and opens it once (D500 rules: never
under `CI` or without a TTY). Loopback only: there is no `--host` (invariant). `--out` together with
`--watch` is an error, since a `file://` page can't receive updates.

**One live project module.** Factor `prepare()` out of `lsp/core.js` into
`sygnal-check/src/live.js` (name open):

```js
createLiveProject({ root, settings }) → {
  build(sources?) → { graph, json, hash, version, changed, files, substituted },
  watchSet() → { dirs, files },          // inputs + files loaded outside them + config files
}
```

- It keeps one `ParseCache` per root, the "last good" substitution (a file that doesn't parse keeps
  its last good text, with a `SYG900` for the new one, as the LSP does today), `resolveOptions`
  from the root, and `buildGraph(project, diagnostics)`.
- `--watch`, the LSP (E-1) and `sygnal/vite` (W-2, through the package's exports) all use it, so
  the three agree on what "the graph now" is.
- Last good matters more here than in the editor: with auto-save, a half-typed file would otherwise
  make its components disappear and come back on every keystroke. The page shows a banner like
  "`Gauge.jsx` doesn't parse; showing its last good version".

**Watching** (`engines: node >= 18`):

- `fs.watch(dir, { recursive: true })` on each input directory. It works on macOS and Windows on
  every supported Node, and on Linux from Node 19.1 / 20. On Node 18 on Linux it throws
  `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`.
- The fallback: catch that error and use one non-recursive `fs.watch` per directory. Skip
  `IGNORED_DIRS` and dot directories (`roots.js` `inIgnoredDir`), and add new directories on
  `'rename'`. That is about 40 lines, and it measured the same latency (11 watchers on
  plan5-showcase).
- `--poll [ms]` for file systems without events (network mounts, some container bind mounts):
  `fs.watchFile` per source file plus a periodic rescan for new files. It measured 250 ms at a
  200 ms interval.
- Files the project loaded from outside the inputs (`project.files`), and the root's
  `sygnal-check.config.json` / `package.json`, each get a single-file watcher. The watch set is
  re-synced after each build. A config change rebuilds with the options resolved again.
- Filter: source extensions and the two config names; never `node_modules` or dot directories.
- **Not** chokidar (D209: no new runtime dependency), and no bump of the `engines` field just for
  this. Node 18 and 20 are past end of life, but the fallback is small. Whether to raise `engines`
  is a separate decision.

**Debounce and scheduling.** Use a trailing debounce of 50 ms. It merges atomic saves, formatter
runs and `git checkout` bursts; the LSP uses 150 ms for typing, but here every event is a save.
Add a 1 s maximum wait, so a continuous stream of writes still updates. While a build runs, new
events only mark the project dirty, and the newest state is built next. The queue is never stale
(the LSP's rule). Builds run on the main thread: at 15–80 ms there is no case for a worker, unless
S-1's large corpora say otherwise.

**Server** (`node:http`, no dependency):

- Listen on `127.0.0.1`, port `0` (random) or `--port`. The token is 18 random bytes, base64url, in
  the URL query (`?t=`), compared with `crypto.timingSafeEqual`.
- Any `Host` other than `127.0.0.1:<port>` or `localhost:<port>` gets 403. This defends against DNS
  rebinding, on top of the token.
- `GET /?t=` is the page. It is the same self-contained file `--graph=html` writes (the invariant
  holds: it still works when saved), with `META.live = { events: '/events' }` added.
- `GET /events?t=` is the SSE stream. It starts with `retry: 1000`, then the current graph as
  `event: graph`, with `id: <version>`, so a reconnect with `Last-Event-ID` skips a graph it
  already has. A `: ping` comment every 25 s keeps it open.
- Every other path gets 404. The server is read-only, serves no files, and has no POST.
- Headers: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer` (the token is in the URL and the page links to the docs; the
  default policy already strips the query across origins, but that stays a browser default), and `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline';
  style-src 'unsafe-inline'; connect-src 'self'; img-src data: blob:`. A nonce would replace
  `unsafe-inline` once V-1 knows its script count.
- Each update sends the **whole graph** (4–124 KB here). Patches aren't worth their complexity:
  `JSON.parse` of the 124 KB graph takes 0.35 ms in Node. The server sends only when the JSON hash changed.

**The page on a new graph** (V-1 has to expose this as `page.update(graph)`, the same entry point
the E-2 webview and the P-1 devtools tab call):

1. **A stable key per component.** The `id` (`file:line`) changes whenever lines are added above a
   definition: the prototype's selection was lost exactly this way. Use `file + '#' + name`, plus
   an ordinal for the rare duplicates in one file. Selection, pinned positions, expanded sections and
   the "changed" marks are keyed by it. (Optional for A-3: emit this key in the graph as `key`, so
   all hosts agree. Proposed in the report, not decided.)
2. **Rebuild the model** (pure, `model.js`). Diff old against new by key: added, removed, changed
   (the component JSON compared with ids and lines left out), and the changed edges.
3. **Positions.** If an island's render edges are unchanged, keep every card where it is and redraw
   only the content: the common case, an edit inside a component. Otherwise lay out that island
   again and animate its cards from the old to the new positions in 300 ms (instant under
   `prefers-reduced-motion`). Other islands and clusters keep their places; a cluster only grows
   or shrinks in place. S-1 item 10 measures how far cards move.
4. **Keep** the zoom and pan transform, the selection (by key; if the selected component is gone,
   select nothing and say so in a toast), the search query and matches, the trace, the overlay
   toggles and the detail panel's scroll position.
5. **Mark the change** for a few seconds: a green ring on added cards, an amber dot on changed ones,
   removed cards fading out as ghosts for 2 s, and the health list counts moving with a short
   highlight. "Changes only" (V-6) can reuse the same diff later.
6. **Connection state** in the header: "live · updated 3 s ago"; "reconnecting…" on an
   `EventSource` error; "disconnected: showing the last graph" once the server is gone (the page
   keeps working as a static page).

**Shutdown.** On SIGINT or SIGTERM: stop the debounce timer, close the watchers, end the SSE
responses (the page shows "disconnected"), `server.close()`, then exit 0, with a 500 ms hard exit
in case a socket hangs. Closing the browser tab doesn't stop the server. With no client connected
the process keeps watching, so a reopened tab is current at once.

## E-1: what the LSP needs from the same machinery

- `core.js` already has the project for each root from `prepare()`. Add `graph` next to `check`.
  `buildGraph(project, diagnostics)` costs 0.7 ms on top of a check, and it reuses the check's own
  diagnostics. With `live.js`, the check and the graph come from one build.
- **Request** `sygnal/graph`, with params `{ uri }` (the root of that document) or `{ root }`.
  The result is the root's `InspectGraph` from the last check, plus `version`, or `null` when the
  root has no components.
- **Notification** `sygnal/graphChanged`, `{ root, version }`, after a check whose graph hash
  changed. The client then pulls. The notification stays small, and a client without a panel open
  ignores it.
- Build the graph only for roots a client has asked about once (lazily), so editors without the
  panel pay nothing. The worker posts it as another `part` of the check (the index and completion
  index already go that way). A 50 KB structured clone is about a millisecond.
- E-2 (the VS Code panel) calls `page.update(graph)` through `postMessage`, the same entry point as
  SSE.

## W-2: `/__sygnal/graph` in `sygnal/vite`

**Feasibility: good, and small.**

- `configureServer` already adds `/__sygnal/mcp` as a middleware with `refusal()`. It checks for a
  loopback remote address, a local `Host` (or `server.allowedHosts`) and a local `Origin`. A
  `/__sygnal/graph` route and `/__sygnal/graph/events` (SSE) can sit next to it with the same guard.
  A token isn't needed: the guard already limits the route to local callers, as for MCP.
- `startChecker` already loads sygnal-check, rebuilds on Vite's watcher events (100 ms debounce) and
  computes the findings for the overlay. Replace its `mod.check()` with one `graph()` build: the
  graph carries the same diagnostics, with `file` and `line`. One build then feeds the overlay, the
  console and the page. Pass a `ParseCache` (it passes none today).
- Use feature detection (`mod.graphHtml`, `mod.createLiveProject`) so an older sygnal-check keeps
  today's behaviour.
- The page comes from sygnal-check (`graphHtml(graph, meta)` from V-1), not from sygnal, so sygnal
  ships no page code. The page and the checker always have the same version, and the
  "0 bytes in apps" invariant holds trivially (dev server only).
- Estimate: 150–250 lines in `plugin.ts` (the route, SSE fan-out, a log line with the URL, and a
  `graph: false` option), plus tests next to the MCP endpoint's.

**What it adds:**

- The live page with no second process and no token, printed next to Vite's URLs.
- **P-2's runtime half for free.** The MCP page bridge (`attachMcp`: app tabs say hello over the HMR
  channel, and the server requests `component_tree`, which is `inspect()`) already fetches runtime
  graphs from the open app tab. The graph route can ask the same bridge and send both graphs, so the
  page fades unmounted components and shows action counts on static cards. Today the bridge exists
  only with `mcp: true`. P-2 would need its client part loaded whenever the graph route is on; it is
  dev only, so 0 bytes in builds.
- The open problem for P-2 is the **join key**: runtime instances have names, not files, and names
  repeat. S-2 recommends a dev-only definition stamp from the plugin's transform, in the static
  `id` format.

**Costs:** one more route to secure (the guard exists and is reused), page traffic on the dev
server's port, and a sygnal minor for the plugin option (D513).

**Recommendation:**

- Do W-2, in Phase 3 as planned, after W-1. W-1 builds `live.js` and the page's `update()`, and
  W-2 is then routing.
- Make the route on by default in dev when sygnal-check is installed (`graph: false` turns it off),
  and print its URL.
- Make P-2 depend on the definition stamp (S-2 open question 2). Without it, the overlay can only
  match by name, and it shows ambiguous names as ambiguous.

## Not recommended

- chokidar or any other watcher dependency (D209), and raising `engines` just for recursive watch.
- WebSockets for the page. SSE is one-way, needs no dependency or upgrade handling, and
  `EventSource` reconnects by itself.
- Sending diffs instead of whole graphs (sizes above).
- Rewriting the `--out` file on change. A `file://` page can't be told to reload, and the server
  route covers the case.
- Serving on anything but loopback (invariant), even behind a flag.

## Open questions (for the coordinator / user)

1. Emit a stable component `key` (`file#name`) in the graph (A-3), or let each host derive it?
   Recommendation: emit it, since three hosts need the same key.
2. Raise sygnal-check's `engines` to `>=20` (Node 18 and 20 are both past end of life by
   2026-10)? It would remove the Linux fallback. Recommendation: a separate decision. W-1 doesn't
   need it.
3. W-2 on by default in dev when sygnal-check is installed? Recommendation: yes (with
   `graph: false`), as the dev checks are today.
