# Composing a UI from prepared parts with a GenAI LLM (structured output)

The LLM backend for "compose a UI from prepared parts" in `sygnal/ai`: the same catalog declaration
and the same layout format as the decision-model path (nimble, Jev), with the model writing a
schema-constrained JSON reply instead of answering multiple-choice questions.

Primary model **qwen3:8b** on local Ollama 0.40.2 (`/api/chat` with `format: <JSON schema>`,
`think: false`, temperature 0). Also tried: llama3.1:8b and llama3.2:3b. `gpt-oss:latest` does not load
on this Ollama: `error loading model hyperparameters: key not found in model: gpt-oss.expert_feed_forward_length`.
The GPU was shared with four other workers the whole time. Latencies marked *contended* are 2 to 6x
the idle numbers, so compare output tokens instead. Temperature 0 is reproducible: two runs of base
`tree` / `tree+plan` hours apart gave the same 8/11 and 11/11.

## Files

| Path | What |
| --- | --- |
| `llm-composer.mjs` | Pure functions, no framework. Catalog → prompt (`catalogText`, `systemPrompt`) and schema (`layoutSchema`, encodings `tree`, `tree+plan`, `blocks`, `flat`, `select`). Reply → layout (`readReply`, `repairTree`, `treeToLayout`, `readLayout`). Edits: whole layout + `reconcileKeys`, or operations (`opsSchemaV2` / `opsSystemPromptV2` / `applyOpsV2`; v1 index-based ops kept for the record). Streaming: `parsePartialJSON`, `previewFromPartial`. Also `checkSchema` (a small JSON-schema check of the output as emitted) and `autoShots`. |
| `evals/run.mjs` | Ollama runner: `--set base\|ext\|edits\|a1-dashboard\|a1-ops\|a2-params\|a2-edits --models --enc --edit whole,ops,ops2 --shots 0\|1\|auto --mode schema\|json\|none --think`. Raw replies go to `evals/results/*.jsonl`. |
| `evals/cases.mjs` | Catalogs `BASE` (the example's 9 parts + `row`) and `EXT` (enum params, free-text params, a titled `section`). Cases: `BASE_CASES` (the example's 11), `EXT_CASES` (10: params and generated text), `EDIT_CASES` (10), and the shots. |
| `evals/a1.mjs`, `evals/a2.mjs` | Read-only adapters for the other workers' sets: a1 `dashboard` (15) and `ops` (15, 50 parts); a2 `PARAM_CASES` (20, catalogs OPS/SHOP) and `EDIT_CASES` (21; "Make it simpler" is left out because it is scored by a predicate). |
| `evals/stream.mjs` | Streaming preview timings. |
| `evals/tools.mjs`, `evals/tools-data.mjs`, `evals/rescore-tools.mjs` | Agent-in-chat path: layout as `ask_user` tool-call arguments. |
| `evals/rescore.mjs` | Re-reads recorded raw replies through the current repair code (no model calls). |
| `frontier/pack.json`, `evals/frontier-pack.mjs`, `evals/score-frontier.mjs` | Frontier-LLM reference pack (102 cases) and its scorer (§8). |
| `logs/*.md`, `logs/*.log` | Every table and every miss below. |

## 1. Recommendation

**Composition: the `tree` schema with a leading `asked_for` list (`tree+plan`), constrained by Ollama
`format` (or any strict structured-output API).** Zero-shot, it is 11/11, 15/15, 14/15, 10/10 and
20/20 on the five composition sets. When the app can write 2 or 3 examples for its catalog, plain
`tree` with those examples does as well (11/11, 15/15, 14/15) at about a third of the output tokens.

**Edits: operations whose positions are an enum of places (`ops2`).** Scores are 9/10 and 18/21. Keys
are kept by construction, and the reply is about 26 tokens. A whole new layout (`tree`, no plan) with
deterministic key reconciliation is close behind (9/10, 17/21).

### The schema (`tree+plan`)

The schema is generated from the catalog. Per depth there is an `anyOf` of one closed object per
part:

