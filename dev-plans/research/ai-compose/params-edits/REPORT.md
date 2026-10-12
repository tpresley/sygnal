# Params, parts from records, and edits: encodings for a decision model

Worker A2, 2026-10-11. Scope: **parameters** on parts, **parts generated from app records**, and
**edits / follow-ups** on an existing layout, for "compose a UI from prepared parts" with a decision
model (choice / noul / score only, no free text). Builds on the flat composer in
`examples/ai-compose` (select call + pairwise order call); the tree encoding is A1's.

Files (all in this folder):

| File | What |
| --- | --- |
| `params-edits.mjs` | pure, framework-neutral builders/readers: `selectQuestions`, `slotQuestions`, `recordQuestions`, `readSelection`, `paramQuestions`, `readParams`, `configureQuestions`, `orderQuestions`/`readOrder`, `editQuestions`, `readEdit`, `editWhereQuestions`, `applyEdit`, `narrowRecords` (the record prefilter), `LIMITS` + `chunkedChoice`/`readChunked` (backend candidate limits), and the measured losing variants (`editPlaceQuestionsPairwise`/`applyEditPairwise`, per-record strategies). All wording is in the exported `W` table; the defaults are the recommended encodings. |
| `evals/catalogs.mjs` | 3 catalogs as plain data: ops dashboard (9 parts), e-commerce (8), project management (9 parts; 40 or 200 projects, 30 reports, 25 people) |
| `evals/cases.mjs` | labelled cases: 20 params, 20 records (x 40 and x 200 projects), 22 edits (tuned on) + 16 held-out edits (never tuned on) |
| `evals/cases.json` | the same cases as plain data (`node evals/export-cases.mjs`): `{ note, catalogs, params[], records[], edits[{ catalog, set, previousLayout, prompt, expected, accept? }] }`; expected edit layouts carry the previous layout's keys. For scoring the LLM path on the same cases. |
| `evals/run.mjs` | runner: `node --env-file=$HOME/.config/typesafe/env evals/run.mjs <params\|records\|edits\|all> [strategy,...]`; `MODEL=nimble` for Ollama, `REPEAT=n`, `SCALES=40,200`, `EDITS=tuned\|heldout`, `VERBOSE=1`. Prints exact-match, key errors, calls, input tokens and median latency per strategy, and every miss. |
| `evals/baseline-edit.mjs` | json-render's sequential edit flow (one `next` op per call; move/replace take a second call) adapted to this layout, as the baseline |
| `evals/probe-*.mjs` | the variant probes quoted below; `evals/unit.mjs`: no-model checks of the pure functions |
| `results/*.txt` | raw run output: `jev-params`, `jev-records` (exploration), `jev-records-final`, `jev-records-chunk26`, `jev-records-prefilter`, `jev-edits` (exploration), `jev-edits-moveslots` (final), `nimble-params`, `nimble-records`, `nimble-edits-v1` (per-node move nouls), `nimble-edits-v2` (final), `nimble-probe-edit` |

Numbers are Jev (`jev-latest`, served as `jev-1.13.0`) unless marked nimble. Jev is **not fully
deterministic**: an identical request occasionally flips a borderline answer, so Jev runs are
repeated (n = cases x repeats). Latency is per composition/edit (the sum of its calls), median.
Tokens are the API's `usage.input_tokens`.

---

## 1. Parameters

### Recommended encoding

A part declares enum params; the model only picks among the app's values.

```js
{ id: 'orders', description: 'Table of recent orders (customer, amount, status)',
  params: {
    status: { label: 'order status', default: 'all',
              options: { all: 'every order, any status', paid: 'paid orders only', pending: 'pending (unpaid) orders only', refunded: 'refunded orders only' } },
    limit:  { label: 'number of rows', default: '10',
              ask: 'How long a list does user_request ask for, by a number or by words like few, short, long, full or all?',
              options: { 5: 'short: up to 5 rows (a few, a handful, top 3, top 5)', 10: 'medium: about 10 rows', 25: 'long: 25 rows (a long list, a full list, all of them, 20+)' } } } }
```

**Ask the params inline, in the select call** (one choice per param of every part; read only for the
parts that were chosen), with an explicit **`not_stated` option** that maps to the default:

- instruction: `Consider this element: <part.description>. <ask ?? "Which <label> does user_request ask for it?"> Choose not_stated when user_request does not mention a <label>.`
- criteria: `{ not_stated: 'user_request does not mention a <label>', ...options }`
- read: `not_stated` -> default; a value equal to the default is left out of `params`.

| Strategy (20 cases x 3) | Exact layout | Calls / case | Input tokens / case | Median |
| --- | --- | --- | --- | --- |
| **inline + not_stated** | **54/60 (90%)** | **1.35** | 2,152 | **180 ms** |
| separate configure call (chosen parts only) + not_stated | 53/60 | 2.33 | 1,888 | 344 ms |
| separate, no not_stated, default below p 0.6 | 51/60 | 2.35 | 1,840 | 358 ms |
| inline, no not_stated, default below p 0.6 | 51/60 | 1.35 | 1,961 | 180 ms |
| nimble: inline + not_stated (1 run) | 19/20 | 1.35 | see §4 | 25 s (contended GPU) |

(Calls include the example's pairwise order call when 2+ parts are chosen.)

- **Inline vs. a separate configure call**: same accuracy; inline saves a round trip (~165 ms on
  Jev, one more 3 s+ call on nimble). The configure call sent ~12% fewer tokens here; it only pays
  off with many params on rarely chosen parts (e.g. switch above ~40 param questions).
- **"Not stated" as an option beats a probability threshold.** Without `not_stated` Jev answers
  confidently (p ~ 1.0) for unrequested values ("The revenue chart" -> `range=year`, "Pending
  orders" -> `limit=25`), so no threshold separates stated from unstated: the probabilities are too
  peaked to serve as a "was it said?" signal.
- Remaining misses: a spurious `tasks` on "Revenue, signups and the revenue chart" (3/3, p(use)=0.7;
  a selection error, not a param one) and "the **full list** of top customers" -> limit stays at the
  default (3/3; p(25)=0.39 vs p(not_stated)=0.61). nimble's one miss: "Our most expensive products"
  -> also `category=bags`.

### Numeric params -> enums

Counts (`limit`) failed until the question **names the vague vocabulary** and each option says
**which words map to it** (`evals/probe-limit.mjs`):

| Prompt | plain ("Which number of rows…", options "about 5 rows…") | `ask` + worded bins (above) |
| --- | --- | --- |
| A long list of all recent orders | not_stated (0.52), wrong | 25 (1.0) |
| A few orders | not_stated (0.8), wrong | 5 (0.99) |
| Show me 20 orders | 25 | 25 |
| Just the latest 3 orders | 5 | 5 |

So a numeric param is an enum of **bins** whose descriptions carry both the number range and the
words ("few", "top 3", "long", "all"); the app maps a bin to its number. A `score` question is not
needed and has no "not stated" level, which is what matters most for params.

### Keeping descriptions coherent

- The **part description must not name a param value** ("revenue over the last 12 months" on a part
  with a `range` param). The param supplies it: `describeNode()` shows a node back to the model as
  `<description>; <label>: <option description>` for its current values (edits, ordering).
- **Option descriptions of different params of one part must not overlap.** Held-out miss: "Show all
  tickets, not just the urgent ones" -> `status=all` ("all tickets, open and closed") instead of
  `priority=any`. A catalog wording problem, not an encoding one.
- `ask` per param is the escape hatch for params whose label reads badly in the template.

## 2. Parts from records

The app turns records (projects, saved reports, team members) into parts at run time: one part
declaration with a `records` source, one node per chosen record
(`{ part: 'project', params: { project: 'atlas' } }`).

### Recommended encoding

1. **Two kinds of record request, two kinds of part.** Requests by **name** ("Atlas and Borealis",
   "Jun's card") select records. Requests by **attribute or rank** ("blocked projects", "projects
   Maya owns", "my three most recent reports", "the designers") go to **a list part with enum filter
   params** (`projectList(status=blocked)`, `projectList(owner=maya)`, `reportList(limit=3)`,
   `team(role=designer)`), whose options may come from app data (<= 255). Per-record questions
   cannot rank or count, and a filter part scales to any number of records.
2. **Group the alternatives** (`group: 'projects'` on `project` and `projectList`): one `choice`
   `{ omit, project: <family>, projectList: <list description> }` instead of independent omit/use
   questions. The largest single gain: independently, the card *and* the list (and the roster with
   the member card) were picked for most requests.
3. **Slots for the records**: K choices `rec_<part>__1..K`, each over `none` + the records (<= 254):
   `<part.description>. Which <label> does user_request name first|second|…? Choose none when
   user_request names fewer than N <label>s from this list.` Read in order until `none`, dedupe.
   Unlike "Position N" questions for layout (which collapsed), **extracting the k-th named record
   works**: it is a lookup, not a judgement, and confusable names ("Atlas" vs "Atlas 2") resolve
   because each choice is exclusive.
4. **Prefilter the records by name in app code** (`narrowRecords(catalog, prompt)`): keep the records
   every word of whose `name` (or one of its `aliases`, e.g. a first name) appears in the prompt; drop
   a record part with no match for this prompt. Then slots go **in the select call (one call)** over
   the few survivors, and because the group choice already said "these cards", slot 1 takes the best
   record even when `none` wins (`atLeastOne`; only safe after the prefilter, see below).
5. Without a prefilter (names the prompt paraphrases, e.g. "the billing one"): gate the slots.
   The group's family option lists the record **names** (`…; one per project that user_request names
   (the projects: Atlas, Borealis, …)`) and the slots go in a second call for chosen record parts only.

Final runs (`results/jev-records-final.txt`, 20 cases x 2, Jev):

| Recommended forms | 40 projects | 200 projects | Calls | Tokens / case (40 / 200) | Median (40 / 200) |
| --- | --- | --- | --- | --- | --- |
| **prefilter + groups + slots, one call** | 35/40 | 36/40 | **1** | **2,742 / 2,742** | **176 / 187 ms** |
| same, Ollama's 26-candidate limit (`MAX_OPTIONS=26`) | 34/40 | 35/40 | 1 | 2,819 / 2,819 | 179 / 164 ms |
| prefilter + groups + gated slots | 36/40 | 35/40 | 1.65 | 2,920 / 2,920 | 337 / 351 ms |
| groups + gated slots (names in the gate), no prefilter | 36/40 | 37/40 | 1.73 | 5,760 / 15,333 | 349 / 409 ms |
| groups + 4 slots in the select call, no prefilter | 36/40 | 37/40 | 1 | 13,470 / 32,214 | 225 / 344 ms |

In every recommended form **all remaining errors are part selection, not record identification**:
"Every project Maya Chen owns" also adds Maya's member card (2/2), "What's the status of Iris, Jade
and Lotus?" adds the team roster, "Show Maya's workload" sometimes adds the calendar. Every named
record was found and no wrong record was added.

The exploration, first round (`results/jev-records.txt`, 20 cases x 2; the first rows ran before
`group` existed and with independent omit/use questions for the list parts):

| Strategy | 40 projects | 200 projects | Calls | Tokens / case (40 / 200) | Median (40 / 200) |
| --- | --- | --- | --- | --- | --- |
| one omit/use choice per record (each record a candidate) | 15/40 | 8/40 | 1 | 14,192 / 34,605 | 235 / 405 ms |
| one noul per record | 13/40 | 10/40 | 1 | 6,977 / 14,750 | 199 / 267 ms |
| family + one choice over records, records with p >= 0.2 | 14/40 | 13/40 | 1 | 5,635 / 10,888 | 176 / 217 ms |
| family gate, then per-record noul | 15/40 | 13/40 | 1.85 | 4,913 / 9,944 | 344 / 398 ms |
| family gate, then per-record choice | 20/40 | 11/40 | 1.85 | 7,548 / 19,531 | 364 / 488 ms |
| family gate, then slots | 28/40 | 28/40 | 1.85 | 6,958 / 17,607 | 351 / 413 ms |
| slots in the select call | 25/40 | 27/40 | 1 | 13,016 / 31,004 | 210 / 343 ms |
| groups + family gate + per-record choice | 30/40 | 17/40 | 1.7 | 6,226 / 16,418 | 443 / 355 ms |
| groups + gate (no names) + slots | 35/40 | 34/40 | 1.75 | 6,627 / 14,827 | 356 / 349 ms |
| groups + 2 slots in the select call | 31/40 | 32/40 | 1 | 8,156 / 17,906 | 191 / 235 ms |
| groups + slots, records split into chunks of 25 (26-candidate limit), no prefilter | 33/40 | 22/40 | 1 | 14,131 / 34,675 | 239 / 512 ms |

Errors of the per-record encodings: every near name pulled in ("Atlas" -> Atlas 2…5 at 200),
unrelated records (10–40 spurious cards for "Lena's card and the calendar"), and the 2nd/3rd named
record lost when one choice is read by probability (peaked: p(atlas)=1.0, p(borealis)=0 for "Atlas
and Borealis"). Chunking records for a small candidate limit fails: each chunk's slot picks its own
look-alike ("Atlas 2" in the chunk without "Atlas") instead of `none`.

**Notes.**
- **Candidate limits differ by backend**: Jev takes 255 per choice, Ollama's `/v1/systemone` 2–26
  (`HTTP 400 … criteria must contain 2–26 candidates`, found when nimble rejected a 27-option owner
  param). `LIMITS.maxOptions` in `params-edits.mjs` splits any larger choice into chunks that repeat
  the head option (`not_stated`/`keep`/`none`) and takes the most probable non-head answer; that is
  fine for params and `where`, but records should be prefiltered instead (above).
- `atLeastOne` without the prefilter hurts: "Show me the Phoenix project" (no such project) then gets
  Atlas (2/2). With the prefilter there is no project part for that prompt at all.
- The prefilter is lexical: it handles names, first names (`aliases`) and confusable variants (exact
  words: "Atlas" does not match "Atlas 2"), not paraphrases. Use the gated form when users refer to
  records by description. Requests by attribute never need it (list parts).
- Without the prefilter, the names in the gate cost ~600 tokens at 200 records and fixed "How is
  Cedar doing?" (a bare name the model cannot otherwise know is a project).
- `K` is a per-part declaration (`maxRecords`, default 4); 2 slots lost the 3- and 4-record cases.

## 3. Edits and follow-ups

### Recommended encoding: two calls at most

**Call 1** (always; `state: { user_request, current_page: [describeNode(node) for each node in order] }`):

| Question | Per | Form |
| --- | --- | --- |
| `remove_<key>` | node | noul: `Does user_request ask to take this element off the page (remove, delete, hide or drop it, or swap it for a different element)? The element: <d>. Changing its settings (time range, filter, category, sort, number of rows) keeps it on the page. Answer no for elements user_request does not mention.` |
| `moved_1`, `moved_2` | page | choice over the nodes + `none` (slots, like records): `Which element on the current page does user_request ask to move to another place (to the top, the bottom, above, below or next to another element)? Answer the first such element; an element named only as the reference point (the X in "next to X" or "below X") is not moved. Choose none when user_request asks to move fewer than 1 element.` (slot 2: "…other than the ones already named? Answer the second…") |
| `change` | page | gate noul, built from the labels of the params on the page: `Does user_request ask to change a setting of an element already on the page (such as its time range, order status, number of rows)?`; `set_` answers are read only when it is on |
| `set_<key>__<param>` | param of a node | choice: `This element is on the current page: <d>. Does user_request ask to change its <label>? Choose keep unless user_request asks for a different <label>.` over `{ keep: 'keep the current <label>: <current option>', ...the other options }` |
| `add_<part>` / `add_g_<group>` | absent part / group | the select question (`This element is not on the current page. Does user_request ask to add it or show it, by name or by what it shows? Answer omit when user_request does not ask for it.`), its params inline (§1), and for record parts 2 slots over the prompt-named records not on the page (`narrowRecords`), worded `Which <label> does user_request ask to add to the page first|second? Choose none when user_request asks to add fewer than N…` |
| `swap` | page | noul: `Does user_request ask to replace or swap one element for a different element (instead of, in place of, swap X for Y)?` |
| `placed` | page | noul: `Does user_request say where an element on the current page should go (at the top, at the bottom, first, last, above, below, next to another element)?` |
| `simpler`, `simpler_<key>` | page, node | gate: `Does user_request ask to make the page simpler, shorter, cleaner or less busy, without naming what to remove?`; per node: `To make the page simpler, would you remove it as secondary to the page's main purpose? Keep the most important elements.` (read only when the gate is on; never empties the page) |

**Call 2** (only when something is added, moved or placed; ~55% of these edits): one choice per moved
or added node, `where_<key>`: `This element is being moved|added to the page: <d>. Where does
user_request want it?` over `not_stated` (added: "does not say where" -> bottom; moved: "does not ask
to move it after all" -> stays; replacement: "takes the place of <old>"), `top`, `bottom`, and
`above:<k>`, `below:<k>`, `beside:<k>` for every other node.

**Deterministic rules** (`readEdit` / `applyEdit`):
- **Keys**: every node that stays keeps its key; a **param change keeps the key** (the component
  keeps its state and gets new params); added and replacement nodes get fresh keys (max + 1, never
  reused). A row keeps its key while it has 2+ members; a row of one is unwrapped.
- A node whose params change is **never removed** ("Show jackets instead" also reads as a swap) —
  which is why the `change` gate matters: on nimble a removed chart also got `set_range=week` (0.89).
- **Replace** = swap gate + exactly one removed + one added: the new node takes the old one's place
  (and row) unless its `where` says otherwise ("drop the tickets and add a feedback form at the top").
- **Reference points stay**: a moved node that another moved node is placed relative to is not moved
  ("put the orders next to the revenue" flags both). `beside:<k>` joins k's row or makes a new row
  at k's place: no row questions needed.
- `placed` on but no node flagged as moved -> every node gets a `where` (whose `not_stated` keeps it
  in place). This caught "Show the previous sprint's burndown at the top" (move noul 0.23).
- Stationary nodes keep their relative order and rows; movers are inserted one at a time.

| Edit encoding | Tuned (22 x 3) | Held-out (16 x 3) | Key errors | Calls / edit | Tokens / edit (tuned / held-out) | Median |
| --- | --- | --- | --- | --- | --- | --- |
| **batch + where + change gate + move slots (recommended)** | **66/66** | **43/48 (90%)** | 0 | 1.56–1.59 | 3,474 / 3,580 | 323–324 ms |
| batch + where, a move noul per node, no change gate | **66/66** | **42/48 (88%)**; 44/48 in two other runs | 0 | 1.56–1.59 | 3,252 / 3,390 | 315–317 ms |
| batch + where, before the add prefilter | 66/66 | 44/48 | 0 | 1.56–1.59 | 3,245 / 4,408 | 316–331 ms |
| batch + where, no `placed` gate | 66/66 | 40/48 | 0 | 1.50–1.59 | 3,001 / 4,182 | 308–320 ms |
| batch + where, no `simpler` questions | 62/66 | 43/48 | 0 | 1.56–1.59 | 2,995 / 4,172 | 315–330 ms |
| batch + pairwise "which comes higher" for movers | 50/66 | 40/48 | 0 | 1.56–1.59 | 3,163 / 4,297 | 315 ms |
| sequential (json-render style) | 44/66 | 37/48 | 1 | 2.96–3.05 | 4,673 / 4,247 | 464–497 ms |
| nimble: recommended (1 run) | 18/22 | 10/16 | 0 | 1.56–1.59 | see §4 | contended GPU |

The tuned set chose the wording (history below); the held-out set was written afterwards and never
tuned on, so **88–92% is the honest number**. Held-out misses, all of them across runs: "Get rid of
the weather and put the revenue chart first" also adds the revenue KPI card (2–3/3; `add_`
precision), and "Show all tickets, not just the urgent ones" (1–3/3; overlapping option wording, §1).
Record edits ("Add the Cedar project", "Remove Atlas", "Swap Borealis for Juniper") are 3/3. One
lesson there: with a single prefiltered candidate the plain slot wording ("names") answered `none`
(p 0.55) for "Add the Cedar project", because the request also names records already on the page;
the add-specific wording plus `atLeastOne` fixed it.

Multi-op prompts ("Drop the tickets and add a feedback form at the top", "Show the chart for this
week and move my tasks to the top", "Sort the products by price … and add low stock alerts below
them", "Only pending orders, and remove the revenue card") cost no extra calls: call 1 answers every
node and part independently.

**The sequential baseline**, fairly: my adaptation flattens rows and has no record adds, so 4 tuned
and 3 held-out cases are out of its reach by construction. On the cases it can express it scores
44/54 tuned and 37/39 held-out: as accurate as the batch form on simple single-op edits, but with
~3 calls each offering every operation (50–90 options), ~1.5x the latency, and it failed "Show last
quarter instead" (chose `add:churn`, 3/3) and "Make it simpler" (set a limit, 3/3). Its strength is
that each step sees the edits already made; the batch form's is one call for any number of
independent ops, with each remove or param change a yes/no on that node rather than one option in 80.

### What failed, in the order tried

| Tried | What happened | Now |
| --- | --- | --- |
| keep/remove as a `choice`, generic instruction, the element only in the criteria | "Get rid of the banner" removed **every** node (p(remove) 0.92–1.0 on the others) | a noul with the element **in the instruction** and "Answer no for elements user_request does not mention": 79/80 nodes right vs 77/80 (`probe-keepmove.mjs`) |
| element in the instruction, keep/remove still a choice | "Replace the tasks with the weather" removed the KPI row (76/80) | the noul |
| "instead" prompts | "Show jackets instead" removed the grid (p 0.9) while also setting `category=jackets` | rule: a param change keeps the node |
| pairwise "which comes higher" between each mover and every other node | right only against the anchor the prompt names: "move the chart below the orders" also went below the tickets; added parts landed between existing ones | one `where` choice with `above/below/beside:<k>`, `top`, `bottom`, `not_stated` (66/66 vs 50/66) |
| row gate + per-node row/page placement | "put the orders next to the revenue" put the chart in the row too | `beside:<k>` |
| both subject and anchor flagged as moved | the anchor moved next to a third node | reference-point rule |
| a move noul per node (works on Jev) | on nimble, nodes that merely shift were flagged (0.5–0.98: "Put the weather at the top" flagged revenue and the chart) | `moved_1/2` slots: one lookup over the nodes |
| `set_` read unconditionally | on nimble, unrequested settings changed ("Remove the chart" -> `range=week`, kept by the param-change rule) | the `change` gate |
| swap gate -> always in place | "drop the tickets and add a feedback form at the top" put the form at the bottom | a replacement also gets a `where`; `not_stated` = in place |
| per-node "is this secondary?" nouls without a gate | "Remove churn" also removed the tasks | the `simpler` gate |

## 4. nimble (local Ollama, 9B): the final encodings

Single runs of the final encodings on `nimble` (Ollama 0.40.2, local 9B), with Ollama's limit of
**26 candidates per choice** (`LIMITS.maxOptions = 26`, set by the runner for `MODEL=nimble`). The GPU
was shared with three other workers' runs the whole time, so the **latencies are queueing, not
nimble** (an idle nimble call is ~3 s; a trivial call timed out at 2 min at the worst point). The
token counts are Ollama's prompt tokens, which count the state once per question (~20x Jev's).

| Task | Encoding | nimble | Jev (same encoding) | Calls | Median (contended) |
| --- | --- | --- | --- | --- | --- |
| Params | inline + not_stated | **19/20** | 54/60 | 1.35 | 25 s |
| Records (40 projects) | prefilter + groups + slots | **18/20** | 35/40 | 1 | 29 s |
| Edits, tuned | batch + where + change gate + move slots | **18/22** | 66/66 | 1.59 | 73 s |
| Edits, held-out | same | **10/16** | 43/48 | 1.56 | 25 s |
| Edits, tuned | batch + where, a move noul per node, no change gate | 11/22 | 66/66 | 1.59 | 41 s |

- **Params and records carry over** (nimble's misses: "Our most expensive products" also sets
  `category=bags`; "Show me the Phoenix project" -> the project list; "Jun's card" -> the team roster
  filtered to backend engineers).
- **Edits are where nimble is weak.** The per-node move noul and the unconditional `set_` reads
  failed on nimble (11/22, `nimble-probe-edit.txt`: shifted nodes flagged as moved at 0.5–0.98,
  "Remove the chart" also answering `range=week` 0.89); the move slots and the `change` gate are
  the fixes (18/22) and cost nothing on Jev. What still fails on nimble: an added node placed `top`
  when the prompt says nothing ("Add the weather"), over-removal on replace ("Replace the orders with
  the signups card" removed every node; "Replace the tasks with the weather" removed the KPI row),
  the "revenue card" vs "revenue chart" confusion, and leftover param noise (`sort=priceLow`,
  `limit=25` unasked). For a local 9B model, edits need more work (candidates: a `removed_1..k` slot
  form like the move slots, and `not_stated` as the forced default for adds unless a `placed`-style
  gate fires); not measured.

## 5. Recommended API surface (plain data, backend-neutral)

```js
const catalog = {
  parts: [
    {
      id: 'revenueChart',
      description: 'Line chart: the revenue trend over time',   // all the model sees; no param values in it
      params: {
        range: {
          label: 'time range',                                   // used in the generated questions
          default: 'month',                                      // used when the request is silent
          options: { week: 'the last 7 days (this week)', month: 'the last 30 days (this month)',
                     quarter: 'the last 3 months (this quarter)', year: 'the last 12 months (this year)' },
          // ask: '…',                                           // optional question override (counts, odd labels)
        },
      },
    },
    {
      id: 'project', group: 'projects',                          // alternatives share a group: at most one is chosen
      description: "Project card: one project's status, owner and next milestone",
      records: {
        param: 'project',                                        // the param the record key goes into
        label: 'project',
        maxRecords: 4,                                           // slots
        items: projects.map((p) => ({ key: p.id, name: p.name,  // name (+ aliases): the prefilter and the gate
          description: `${p.name}: ${p.kind}, owner ${p.owner}, ${p.status}` })),  // <= 254, else prefilter
      },
    },
    {
      id: 'projectList', group: 'projects',
      description: 'List of projects filtered by status, owner or kind',
      params: { owner: { label: 'project owner', default: 'anyone',
                         options: { anyone: 'owned by anyone', ...Object.fromEntries(people.map((p) => [p.id, `owned by ${p.name}`])) } } },
    },
  ],
}
```

- The component stays on the app side, keyed by `id` (never sent).
- `options` keys are strings; numeric params are bins (§1) the app maps to numbers.
- Layout nodes: `{ part, params? }` with only non-default params; record nodes carry the record key
  in `params[records.param]`; containers `{ part: 'page' | 'row', slots: { default: [...] } }`.
- An edit takes `{ catalog, layout, prompt }` and returns a layout that keeps keys (§3).

**Decision-model-specific vs. backend-neutral.** The declaration is neutral: an LLM with structured
output can take `options` as a JSON-schema `enum` (option descriptions as descriptions), `records.items`
as an enum of keys, `group` as a `oneOf`, and emit the same layout format. Decision-model-specific is
only what `params-edits.mjs` builds: the wording (`W`), `not_stated`, slots and `maxRecords`, the
254-option ceiling, the gates and the two-call edit flow. Where the declaration should allow more
for an LLM:
- **free-text params**: `{ type: 'text', label, default, maxLength? }` (a search query, a title, a
  filter string). A decision backend cannot fill them: it keeps `default`, or the app gives `options`.
  `type: 'enum'` stays the default.
- **numbers**: `{ type: 'number', min, max, default, bins }`: an LLM fills the number, a decision
  backend picks a bin.
- **records > 254** (or > 25 on Ollama): an LLM can take a larger enum (or emit a key the app
  validates); a decision backend needs the prefilter. `name` + `aliases` make the default lexical
  prefilter possible; allowing `items: (prompt) => [...]` lets an app plug in its own search.
- `label`, `ask` and option descriptions double as JSON-schema descriptions for the LLM.

## 6. Open problems

- **Part-selection precision** is now the main error in all three tasks (a spurious `tasks`, the
  calendar for "workload", the revenue KPI for "revenue chart first"). A1's selection work applies.
  Groups help wherever two parts are alternatives for the same content, but authors must declare them.
- **Wording collisions** between params of one part (§1) and between parts (KPI vs chart) are catalog
  bugs the model cannot fix; a lint (similarity of descriptions and options) would help authors.
- **Order of record nodes** is not scored: slots give mention order, a sensible default; the pairwise
  order call works on top.
- The **lexical prefilter** misses paraphrased references ("the billing one"); the gated form covers
  them up to 254 records (25 on Ollama). Above that, only an app search (`items: (prompt) => …`).
- **Edits on trees** (moving into a container other than a row, nested slots): `where` generalises
  (`into:<container>`), not measured; depends on A1's encoding.
- **Vague edits** ("make it simpler", "clean this up") pass the "any shorter page, same order" check,
  but which parts go is the model's taste; there is no single right answer.
- Jev varies slightly between identical calls; borderline answers (p ~ 0.4–0.6) flip. Report over repeats.
- Call 1 of an edit still sends the old `row` gate, unused by `applyEdit` (drop it, ~30 tokens).
- nimble edits (§4): 18/22 tuned, 10/16 held-out; replace over-removal and unplaced adds need work.
