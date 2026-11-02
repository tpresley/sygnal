# Container edits for `compose.llm()`

2026-11-02. A follow-up from the `examples/ai-adaptive` stress test (its FINDINGS.md, "Found while
verifying the fixes"). Harness: `container-edits/run.mjs`. Results: `container-edits/results-*.json`
and `run*.log`.

## The problem

`compose.llm()`'s edit grammar (ops2: `add`, `remove`, `move`, `replace`, `setParams`, placed
`top` / `bottom` / `above|below k` / `left|right of k`) has no way to add a container or put a part
into one. The edit prompt still listed the catalog's containers, though.

In the intake lab, "Put the dates and amount in a Trip section, and the approver and contact in an
Approval section" made qwen3:8b loop: `{"op":"add","part":"dates","where":"top"},{"op":"add","part":"amount","where":"top"},…`.
Nothing stopped it:

- the request sent no `max_tokens`;
- `ops` had no `maxItems`;
- nothing timed out.

So the page sat in 'preview' for minutes.

## 1. Guards (shipped)

| Guard | Where | What it does |
|---|---|---|
| `maxItems` on every list | `llm.ts` `opsSchema` / `layoutSchema` | An edit's `ops`: `opsCap()` = one per node + `limits.maxParts`, at least 8. A slot: the container's `max`, else `maxParts`. The page: `maxParts`. Ollama's grammar enforces it. |
| Runaway stop | `llm.ts` `delta()` / `reply()`, `behavior.ts` DELTA | A streamed edit that repeats an operation exactly, or passes the cap, is stopped there. So is a composition with more than 2 × `maxParts` parts. `delta()` returns `{ reply, request: { abort } }`: the behavior handles `reply` as the step's reply (STATE, sink, DONE) and sends the abort. A reply that wasn't streamed is cut at the same point. `decisions.repairs` gets `{ kind: 'stopped' }`, and SYG687 (warn) is reported. |
| Output-token cap | the transports | A request's `maxTokens` goes as `max_tokens` (chatCompletions), `max_output_tokens` (openResponses) or `max_tokens` (anthropicMessages, already). There is no default for compose (see below). A reply cut there (`finishReason: 'length'`) is read as the JSON prefix it is. |
| Step timeout | `chat/driver.ts`, `llm.ts`, `decisions.ts` | The chat driver now has `timeoutMs`: past it, the run is aborted and `error` gets an Error named 'TimeoutError', as the fetch driver's `timeoutMs` already did. `compose.llm()` and `compose.decisions()` send `timeoutMs: 60000` by default (`0`: none). A timeout ends the step as status 'error', with the layout kept. |

Why compose sets no default `maxTokens`:

- With `maxItems` in the grammar, the reply's size is already bounded wherever the schema is
  enforced.
- Elsewhere, the runaway stop catches loops.
- Reasoning models count their reasoning in `max_output_tokens`, so a cap small enough to matter
  would cut legitimate replies.
- OpenAI's reasoning models reject `max_tokens` on Chat Completions. That transport sends
  `max_tokens`, the local servers' name; use `body: { max_completion_tokens }` there.

Shared with the decisions backend: only the timeout. A decision step can't loop, because the model
writes no text.

The live check shows the guards work. In the rejected 'page' variant below, the loop came back twice
(c1, c6). Both replies were stopped at the first repeat ("operation 9 repeats an earlier one"): 10.6 s
and 5.4 s instead of minutes.

## 2. Container edits (spike)

### Variants

- **false**: ops2 with the guards above (the baseline).
- **ops**: two new operations and a new place:
  - `{"op":"wrap","nodes":["n2","n3"],"part":"section","params":{"title":"Trip"}}` puts the nodes, in
    order, into a new container where the first one's block was. The container's `maxUses` holds,
    and the nodes keep their keys.
  - `{"op":"unwrap","node":"n1"}` removes a container; its parts take its place.
  - The place `into n1` (or `into n1:<slot>`) is the end of container n1.
  - `above` / `below` k now stay in k's container. Around a row they go outside it, as before.

  The schema offers `into` only for container nodes on the page, `wrap` per container part with its
  params (required ones required), and `unwrap` only for container nodes. Rows are not wrap targets;
  side by side stays `left of` / `right of`. All of this applies only when the catalog has a
  container other than a row, so row-only catalogs (the research sets) keep ops2 exactly.