```js
{ type: 'object', required: ['asked_for', 'children'], additionalProperties: false,
  properties: {
    asked_for: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 8 },
    children:  { type: 'array', items: { $ref: '#/$defs/d1' } } },
  $defs: {
    d1: { anyOf: [                                   // depth 1: every part + the containers
      { type: 'object', properties: { part: { const: 'revenue' } }, required: ['part'], additionalProperties: false },
      { type: 'object', properties: { part: { const: 'revenueChart' },
          params: { type: 'object', properties: { range: { enum: ['month', 'quarter', 'year'] } },
                    required: ['range'], additionalProperties: false } },
        required: ['part', 'params'], additionalProperties: false },
      // free-text param: { type: 'string', maxLength: 40 } (not required)
      { type: 'object', properties: { part: { const: 'row' },
          children: { type: 'array', items: { $ref: '#/$defs/d2' }, maxItems: 4 } },
        required: ['part', 'children'], additionalProperties: false },
      ... ] },
    d2: { anyOf: [ /* the leaves only: maxDepth and `accepts: 'leaves'` are in the grammar */ ] } } }
```

### The system prompt (exact text, BASE catalog; `systemPrompt(catalog, 'tree+plan')`)

```
You compose a page of an app from parts the app has prepared. Each part already has its own data and wording; you only choose which parts the request asks for and arrange them.

Parts (id: what it shows):
- revenue: KPI card: this month's revenue total as one number ($48.2k, +12% on last month)
- signups: KPI card: new signups this week (312)
- churn: KPI card: customer churn rate this month (2.1%)
- revenueChart: Line chart: the revenue trend over the last 12 months
- orders: Table of the most recent orders (customer, amount, status)
- tickets: List of open support tickets, by priority
- tasks: Checklist of the user's tasks for today
- weather: Today's weather forecast for the office city
- feedback: Form to send product feedback (a message and a send button)

Containers (hold other parts):
- row: Row: shows its parts side by side, left to right (at least 2, at most 4; parts only, no containers)

Rules:
- Use only the parts the request asks for, by name or by what they show. Include every part it asks for. Do not add parts it does not ask for, even related ones.
- Use each part at most once.
- Order the parts top to bottom as the request says (first, at the top, above, then, below, under, at the bottom). When it does not say, keep the order in which the request mentions them.
- Use a container only when the request asks for it (a row only when it wants parts side by side, next to each other or in a row).
- Set a param only from what the request says; otherwise use its default.
- If nothing in the catalog fits the request, return an empty list.
- First write asked_for: each thing the request asks for, in its own words, one item per thing (an empty list when it asks for nothing the parts show). Then use exactly one part for each item, and no other parts.

Reply with JSON only, in this shape:
{"asked_for": ["<thing the request asks for>", ...], "children": [ {"part": "<id>", "params": {...}}, {"part": "<container id>", "children": [ ... ]} ]}   (top to bottom; a container's children in order)
```

The user message is the request, verbatim. Params appear under their part as
`param range: time span shown. one of month = the last 30 days; quarter = the last 3 months; year = the last 12 months (default year)`.
A free-text param appears as
`param search: words a ticket must contain, from the request (e.g. "safari"); empty for no filter; short text, at most 40 characters; "" when the request does not say`.

### The edit prompt (`ops2`)

The system prompt is the same catalog and rules with the plan line dropped, followed by:

```
The user message gives the current page (one node per line: key: part params; a row's parts are indented under it) and a change. Return only the operations that make the change, in order:
- {"op":"add","part":"<id>","params":{...},"where":"<place>"}
- {"op":"remove","node":"<key>"}
- {"op":"move","node":"<key>","where":"<place>"}
- {"op":"replace","node":"<key>","part":"<id>","params":{...}}   (the new part takes the old one's place)
- {"op":"setParams","node":"<key>","params":{"<param>":"<value>"}}
A place is "top" or "bottom" of the page, "above <key>" or "below <key>" (on the page), or "left of <key>" / "right of <key>" (side by side with that part, in a row).
Change only what the request asks; everything else stays as it is. A request that changes nothing gets no operations.

Reply with JSON only: {"ops": [ ... ]}
```

