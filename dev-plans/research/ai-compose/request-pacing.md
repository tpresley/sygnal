# Request pacing for pages that recompose themselves

2026-11-02. Prompted by `examples/ai-adaptive` (the board lab: `STATE.watch` on an attention
signature → `page.COMPOSE`), whose FINDINGS.md reports two things: aborted requests seemed to keep
the model busy (about 20 queued up during hot reloads and delayed the next composition by minutes),
and a fresh arrangement (15–20 s on `qwen3:8b`) is slower than the board changes.

**Outcome:** aborts are not the problem. Ollama stops generating as soon as the request is
aborted, streamed or not, and drops aborted requests still waiting in its queue. The problem is
starvation. With `latest: true`, each change aborts the composition in flight, so while the board
keeps changing faster than the model answers, no composition finishes. Fixed with a compose option,
`busy: 'queue'`: at most one composition in flight, and the newest `page.COMPOSE` waits for it.
The board lab uses it. A rules-first-then-model pipeline is worth first-class support, but it
needs its own design (below); it is not in this change.

Scripts: the session scratchpad's `pacing/` folder (`probe.mjs`, `burst.mjs`, `queued.mjs`) and a
temporary live board harness (not committed; its code is in "Live board run" below).

## Machine and load

- Apple M3 Max, 128 GB; Ollama 0.40.13 (the macOS app), `OLLAMA_NUM_PARALLEL=1`,
  `OLLAMA_MAX_QUEUE=512`; `qwen3:8b` Q4_K_M.
- The server was shared with two other sessions running their own benchmarks and test suites.
  The load average was 6–24 during the probes, and peaked at 71 during one test run. Absolute
  generation times are therefore noisy: the same 1,500-token request took 28–105 s. The
  conclusions rest on differences measured back-to-back, which the load doesn't affect at this
  scale (see the method).

## 1. Does the server stop when the fetch is aborted?

**Method** (`probe.mjs`): per endpoint and mode, back to back:
1. `base`: a short request B ("Say OK.", 8 tokens) alone.
2. `full`: a long request A (the integers 1 to 3000, up to 1,500 tokens), not aborted.
3. A again, aborted 1.5 s into it (streamed: 1.5 s after the first byte; not streamed: 1.5 s
   after sending, since no byte comes before the end).
4. B at once after the abort.

With `NUM_PARALLEL=1`, if the server kept generating A, B would wait for the rest of A: tens of
seconds. If it stopped, B ≈ `base`.

All requests: temperature 0, thinking off (`reasoning_effort: 'none'`, `reasoning: { effort:
'none' }`, `thinking: { type: 'disabled' }`, or `think: false`, per API).

