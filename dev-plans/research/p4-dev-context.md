# P-4: live dev-server context for agents (GS-15). Design note

PLAN-4 §2 GS-15 asks for a decision record, not code. This note is the input to that decision. Default from the plan: defer past 6.0. Gap study G-15 rated it "Eval-gated · P3" with the same advice (hold until there is an eval task that needs a running app).

## 1. Problem

Today a terminal agent debugging a Sygnal app has two kinds of view:

- **Static:** `sygnal-check` (CLI, `--graph --json`, the MCP server's `check` / `graph` / `explain`). It sees source, not behaviour.
- **In-test runtime:** `renderComponent()` with `t.state`, `t.inspect()`, and since 2-C `t.actions` (`{ type, data, component, instance, sinks, cause, at }`) and `inspect({ actions })` (G-210; the schema now has `recentActions`). This covers anything the agent can reproduce in a test.

What it cannot see is the **app the user is actually running** in `vite` dev:

- the current state of each live component instance (`inspect()` gives `stateKeys`, not values; values exist only in the DevTools bridge, `src/extra/devtools.ts`, over `window.postMessage` to the extension);
- the recent actions that led there, with causes (in the page: `getDevTools()?.inspect({ actions: 50 })`);
- runtime diagnostics the page collected (SYG1xx/4xx/6xx in the browser console), as opposed to the static findings that the plugin already prints in the terminal;
- the live component graph with controls (CT-1) and behaviours (GS-1) as instantiated, including Collection counts and Switchable's current page.

The data exists in the browser (`installInspect()` publishes `inspect` on `globalThis.__SYGNAL_DEVTOOLS__`). The missing piece is a channel from the page to the agent's terminal. Next.js's devtools MCP, Svelte's and Angular's MCP servers fill that role in their ecosystems.

**Evidence from our evals (none of it favours building now):**

- **E8 (`e8-mcp`, PHASE3-RESULTS.md):** sygnal-check MCP configured, tasks 13/14/15, 15 trials, all passed. MCP was called 10 times in 9/15 trials, always `check`, never `graph` or `explain`. Task 14 debug time 0 → 0.8 s, wall 29.0 → 27.8 s; task 15 wall 40.5 → 40.4 s. Matched wall 47.1 → 95.2 s, which is one 774 s outlier (13-t2, the Switchable bug, not MCP time); 48.8 s without it. Verdict: dropped from agent docs. "`t.inspect()` was not exercised."
- **No eval agent has ever run a dev server.** Every trial is headless (`orchestrate.mjs`); grepping the transcript indexes in `results/transcripts/*.tsv` for `npm run dev` / `vite dev` finds 0 hits in all runs. Agents debug by writing and running tests, so a live endpoint would have nothing connected to it in the current harness. (The transcripts themselves are outside the repo; this is the index only.)
- **Where Sygnal debugging does cost time**, the cause was wiring that a static check or a skill line addresses: Haiku task 14 (`p3-v6-haiku` 2/5, `p3-v7-haiku` 3/15 across 14/24/25): `CHILD.select` of a grandchild, PARENT reaches the direct parent only (REPORT-v3, G-170 table). Task 25 Haiku: 226 s debugging per trial vs React's 14 s, from guard semantics. None of these needed live state; `t.actions` would show the missing action in a test just as well.

So the problem is real for human-plus-agent workflows (an agent asked "why does the board show X?" while the user has the app open), but our evals do not measure that workflow, and the measured debugging cost has cheaper fixes.

## 2. Design (if built)

Three thin parts over existing pieces. Everything is dev-only and lives in `sygnal/vite`, the dev client (`virtual:sygnal/dev`), `sygnal/diagnostics` and `sygnal-check`.

### 2.1 Endpoint `GET /__sygnal/inspect` (Vite dev server)

- **Pull over HMR.** `configureServer` adds a middleware. On a request it broadcasts `sygnal:inspect:request` `{ id, actions, state }` on `server.ws` (the same channel the dev checker already uses for `sygnal:check`). The dev client answers with `import.meta.hot.send('sygnal:inspect:response', { id, snapshot })`. The server waits up to 1.5 s, then answers the HTTP request.
- **Snapshot** (one per connected page, keyed by page URL and a client id):
  - `graph`: `inspect({ actions: N })` (default N = 50, max 500): components with `controls`, behaviours (namespaced actions), Collection/Switchable children, selectors, per-component diagnostics, `recentActions` with `cause`;
  - `state`: new opt-in `inspect({ state: true })` returning `currentState` per instance id, each value passed through the size cap and redaction below;
  - `diagnostics`: the page's collected runtime diagnostics (`getDiagnostics()`), last 100;
  - `meta`: `{ url, title, sygnalVersion, at, truncated: [...] }`.
- **No page connected:** 503 `{ error: 'no page connected', last }`, where `last` is the most recent snapshot with its age (kept in memory, one per client, dropped on disconnect after 60 s).
- **Query:** `?component=TaskCard&actions=100&state=0` narrows the graph (`inspect({ ids })` already filters).

### 2.2 MCP tool `sygnal_live_inspect` (sygnal-check MCP server)

- Input: `{ url?: string (default http://localhost:5173), component?: string, actions?: number, state?: boolean }`.
- Fetches the endpoint (Node 18+ `fetch`, no new dependency) and returns the JSON, or a clear error: "no dev server at …", "no page open: open the app in a browser".
- `callTool` in `sygnal-check/src/mcp.js` is synchronous today; this needs the `tools/call` path made async (small).
- Description written for E8's lesson: say when to use it ("the user reports something in the running app; read live state and the actions that led to it") rather than listing fields.

### 2.3 CLI fallback `sygnal-check live`

- `npx --no-install sygnal-check live [--url …] [--component X] [--actions N] [--no-state]` prints the same JSON (or a short text summary without `--json`). It is a convenience over `curl -s localhost:5173/__sygnal/inspect`, which also works.

### 2.4 Security and bounds

- **Dev only:** registered in `configureServer` only (never `vite build`, `vite preview` or Vitest); the response lives in the dev client, which production never imports. `sygnal({ live: false })` turns it off.
- **Loopback only:** reject requests whose remote address is not loopback, even with `vite --host`, unless `live: { allowRemote: true }`. Check the `Host` header against Vite's `server.allowedHosts` (DNS rebinding). No CORS headers, so other origins in the browser can't read it.
- **No large values:** a state value whose JSON is over 2 KB becomes `{ $truncated: bytes, keys: [...] }`; the whole response is capped at 256 KB (oldest actions dropped first, then state). Action `data` keeps the existing 1,000-character cap in `jsonData()`.
- **Redaction:** keys matching `/password|passwd|secret|token|authorization|cookie|apikey|api_key/i` are replaced by `"[redacted]"` by default, in the browser before sending. `live: { redact: (path, value) => value | undefined }` is a server-side hook for more (`undefined` drops the field).
- **Read-only:** no time travel or action dispatch through this channel (the DevTools extension already has that, behind its own UI).

## 3. Cost estimate

| Part | Files | Lines (src + tests) |
|---|---|---|
| Endpoint, pending-request map, snapshot cache, loopback/host check, redact hook | `src/vite/plugin.ts` | ≈ 90 + 120 tests (fake server/ws, as the dev-checker tests do) |
| Dev client responder, redaction, size caps | `src/vite/plugin.ts` (`devClientModule`) | ≈ 40 |
| `inspect({ state })`, bounded; schema entry | `checks/inspect.ts`, `public.d.ts`, `sygnal-check/schema/inspect.schema.json` | ≈ 35 + 40 tests |
| MCP tool + async `tools/call` | `sygnal-check/src/mcp.js` | ≈ 50 + 60 tests (`*.vtest.js`) |
| CLI `live` | `sygnal-check/bin/sygnal-check.js`, new `src/live.js` | ≈ 45 + 30 tests |
| Browser test: real Vite dev server + page + `fetch` | `browser-tests/` | ≈ 60 |
| Docs (`integration/vite` section, `agents` page), skill/llms.txt pointer | docs, skill | ≈ 40 docs; 1 skill line; 0–1 llms.txt line |

Total ≈ 260 source lines and ≈ 310 test lines across about 8 files; about 2–3 subagent days with review.

- **Production: 0 B.** Nothing touches the core bundle or the size gate.
- **Dev:** `virtual:sygnal/dev` grows by ≈ 1.2 KB unminified (≈ 0.5 KB gzip); `sygnal/diagnostics` by ≈ 0.4 KB for the `state` option. sygnal-check gains no dependency.
- **Maintenance:** the snapshot format is the inspect schema (already versioned, `version: 1`), so it drifts only when `inspect()` does. The risk is Vite's HMR API: `server.ws` is still supported on Vite 7/8 but the environment API moves toward `server.environments.client.hot`; the dev checker carries the same risk, so a fix covers both. Vike and Astro dev wrappers need one test each that the client module is loaded there. A new MCP tool is a permanent agent-facing surface: renames break user configs.

## 4. Eval design that could justify it

The current harness cannot test this; it first needs a **live-app mode**: the orchestrator starts `vite` in the starter, opens the app in headless Chromium (the `browser-tests/` Playwright setup), and drives a short scripted repro of the reported bug before the agent starts. The prompt says "the app is running at http://localhost:5173 with the bug reproduced". Harness cost: ≈ 120 lines in `orchestrate.mjs`/`prepare.mjs`, plus a `repro.mjs` per task.

- **Tasks (runtime state matters):** 14 fix-support-inbox (silent PARENT/CHILD no-op), 15 fix-reading-list (wrong book changes; lost debounced saves), 12 selection-panel (selection across projects, panel stays in sync), plus one new task `30-live-state-bug` whose bug shows only after a specific click sequence and has no static finding (so `check` can't shortcut it). 13 stays out until the Switchable stale-page issue is settled.
- **Arms** (all with the live-app mode, so the running app is the same):
  - A: control (current skill);
  - B: a one-line skill pointer to the in-test tools only ("for a silent no-op, log `t.actions` and `t.inspect()` in a test"), 0 build cost;
  - C: B plus the endpoint, MCP tool configured, and a one-line pointer ("the running app: `sygnal_live_inspect` / `sygnal-check live`").
- **Models and size:** Opus 5.5 and Haiku 4.5, 4 tasks × 5 trials × 3 arms = 60 trials per model, 120 total.
- **Metrics:** pass rate (hidden tests), matched wall, debug time and iterations (transcript-stats), failed test runs, tool calls (did C use the tool, how deep: state/actions vs graph only), peak context and learn time.
- **Spend (PLAN-3 rates):** Opus debugging tasks ran $0.24–0.31 per trial in e8/p3-control, Haiku ≈ $0.33 per trial (`p3-v6-haiku`, $42.47/130), plus ≈ 10% for the longer prompt and dev-server warm-up: Opus 60 × ≈ $0.32 ≈ $19, Haiku 60 × ≈ $0.36 ≈ $22. **Total ≈ $41**, plus a ≈ $3 smoke run of task 30. Outside PLAN-4 §7's $180, so the user approves it separately.
- **Bar to adopt** (C must beat both A and B, since B is free):
  - C uses the live tool in ≥ 60% of its trials, beyond graph-only calls;
  - Opus matched debug time −20% or more vs B (p < 0.1), wall not worse; or Haiku pass rate +3 trials of 20 vs B;
  - no pass-rate drop on any task; learn time ≤ +1 s.

  If B alone gets the gain, ship the skill line and drop the tool. If neither moves, keep G-15 closed.

## 5. Recommendation

**Defer past 6.0.** Reasons: E8's MCP tools were used shallowly with no debug-time gain; no eval agent has ever started a dev server; the measured Sygnal debugging costs (Haiku 14, 24, 25) come from wiring and semantics that static checks and skill lines already target; and 2-C's `t.actions` / `inspect({ actions })` now give agents the same live data inside tests at 0 B. Nothing in 6.0 depends on it, and its cost is all in dev tooling, so it can be added in a 6.x minor without breaking anything.

Options for the user:

1. **Defer** (recommended): record GS-15 as deferred; keep this note. Optionally add arm B's one skill line now (it costs nothing) and measure it in 4-E.
2. **Build behind a flag for an eval:** `sygnal({ live: true })`, undocumented, plus the live-app harness mode; run §4 (≈ $44) after PLAN-4's evals; adopt or remove by the bar. About 3 subagent days of build plus harness work.
3. **Build now:** ship §2 in 6.0 (≈ 570 lines with tests, 0 B production) without eval evidence, as an ecosystem-parity feature for humans who pair with an agent while the app is open. Not recommended without the eval, given E8.