User message:

```
Current page:
n0: page
  n1: row
    n2: tasks
    n3: weather
  n4: feedback

Change: Move the feedback form to the top
```

In the schema, `node` is an enum of the current keys, `where` is an enum of every place that exists
(`top`, `bottom`, and `above|below|left of|right of <key>`), and `part` + `params` are per part, as
in the tree.

## 2. Results

### Composition, qwen3:8b (exact layouts; part errors = missing + extra parts)

| Set (cases) | tree | **tree+plan** | tree + app examples | tree + generated examples | blocks | flat | two-step (select, then blocks) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| base: the example's 11 | 8/11 (8 part err) | **11/11 (0)** | 11/11 (0) | 9/11 (1) | 7/11 (11) | 2/11; 7/11 with key-as-part repair | 7/11 (4) |
| a1 dashboard, 15 (two rows, nested order) | 13/15 (8) | **15/15 (0)** | 15/15 (0) | | | | 11/15 (4) |
| a1 ops console, 15, 50 parts | 10/15 (4) | **14/15 (1)** | 14/15 (0) | 13/15 (0) | | | |
| ext: enum params + generated text, 10 | 9/10, text 4/4 | **10/10, text 4/4** | | | | | |
| a2 params (OPS/SHOP), 20 | 19/20 (1 param err) | **20/20** | | | | | |
| median output tokens (base) | 34 | 53–63 | 16 | 16 | ~45 | ~60 | 2 calls |
| median latency (base) | 2.0 s | 3.4 s | 2.9 s (contended) | 1.1 s | 1.2 s (contended) | 1.8 s (contended) | 1.8 s (contended) |

Invalid outputs: **0 in every constrained run** (no unparseable reply, no unknown id, no bad enum).
What the repair had to fix in constrained output: a part used twice (blocks, flat, two-step), a row
of one part (blocks wraps single parts in `{row: [x]}`), and dangling, orphan or cyclic keys (flat).

Other models (base set):

| Model | tree | tree+plan | blocks |
| --- | --- | --- | --- |
| llama3.1:8b | 7/11 (7) | 7/11 (2) | 3/11 (16) |
| llama3.2:3b | 6/11 (4) | 6/11 (3) | 1/11 (40) |

Prompt and decoding variants on qwen3:8b, base set:

| Variant | Exact | Notes |
| --- | --- | --- |
| tree+plan, `format` = schema | 11/11 | 53–63 tokens |
| tree+plan, `format: 'json'` only | 11/11 | same answers; the constraint changed nothing on this small catalog |
| tree+plan, no `format` | 11/11 | same; it can matter on large catalogs and weak models (llama3.2 blocks: 2 invalid) |
| tree, `think: true` | 10/11 | ~280 tokens, ~50 s contended (15x) |
| tree+plan, `think: true` | 9/11 (one was a fetch failure) | thinking does not pay: use `think: false` |
| tree+plan + app examples | 10/11 | the examples' `asked_for` invited a "plate" → several parts miss |

### Edits (keys = every part kept from the previous layout keeps its node key)

| Encoding | edits, 10 | a2 edits, 21 | Keys | Median tokens |
| --- | --- | --- | --- | --- |
| tree+plan, whole layout | 7/10 | 14/21 | 10/10, 21/21 | 43–68 |
| tree+plan prompt, ops v1 (`index`) | 8/10 | 13/21 | all | 28–31 |
| tree, whole layout + `reconcileKeys` | 9/10 | 17/21 | all | 26–45 |
| ops v1 (`to` + `index`) | 9/10 | | all | 31 |
| **ops2 (`where` enum)** | **9/10** | **18/21** | **all** | **26–27** |

- The plan line hurts edits. "Each thing the request asks for" makes the model rebuild the page
  from the change alone. "Only the refunded orders" drops the weather, and so on (3 of 7 whole-layout
  misses).