| Endpoint (the transport that uses it) | A in full | B alone | B right after A is aborted | Kept generating? |
|---|---|---|---|---|
| `/v1/chat/completions`, streamed (`chatCompletions()`) | 28.5 s | 52 ms | 106 ms | no |
| `/v1/chat/completions`, streamed + `response_format` json_schema (compose.llm()'s request) | 52.3 s | 251 ms | 363 ms | no |
| `/v1/chat/completions`, not streamed | 56.4 s | 66 ms | 145 ms | no |
| `/v1/responses`, streamed (`openResponses()`) | 104.7 s | 105 ms | 533 ms | no |
| `/v1/messages`, streamed (`anthropicMessages()`) | 102.8 s | 344 ms | 199 ms | no |
| `/api/chat`, streamed (native) | 75.6 s | 153 ms | 210 ms | no |
| `/api/chat`, not streamed (native) | 54.2 s | 134 ms | 166 ms | no |

The variation in "A in full" is the shared load (above), not the endpoint.

**Aborted while queued** (`queued.mjs`): A1 runs to the end. A2–A6 are sent behind it (so they
queue, with `NUM_PARALLEL=1`) and aborted 500 ms later. Then B is sent.
- Streamed: B ended 84 ms after A1.
- Not streamed: B ended 105 ms after A1.

So the aborted requests were dropped from the queue, not run.

**A burst like the finding's** (`burst.mjs`): 20 requests 300 ms apart, each aborting the one
before it (what `latest: true` does), then the last one runs to the end. One such request alone
took 10.6 s (streamed) and 10.1 s (not streamed). The last of the burst took 10.3 s and 11.0 s
from when it was sent. So the 19 aborted requests cost nothing measurable.

**Sygnal's side.** Every transport in `src/extra/ai/transports/` (`chatCompletions`,
`openResponses`, `anthropicMessages`, `uiMessageStream`, `agui`) passes the run's `AbortSignal`
to `fetch` (`shared.ts` `post()`). The chat driver aborts a run:
- on `latest` (same sender and key);
- on `{ abort }`;
- when the sender is disposed (`makeReplies`' dispose hook);
- when the driver is disposed (app dispose, which an HMR swap does first: `src/extra/run.ts`
  `hmr()` → `exposed.dispose()` → the sources' `dispose`).

Hosted APIs (OpenAI, Anthropic) weren't measured here. All of Sygnal's transports stream, so an
abort closes the response stream; whether and when the provider stops generating is theirs to
document. `busy: 'queue'` limits requests in flight either way.

**So what were the ~20 queued requests in the finding?** Not reproduced. Every path above aborts
them, and Ollama honours the aborts. The likeliest explanation is the shared server: other
sessions were running their own compositions and benchmarks on the same Ollama during that
development. A cause on Sygnal's side remains possible, so I checked the HMR path above: it
disposes the driver, which aborts every run. A related HMR issue (below) can leave the page stuck
at "composing", but it doesn't leave requests running. The FINDINGS entry "Aborted requests still
cost the model's time" should be corrected. That file belongs to the coordinator, so I haven't
edited it.

## 2. The real cost: starvation under abort-and-resend

A page that recomposes on state changes sends a `page.COMPOSE` per change. With the default (each
one aborts the one in flight), a composition lands only if no change comes for as long as the model
takes. On the board, a tick is 3 s and an arrangement takes 15–20 s, so during an eventful stretch
of the morning nothing lands. The user sees "Arranging…" and the old board until the world calms
down.

### Live board run

The board lab with the real chat driver (`chatCompletions` → Ollama, `qwen3:8b`, thinking off).
The morning played at one tick per 3 s for 12 ticks, in model mode, then given up to 60 s to
settle. Counted:
- requests sent;
- arrangements landed (each one sets `page.decisions`);
- the time of each, from the start.

The load average was 82–153 during these runs (other sessions' suites), so each round trip took
14–20 s. The second of two counted runs. The first gave the same picture: 'abort' sent 10
requests and landed 1, at 54 s; 'queue' sent 3. Its counter, a poll on `page.decisions`, missed
the landings in 'queue', because a queued start clears `decisions` in the same action. The second
run times each response stream's end instead:

| | `busy: 'abort'` (default) | `busy: 'queue'` |
|---|---|---|
| Requests sent | 10 (at 0, 6, 12, 15, 18, 21, 27, 30, 33, 36 s) | 4 (at 0, 13.9, 32.0, 51.5 s) |
| Aborted | 9 (each by the next change) | 0 |
| Arrangements landed | **1**, at 50.2 s: 14 s after the morning's last change | **4**, at 13.9, 32.0, 51.5, 66.0 s |
| First arrangement on screen | 50.2 s | 13.9 s |

With 'abort', the board showed the 09:00 layout and "Arranging…" for the whole simulated morning.
With 'queue', it was re-arranged every round trip, each time from a state at most one round trip
old, and the requests sent fell from 10 to 4. The last one (66 s) ran because the morning changed
while the third was out. Each one starts from the newest state, so one at the end is all it takes.

Harness (`examples/ai-adaptive/src/zz-pacing-live.test.js` during the run, deleted after; a copy
is in the session scratchpad's `pacing/board-live.test.js`):
`renderComponent(variant(busy), { initialState: { ...START, arrange: 'model' }, drivers: { LLM:
makeChatDriver({ transport: chatCompletions({ baseURL: 'http://localhost:11434/v1', fetch:
logged, body: { temperature: 0, reasoning_effort: 'none' } }) }) } })`, `t.simulateAction('STEP')`
every 3 s, a 20 ms poll on `t.state.page.decisions`.

## 3. Options considered

| Option | What it fixes | Why not, or why |
|---|---|---|
| Documented recipe `STATE.watch(...).compose(debounce(ms))` | Collapses bursts (a slider, typing, the hot-reload burst) into one request | It doesn't fix starvation: a steady stream of changes spaced wider than `ms` still aborts each composition before it lands. It also delays the first composition by `ms`. It works today and is documented as the complement for bursts |
| compose-level `debounce` / `throttle` option | Same as the recipe | It duplicates xstream's operators in the behavior's options, and throttle drops the trailing (latest) change unless built as an audit. The intent is the right place for time-based shaping |
| Chat-driver concurrency per lane (`latest: 'queue'`) | One request in flight per lane | The driver doesn't know composition boundaries. A `compose.decisions()` composition is 1–2 requests, and the slice's `pending` belongs to the request in flight. A request the driver held back would be answered against the newer prompt's `pending` (the slice is written when COMPOSE runs, not when the driver sends). It would also need its own reply plumbing for "held" requests |
| **compose `busy: 'queue'`** ("at most one in flight, then the latest") | Starvation and bursts: a burst of N changes is 2 requests (the first one, then the last). A steady stream lands one arrangement per model round trip, each at most one round trip stale | Chosen. It lives where the composition boundary and the slice are known |

## 4. What shipped: `compose(catalog, { busy: 'queue' })`

`src/extra/ai/compose/behavior.ts`; types `ComposeOptions.busy` and `ComposeState.queued` in
`src/ai.d.ts`; the guide section "A page that recomposes itself" (`guide/ai-compose`); `llms/ai.md`;
sygnal-check knows the option and the slice key.

- `'abort'` (default): unchanged.
- `'queue'`: a `page.COMPOSE` while a composition is in flight is stored as `queued: { prompt,
  fresh? }`, resolved when it arrives (a form submit takes the prompt typed then). A newer one
  replaces it. No request is sent.
- When the one in flight ends, the waiting one starts in the same action, which sends one vnode and
  one request. The ending can be any of:
  - a layout: it lands first, status 'done', and `page.DONE` runs;
  - unavailable;
  - FAILED, or a reply the backend rejects. The error isn't shown, since the newer one supersedes
    it.
- `page.SET_LAYOUT` ends both the one in flight and the waiting one, as it already ended the one
  in flight. That makes the app's own layout win.
  - Consequence for apps: adjust a landed layout in a `page.DONE` entry's STATE, not through
    `SET_LAYOUT`. The board did `DONE → FIXED → SET_LAYOUT`, which would have dropped the
    arrangement that had just started.
  - The guide shows the STATE form, and the board uses it now.
- "In flight" means the step's request was sent by a live instance. The step is recorded with the
  signal of the instance that sent it (an EFFECT's `props.signal`, aborted on dispose). So a slice
  that comes back with `pending` has nothing in flight, and a COMPOSE starts at once. Without this,
  a kept `pending` would block the page forever. A slice comes back with `pending` after:
  - an HMR swap, which keeps the state while the old driver's runs are aborted;
  - a persisted slice.
- A queued start clears `decisions` (as any COMPOSE does), so a view showing the model's plan sees
  it only until the next arrangement starts. `page.DONE` has the layout. If a host wants the plan,
  it can copy it there.
- `composeWith` stops at a composition's end. A queued one that starts as it ends needs a
  `composeWith` of its own. Steps are mapped to their composition (`entry.of`) for this.
- Cost: 0 B in the core and the size gate (it is all in `sygnal/ai`'s compose behavior). In abort
  mode, no extra EFFECT entries are added.

Tests: `test/p9-compose-busy.test.js` (7). `examples/ai-adaptive` `board.test.js` has a new case: a
pin while the model arranges waits, the landed layout is held to the pin, and then the queued one
runs with both pins.

## 5. Rules first, then the model (not implemented: needs a design)

The board's model mode would be better if each change showed the rules' arrangement at once and
let the model refine it. Today that is two paths:
- the rules go through `page.SET_LAYOUT`, which skips the composition pipeline: no
  `page.DONE`, no status;
- the model goes through `page.COMPOSE`.

With `busy: 'queue'`, the two paths conflict: a rules `SET_LAYOUT` on each change ends the model's
composition in flight, so the model never lands either.

First-class support is worth it. The shape I'd propose:
- **A synchronous backend result.** `backend.start()` may return `{ layout }` with no request: done
  at once (status 'done', `page.DONE`). With that, `compose.local((state, prompt) => tree)` is a
  backend of a few lines, and rules and model share one pipeline when they are separate uses.
- **A draft for a model composition.** `compose(catalog, { backend: compose.llm(), draft: (state,
  prompt) => tree })`:
  - each COMPOSE shows the draft at once, as the layout;
  - the model composes from it: an edit of the draft, or fresh with the draft as the merge base;
  - a queued COMPOSE updates the draft but waits for the model.
  - This is what the board wants, and it keeps `queue` semantics intact.

Open questions for that design:
- Does the draft count as a `page.DONE`? Probably a separate `page.DRAFT`, so that `DONE` means
  the model's answer.
- Should the model be told the draft as "Current page" (an edit, cheaper: the FINDINGS measured
  edits at 3–6 s against 15–20 s fresh), or compose fresh?
- What status shows while the draft is up and the model works? Probably 'composing' with `layout`
  set.

## Follow-ups (not done here)

- **SET_LAYOUT / REMOVE leave the request running.** While a composition is in flight, they end it
  in the slice but don't abort its request. The model keeps generating a reply nobody reads (with
  `busy: 'queue'` too). The chat driver supports `{ abort: key }`, but the decisions backend's
  fetch has no abort message. A backend `abort(names)` → sink value hook would close this.
- **After an HMR swap, a kept `pending` shows 'composing' with nothing in flight.** In 'abort'
  mode, this lasts until the next COMPOSE. The behavior could notice it on its first action (as
  `queue` does now) or on the swap.
- **The rules-first design above.**
- **FINDINGS.md** (the coordinator's): the "aborted requests" entry should say they don't cost
  Ollama's time, and point at `busy: 'queue'` for the latency entry.