- **page**: ops2, plus "reply with the whole new page instead of operations" when the change involves
  containers. The schema is one object with optional `ops` and `children`. A root `anyOf` made Ollama
  wrap replies in `{"value": …}`: every reply failed, so that schema was replaced.

The 'page' variant's code was removed after the measurements; `results-page.json` and `run-page.log`
record it.

The "fresh composition" alternative (answer such a change by composing the page from scratch) needs
someone to decide that a change needs containers. The 'page' variant gives the model that decision:
it never took it.

### Cases

All on qwen3:8b via Ollama's `/v1/chat/completions`, temperature 0, `reasoning_effort: 'none'`.
Each reply streams through `delta()` as in the app, then goes through `reply()`.

- **container**: 10 changes on the intake form's catalog (examples/ai-adaptive): group, move into,
  move out of, remove the sections but keep their fields, move between sections, add into, rename,
  unwrap.
- **plain**: 7 ordinary edits on the same catalog, some on a page with a section. These check for
  regressions.
- **research**: the 10 EDIT_CASES on the EXT catalog (llm/evals/cases.mjs). It has a `section`, so
  the 'ops' variant changes its prompt too.

What is measured:

- **exact**: the page shape and enum params match an accepted result. Text params are ignored, and
  section titles are checked on their own.
- **keys**: every leaf part present before and after keeps its node key.
- **latency**: wall time of the streamed request.

### Results

| Variant | container exact | plain exact | research exact | Keys kept | Median latency (container / plain / research) |
|---|---|---|---|---|---|
| false (ops2) | **2/10** | 7/7 | 9/10 | 27/27 | 958 / 756 / 1016 ms |
| **ops** | **9/10** | 7/7 | 9/10 | 27/27 | 1040 / 737 / 1019 ms |
| page | 2/10 | 7/7 | 9/10 | 24/27 | 1062 / 902 / 1314 ms |

The latencies come from the first, unloaded run (`run-spike1.log`, with the v1 prompt wording for
'ops'). The final run, `run.log` (final wording, `results-false.json` / `results-ops.json`),
overlapped a build: both variants were about 1.3 × slower and kept the same scores (false 2/10, ops
9/10).

Section titles were right in every exact 'ops' case. The misses:

- **false**: the model makes do without a container op. It moves the part next to the section
  (c2), drops the sections (c4: removes them with their fields), or invents a custom question named
  "Where and when" and adds unasked parts (c6).
- **page**: the model never answered with a page. It wrote ops2 as in 'false'. Twice it fell into the
  loop, and the guard stopped it.
- **ops**, c1 ("Trip section … and … Approval section"): both `wrap`s were right, then the model added
  two redundant `move n2 above n4` operations. n4 was by then inside the Approval section, so the
  dates and amount moved in with it. With the first prompt wording (v1, `results-ops-v1.json`), c1 was exact and c3 missed instead (the model `unwrap`ped the section to
  take one part out). The final wording says "unwrap removes the container" and "to take a part out
  of a container, move it to a place outside it". It fixes c3 and costs c1, at 9/10 either way.
- **ops**, edit-5 ("Put them side by side", research): the model wrapped the parts in the EXT
  `section`. ops2 also misses this case: it makes the row, but in the wrong order. A third wording that
  allows `wrap` with the row (`results-ops-v3-rowwrap.json`) fixed edit-5 but broke edit-7 ("Add the revenue KPI to the row": the
  model wrapped the row in a row). Rows stay out of `wrap`.

### Recommendation

**Ship 'ops'. It is now the default.** It takes container edits from 2/10 to 9/10, with no regression
on plain or research edits. Every key is kept, and latency doesn't change. The change is about 60
lines in `applyOps` and `opsSchema`, plus 4 prompt lines. `compose.llm({ containers: false })` turns
it off and gives the research's ops2 exactly; the research-exact tests use it.

Not done:

- `fake()` (`editOps`) still answers a target with a new container as a whole page. The reply reads
  that fine. Generating `wrap` there would let `composeWith` exercise the operation.
- `compose.decisions()` edits still can't group. That backend places parts into one container of each
  kind; see the kind-khayyam hand-over note.
- A guard against redundant moves after a `wrap` (the c1 miss) would need to know when a move is
  "already done". That is not obviously sound, so it is left out.