- Index-based ops fail at counting ("move the tickets to the top" → index 1, "add … at the end" →
  index 2 of 4). A `where` enum of named places fixes most of it, the same lesson as a2's
  `batch + where` on Jev.
- Remaining ops2 misses: a spurious `setParams` (a `limit=25` nobody asked for; reviews → positive on
  "Show jackets instead"), "Add signups and churn" placed near revenue (the label wants them at the
  bottom; arguably the label is at fault), and "Put them side by side" (row order).
- Keys: with whole layouts, `reconcileKeys` gives every non-repeatable part its previous key, and a
  container the key of the previous container with the most shared children. The model never sees
  keys, and no test lost one. With ops, keys are kept by construction. A `replace` with the same part
  is read as `setParams`, so the key is kept: that was the only key loss in the first ops2 run (21/21
  after the fix, re-read from the recorded replies).

## 3. Schema encoding (question 1)

- **(b) The nested tree wins.** A closed `anyOf` per part (part `const` + its own params), unrolled
  per depth, puts `maxDepth`, `accepts` and `maxItems` into the grammar. Converting it to the node map
  is trivial (`treeToLayout`).
- **(a) A flat node map is poor** (2/11). qwen writes part ids where keys go (`"page": ["weather",
  "tasks"]`), invents keys it never defines, and reuses keys. Cross-references cannot be expressed in
  a JSON schema, so the grammar cannot help. The shared format stays the app-side format, and the
  model should not write it.
- **(c) Compact blocks** (`"id"` or `{"row": [...]}`) are worse than the tree on every model. With
  strings and objects mixed in one array, the model reaches for the object form and wraps lone parts
  or pairs in rows (`{"row": ["tickets", "orders"]}` for "tickets first, then orders"). Uniform
  objects with an explicit `part` are clearer to it.
- **(d) Two steps** (select an id list, then arrange only those) costs 2 calls and scores lower
  (7/11, 11/15). Selection is not the hard part for an LLM; the arrangement step re-reads the
  request without the original question.
- **What constrained decoding prevents**: unknown part ids, unknown params and values, unknown
  slots, too much depth, a container where it is not accepted, and too many children (the probe with
  "a stockTicker part" and `range: "quarter"` against an enum without it gave neither). **What it
  does not prevent**, so validate and repair always: duplicates (a part twice), runaway lists (the model
  keeps listing catalog parts until the array closes: "Churn and signups next to each other" → 8
  parts), a container under its minimum (a row of one), cross-references (flat), and wrong-but-valid
  choices. `repairTree` handles all the structural cases: unknown part (dropped, children lifted),
  duplicate (first kept), bad or missing enum (→ default), text trimmed to `maxLength`, unknown slot
  (→ default), too deep or not accepted (children lifted), under the minimum (unwrapped), empty
  container (dropped), children on a leaf (lifted), dangling, orphan or cyclic keys. Every fix is
  reported as an `issue`.
