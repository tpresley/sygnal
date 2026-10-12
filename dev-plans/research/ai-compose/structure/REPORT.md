# Structural encoding for decision models (worker A1)

Saved from the worker's hand-back (the harness kept it from writing this file). Code: `composer.mjs`
(pure functions; the exact question wording is its `TEXT` constant), `client.mjs`, `evals/` (5
catalogs as plain data in `catalogs.mjs`, `cases.json` for the LLM path, `run.mjs`,
`layout-only.mjs`, `selftest.mjs` offline). Run: `node --env-file=$HOME/.config/typesafe/env
evals/run.mjs [catalog] [--repeat=3] [--prefilter]`; `BACKEND=ollama` for nimble.

## Encoding (2 `decide()` calls; 3 with the optional pre-filter)

- **Select** (state: the request only): `use_<id>` (omit / use) per part; `pick_<resource>` (omit +
  each variant) per group of mutually exclusive variants; `count_<id>` (0..maxUses) per repeatable
  part; a `row` noul gate. Nothing selected: nothing fits.
- **Layout** (state: request + selected elements): `parent_<k>` only over the places the part's `in`
  allows (`container:slot`, labelled by the slot's description); with the row gate on, `beside_<k>`
  (which element is it side by side with? none + others) and `left_<a>_vs_<b>`; `first_<a>_vs_<b>`
  per pair; `gap_<x>_in_<id>` for a repeated part (above all copies / between / below).
- **Deterministic code**: required parts, companions, pins; `auto` containers exist only when filled;
  tabs below `minSlots` unwrapped; cycles to root; rows by average-linkage clustering of `beside`
  (threshold `rowMean`: 0.25 Jev, 0.5 nimble); order by summed pairwise probabilities; maxParts,
  maxDepth.
- **Pre-filter** (call 0): `cat_<id>` noul per category; same accuracy at half the tokens, +1 call;
  worth it above ~60 parts or on local / token-billed backends.

## Results

Jev, full composition, 3 repeats: **189/210 exact (90%)**, ~350 ms per composition, call latency flat
at 170–200 ms from 5 to 51 questions, 3–6.6k input tokens.

| Catalog | Exact | Part err | Placement err | Calls | Tokens |
|---|---|---|---|---|---|
| dashboard, multi-row (9 parts) | 41/45 | 3 | 9 | 1.87 | 3.5k |
| settings, sections + buttons (25) | 36/36 | 0 | 0 | 1.83 | 3.5k |
| CRM, tabs + nested card (14) | 38/42 | 2 | 0 | 1.93 | 3.1k |
| landing, variants + repeats (16) | 39/42 | 3 | 0 | 1.93 | 2.8k |
| ops console (50) | 35/45 | 13 | 8 | 1.87 | 6.6k |
| ops with pre-filter | 35/45 | 12 | 4 | 2.80 | 3.6k |

Layout step alone (from the correct selection): 62–63/65. Nearly every error is selection.
nimble (shared GPU, 1 run): 38/68 end to end (41/68 with rowMean 0.5), layout alone 56–59/65;
failures: conventional extras (always adds the nav bar), rows chaining, CRM parts left on the page.

## Catalog fields that mattered

`in` (allowed parents) is the most valuable: layout 37/37 with it, 25/37 with json-render's
parent-over-all-slots. `auto` containers (the model never chooses a container: a container is never
what the user asks for). Fixed structure in data: `required` + `pin`, `companions` (Save/Cancel with
form fields), a one-sentence `guidance` quoted in the order question. Also `arranged`, `minSlots`,
`resource`, `maxUses`, `category`, `limits: { maxParts, maxDepth }`.

Descriptions (P(use) of one isolated question): lead with the noun the user says ("Password (change
it: current and new password fields)" 0.72 vs "Change-password fields (…)" 0.07); don't name other
parts' content; avoid generic words; slot descriptions list what belongs there; sections and tabs
use the titles the user sees.

## Alternatives that lost

Unconstrained parents (25/37); rows by index (6 placement errors); per-pair row nouls (fine on Jev,
nimble 8/14); one 4-way relation per pair; within-row order from `first_` alone (reversed 3/3);
"Position N" (Jev 60/61 but collapses on nimble); one call for everything (≤ 10 parts only:
grows with the square of the catalog); select wordings (README wording 45/60 vs strict 50–52/60,
yes/no per part 32/60).

## Limits and open problems

maxParts 12 (66 pairwise questions; ~8 on local models), maxDepth 4. Open: selection precision and
recall (semantic neighbours, parts dropped from long prompts), anchors read as requests ("before the
footer" drops the footer), group references ("the three KPIs"), order requests against a fixed tab
order, nimble placing parts on the page instead of tabs, Jev nondeterminism (±1–3 per 45).