- **Part used twice**: the grammar cannot say "unique". Keep the first occurrence; parts that may
  repeat say so (`repeatable` / a1's `maxUses`).

## 4. Prompt (question 2)

- **Catalog presentation**: one line per part, `id: description`. Params indented under their part,
  each option with its meaning and the default (`one of month = the last 30 days; …; (default year)`).
  Containers listed separately, with their limits in words (`at least 2, at most 4; parts only`). The
  schema enforces the same limits; saying them in words keeps the model from fighting the grammar.
- **The rules that matter**: "use only the parts it asks for … not related ones" and "a row only when
  it wants parts side by side". Without the plan, qwen still lists extra parts for vague requests
  ("How are sales doing?" → all four revenue parts) and runs away on short ones.
- **The plan field (`asked_for`) is the biggest single gain**: base 8 → 11, a1 ops 10 → 14, a1
  dashboard 13 → 15. It anchors the count ("one part per item") and costs about 20–30 more output
  tokens. Put it first in the schema: written after `children`, it cannot help.
- **Few-shot**: 3 examples written for the catalog (two arrangements and one "nothing fits") give the
  same accuracy as the plan at a third of the tokens, because they teach the reply length. Examples
  generated from the descriptions (`autoShots`) are weaker (9/11, 13/15): they quote descriptions
  literally, and "What is on my plate today?" then matched nothing. Recommended: zero-shot
  `tree+plan` by default; `examples: [[prompt, layout]]` on the catalog when the app has them, and
  then drop the plan.
- **Thinking off** (`think: false`): thinking took 5–15x the time and scored no better.

## 5. Streaming (question 4)

`previewFromPartial(catalog, encoding, text, { previous })` parses the JSON prefix
(`parsePartialJSON`: closes open arrays and objects, drops an unfinished string, number or key). It
shows a leaf once its object closes, so its params are final and nothing flickers (year → quarter),
while a container still filling shows what it has (a row of one, unwrapped at the end). Passing
`previous` (the last preview) runs `reconcileKeys`, so parts keep their keys as the reply grows and
nothing remounts.

base set, qwen3:8b, streamed with the schema (contended GPU; medians):

| Encoding | First token | First part on screen | Final layout on screen | Done | First part / done | Regressions |
| --- | --- | --- | --- | --- | --- | --- |
| tree | 0.43 s | 3.1 s | 7.2 s | 7.5 s | 54% | 0 |
| tree+plan | 0.39 s | 9.2 s | 12.3 s | 13.4 s | 72% | 0 |

- **Progressive preview works.** Parts appear one by one in their final order, rows fill left to
  right, and no part ever disappeared or changed container (0 regressions in 22 streams). The final
  layout is on screen about 0.3–1 s before the reply ends (closing brackets, trailing whitespace).
- **The plan delays the first part**: `asked_for` streams first. A preview with the plan wants about
  70% of the time before anything shows. Few-shot `tree` (no plan) is the better streaming setup.
- Streaming also shows a runaway as it happens (the 8-part "churn and signups" reply grew for 10 s). A
  UI can cap the preview at a `maxParts` limit.

## 6. Generated props (question 5)

The LLM fills free-text params well. The ext set has 4 cases that need text: search "safari", search
"invoices" with `priority=high`, a section titled "Money", and a box titled "My day". The text was
4/4 with tree and 4/4 with tree+plan, and no other case got a spurious search or title. Declare them
on the part, next to the enum params, with a schema and a decision-model fallback:

```js
params: {
  priority: { label: 'which tickets', default: 'all', options: { all: 'every priority', high: 'high priority (urgent) only' } },
  search:   { type: 'text', label: 'words a ticket must contain, from the request', maxLength: 40, default: '' },
  // decision models: keep `default`, or ask an enum instead:
  title:    { type: 'text', label: 'the section heading', maxLength: 30, default: '',
              fallback: { options: { Overview: '…', Sales: '…', Support: '…' } } },
  options:  { type: 'list', label: 'the answer options', min: 2, max: 6, maxLength: 40 },   // see §7
}
```

- Schema: `{ type: 'string', maxLength }`, optional; `list` → `{ type: 'array', items: { type: 'string', maxLength }, minItems, maxItems }`.
- Repair: trim, cut to `maxLength`, dedupe lists, and an empty value → `default`.
- Decision-model backend: a text param without `fallback` keeps `default`; with `fallback.options`
  it becomes one more `choice()` question. The layout format is the same either way: free text sits
  in `params`, and the catalog says which kind it is.
- Text the model writes is untrusted, so render it as text. It is the one place an LLM "writes UI
  wording", and the declaration should make that opt-in per param.

## 7. Agent-in-a-chat: the layout as tool-call arguments (`evals/tools.mjs`)

An "interaction" catalog: `question` (question text + 2–6 option texts), `textInput` and `dateInput`
(repeatable, with a label), `confirm` (an action sentence), `cardChoice` (2–4 card titles from the
conversation) and `rating`. There are 12 short chat scenarios: 7 should call `ask_user` (missing
detail, irreversible delete, pick one of the names or flights already proposed, a reminder time,
feedback, a new address), 4 should not (facts, thanks, translation), and 1 either way (the tool result
already arrived). qwen3:8b, `/api/chat` with `tools`:

| Variant | Calls when it should | No call when it shouldn't | Args valid as emitted | Fit (right parts + content) |
| --- | --- | --- | --- | --- |
| tool `parameters` = the full tree schema | 6/7 | 4/4 | **0/6** | 5/7 after alias repair (0/7 before) |
| tool `parameters` = a simple schema (part enum, params object) | 4/7 | 4/4 | 0/4 | 3/7 after alias repair |
| **two steps**: tool `ask_user({ need })`, then a structured-output call composes the UI from `need` | 5/7 | 4/4 | **5/5** | 5/7 (5/5 of the calls) |
| structured output only, given the conversation (the call decision taken as given) | | | 7/7 | 4/7 |

- **Tool arguments are not constrained** on Ollama: the schema is rendered into the prompt as text.
  qwen wrote `{"type": "confirm", "params": …}` (the tree schema) or `{"parts": [...]}` with flat
  params (the simple schema). Both were invalid against the schema every time, but they are close
  enough for a lenient reader. `readReply` now accepts `type` / `component` / `name` for `part`, flat
  params, and the list under another key, and reports each as an `alias` issue. Validate tool
  arguments always. Use strict tool schemas where the API has them (OpenAI-style `strict: true`).
- **The call decision is the model's weak spot, not the UI.** The misses are qwen asking in plain
  text ("When would you like me to set the reminder?") instead of calling the tool. A smaller tool
  schema made it less eager (4–5/7 against 6/7). It never called the tool when it shouldn't.
- **Recommended for agents**: the two-step form. The agent's tool takes a sentence (`need`); the app
  then composes the UI with the same constrained structured-output request as everywhere else (same
  catalog, schema, repair and layout format). The second call is short (about 1–3 s). Where the
  provider enforces tool schemas, one step with the tree schema is fine. Content fit was good either
  way: the option and card texts came from the conversation ("Rise & Shine, The Daily Crumb, Butter
  Lane"; "ANA, nonstop, $1,240 …").
- The "fit" misses: a `question` with options for a free-text answer (the shipping address), and a
  `confirm` instead of asking the missing detail (structured output only).

## 8. Comparison on the shared cases

Example cases (base, 11 prompts). Decision-model rows are from `examples/ai-compose/README.md`.

| Backend | Exact | Wrong or missing parts | Structure errors | Invalid | Median per composition |
| --- | --- | --- | --- | --- | --- |
| nimble (decide(), 2 calls) | 9/11 | 0 | 2 | 0 | ~3 s |
| Jev (TypeSafe API) | 9/11 | 1 | | 0 | ~0.34 s |
| **qwen3:8b tree+plan** | **11/11** | 0 | 0 | 0 | 3.4 s (lightly shared) |
| qwen3:8b tree + 3 app examples | 11/11 | 0 | 0 | 0 | ~1–3 s (16 tokens) |
| qwen3:8b tree, zero-shot | 8/11 | 8 | 1 | 0 | 2.0 s |
| llama3.1:8b tree+plan | 7/11 | 2 | 2 | 0 | ~4 s (contended) |
| llama3.2:3b tree | 6/11 | 4 | 2 | 0 | ~3.5 s (contended) |

Other sets, qwen3:8b against a2's decision-model numbers (from `a2-params-edits/REPORT.md`):

| Set | qwen3:8b (recommended) | Jev | nimble |
| --- | --- | --- | --- |
| a2 params (20) | 20/20 (tree+plan); 19/20 (tree) | 54/60 = 90% (inline + not_stated, 3 runs) | 19/20 |
| a2 edits (21 of a2's 22: without "Make it simpler") | 18/21 = 86% (ops2) | 66/66 tuned, 88–92% held-out (batch + where) | in a2's report |
| a1 dashboard (15) / ops (15) | 15/15 / 14/15 | a1's REPORT.md was not there when this was written | |

The a1 and a2 sets were written for the decision-model encodings and never tuned on here. qwen's
layout misses are wrong-but-valid choices, never invalid output.

### Frontier reference

`frontier/pack.json` holds 102 cases (base 11, a1 dashboard 15, a1 ops 15, ext 10, a2 params 20,
edits 10, a2 edits 21) with the recommended encoding (`tree+plan`) and edits (`ops2`). It carries the
exact system prompt and schema per catalog (`catalogs[name]`). Compositions use `systemPrompt` and
`schema`; an ops2 edit carries its own (the enums name its keys). `userMessage` is exactly what the
model receives, including the previous page for an edit.

```bash
node evals/frontier-pack.mjs --enc tree+plan --edit ops2      # regenerate the pack
node evals/score-frontier.mjs <answers.json> [--label name]   # { answers: [{ id, output, ms? }] }
```

The scorer runs the same `readComposition` / `readOps` / `scoreCase` path and prints the same table
per set. `frontier/qwen3-8b-answers.json` is qwen's answers in that format: scoring it reproduces the
numbers above (11/11, 15/15, 14/15, 10/10, 20/20, 9/10, 18/21).

## 9. What one catalog declaration needs, to drive both backends

```js
const catalog = {
  root: 'page',                                  // the root container (never chosen)
  maxDepth: 2,                                   // page = 0; containers allowed above this depth
  parts: [
    { id: 'revenueChart', description: 'Line chart: the revenue trend',          // all either model sees
      params: { range: { label: 'time span shown', default: 'year',
                         options: { month: 'the last 30 days', quarter: 'the last 3 months', year: 'the last 12 months' } } } },
    { id: 'tickets', description: 'List of open support tickets',
      params: { search: { type: 'text', label: '…', maxLength: 40, default: '' } } },         // LLM only; fallback for decide()
    { id: 'row', description: 'Row: shows its parts side by side, left to right',
      container: { direction: 'row', slots: { default: { min: 2, max: 4, accepts: 'leaves' } } } },
    { id: 'tabs', description: 'Tabs', container: { slots: { overview: { description: '…' }, billing: { … } } } },
  ],
  examples: [['Show signups, then the weather', 'signups weather'], …],                     // optional: LLM few-shot
}
```

- **Shared and essential**: `id`, `description`, enum `params` (`label`, `default`, `options` with
  meanings), containers with named `slots` (`min`, `max`, `accepts`), `direction` (row vs column: the
  repair, ops2's "left of" and decision models' "side by side" gate all need it), and
  `repeatable` / `maxUses`. a1's `in`, `required`, `companions`, `resource` and `auto` all map onto
  the schema: `in` → per-slot `accepts`; `resource` → mutually exclusive ids (repair keeps one);
  `required` / `companions` → added by the repair, not asked of the model.
- **LLM-only, ignored or degraded by decide()**: `type: 'text' | 'list'` params (with `fallback`),
  `examples`.
- **Decision-only, ignored by the LLM**: question wording overrides (`ask`), candidate-limit
  prefilters, `records` beyond the enum size a grammar handles comfortably (the 50-part `anyOf` was
  fine here).
- **One layout format out**: the node map `{ root, nodes: { key: { part, params?, slots? } } }`. The
  LLM writes the tree and `treeToLayout` / `reconcileKeys` produce the map, so the app-side renderer
  and the edit path are the same for both backends.

## 10. What failed, in short

- The flat node map as the model's output: keys and references are beyond the grammar and beyond an 8B model.
- Blocks with mixed strings and objects: rows everywhere.
- Two-step select → arrange: slower and worse.
- Thinking: 5–15x slower, no gain.
- The plan field on edits: the page gets rebuilt from the change alone.
- Index positions in edit ops: models cannot count. Named places can be followed.
- Tool-call arguments as the layout on Ollama: never schema-valid (alias repair recovers most), and
  the call decision is shaky. Two steps (intent tool + structured output) is the robust form.
- Generated few-shot examples: weaker than the plan or app-written examples.
- `gpt-oss` on Ollama 0.40.2: does not load.
