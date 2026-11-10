# Agent docs: cutting the context Sygnal costs (spike, 2026-11-09)

**Question.** The agent context is `llms.txt` (66.5 KB), `SKILL.md` (56.2 KB) and ten topic files (54.5 KB). Sygnal trials carry +32–35k tokens of context over React and cost 1.3–3× more. How much of it has to be there before the first line, and how do the experimental subpaths stop loading it, without moving code out of the package?

**Results (added after the paid runs).** Section 9 has them. The compact core cost 14% less on Sonnet and 21% less on Haiku with no detectable pass-rate loss, on the no-skill path. The `AGENTS.md` index did not beat the compact core on cost. With the skill, the compact form cost 22% less than today's skill and lost no passes in 30 trials, though agents ran more lookups. The table below is the spike's original proposal, with its status updated from those runs.

**Limits of this spike.** The audit, candidates and coverage were done before any paid run. Token counts are bytes ÷ 3.6 (the ratio the llms-context spike measured with cl100k_base). The trap verdicts and paragraph kinds are hand-assigned. The coverage table measures whether API names are present, not whether agents use them well. The root `npm test` gate was not run (other sessions are busy); `test/llms-txt.test.js`, the eval unit tests and the checks named below were.

## Recommendation (accept or reject)

| # | Do this | Evidence | Cost |
|---|---|---|---|
| 1 | Replace the core `llms.txt` with the **compact core** (21.7 KB, ⅓ of today), everything removed moved verbatim to on-demand topic files. | Fact coverage: 97.4% of what the 49 reference solutions use is inline, 100% within one read (today 99% / 100%). | **Run done: ship it for the no-skill path** (section 9). A pass-rate loss under about 20 pp cannot be ruled out. |
| 2 | **Generate the skill from the same source** (22.4 KB against 56.2 KB). | The two files carry the same facts in two wordings: only 28–34% shares exact wording, 652 of the 1,064 distinct API names are in both, and no skill trial needs both. | **Run done: generate it, and ship it together with #1** (section 9). Cost 0.78× today's skill; 30/30 passes against 29/30. Two trials per task cannot rule out a pass-rate loss under about 30 pp. |
| 3 | Put the **trigger index in `AGENTS.md`** (7.0 KB; passive, always in context). | Vercel: 100% against 53–79% for a skill; here the llms-context core index found the right topic in 36/40 trials. | **Run done: do not adopt.** Cost ratio to #1 alone 0.97 (0.90–1.06), so it fails the section 7 rule, though it reached the right topic in 42 of 42 trials. |
| 4 | Keep **option lists out of the core**, reachable by symbol: the types already answer them. Ship `sygnal-check docs <Symbol\|sygnal/x\|dir>`. | 88% of the API names in reference prose already sit in a JSDoc; about 23 KB of `llms.txt` is option-list sentences. `dist/index.d.ts` is 390 KB, so agents need a lookup, not more JSDoc. | **Built** (section 10); no model has used it. A run is proposed there. |
| 5 | Drop the **47 trap sentences whose diagnostic already says the fix** (6.5 KB in `llms.txt`, 4.8 KB in the skill), after raising SYG105 from info to warn. | Section 4. | None. |
| 6 | Take the **13 traps in section 4's list** to the 8.0 backlog as throw-or-impossible candidates. | Section 4. | 8.0 work; I did not edit the backlog. |
| 7 | Rule: **a subpath gets one line in the core**. The cost was smaller than expected, so this is hygiene: experimental subpaths are about 1.6 KB of `llms.txt`. | Section 5. | None. |

The biggest single saving is #1 and #2. Experimental subpaths are not where the bytes are.

## 1. What is in the context today

Paragraph kinds are by hand (`data/labels.json`); the sentence-refined column moves single sentences that name a SYG code, a version or a subpath out of their paragraph (`tools/audit.mjs`, per paragraph in `data/audit.json`).

| Kind | `llms.txt` by paragraph | sentence-refined | `SKILL.md` by paragraph | sentence-refined |
|---|---|---|---|---|
| a. Mental model and canonical forms | 16,334 B | 14,105 B (21%) | 17,721 B | 16,227 B (29%) |
| b. Option and API reference | 33,928 B | 28,845 B (43%) | 21,123 B | 19,035 B (34%) |
| c. Trap warnings ("never X: SYGnnn") | 1,970 B | 7,435 B (11%) | 3,523 B | 6,031 B (11%) |
| d. Migration and version notes | 0 B | 1,731 B (3%) | 439 B | 1,513 B (3%) |
| e. Non-core subpath material | 4,131 B | 4,339 B (7%) | 5,355 B | 5,355 B (10%) |
| f. Testing | 9,801 B | 9,709 B (15%) | 6,791 B | 6,791 B (12%) |
| Navigation | 375 B | 375 B (1%) | 1,248 B | 1,248 B (2%) |
| **Total** | **66,548 B ≈ 18.5k tok** | | **56,221 B ≈ 15.6k tok** | |

Reference is the largest kind in both files, and a fifth of the core is canonical example code. The arXiv API-doc study (cited in the llms-context README) found examples carry most of the signal and parameter lists little, so the order to cut is reference, then traps, then versions.

## 2. `llms.txt` and the skill

- They overlap heavily in substance and only partly in wording: **28% of `llms.txt`'s bytes and 34% of the skill's are the same text** by 8-word shingles (`tools/audit.mjs`), but 652 API names appear in both, against 249 only in `llms.txt` and 163 only in the skill. A long bullet was rewritten for each file, so a shingle match undercounts. Mostly the skill is a shorter copy of `llms.txt` with the workflow and the canonical-forms table added.
- **An agent with the skill does not need `llms.txt` for the core**, but it reads it: 99 of 347 recent skill trials opened `llms.txt` (29%), partly because the skill says "Full spec: `llms.txt`" and the template's `AGENTS.md` says "Read `llms.txt` first … If you have the skill, use it too". Those setups pay for both, up to 34k tokens.
- **The reverse holds too:** a no-skill agent gets the facts from `llms.txt`; `llms.txt` alone passed 85–88% on the same harness. The skill's unique content is the workflow, the canonical-forms table (kind c) and some shortened forms.
- Keeping two hand-written files in step is also what let the skill reach 56 KB against a 41.5 KB cap nobody tested. The test now exists (section 8).
- **Fix: one source.** `tools/build-candidates.mjs` writes `candidates/compact-skill/SKILL.md` from the compact core, with the frontmatter and `references/` in place of `llms/`. The template `AGENTS.md`'s "read `llms.txt` first" then costs nothing extra, because they are the same file.

## 3. The candidates

All under `candidates/` (the on-demand set in `candidates/compact-core/llms/`).

| Candidate | Always loaded | On first use | Coverage inline / one read | Notes |
|---|---|---|---|---|
| Today, no skill | `AGENTS.md` 5.0 KB, then `llms.txt` 66.5 KB when read | topics 54.5 KB | 99% / 100% | ≈ 18.5k tok once read |
| Today, skill | `AGENTS.md` 5.0 KB + skill 56.2 KB | references, guides, sometimes `llms.txt` | 98.9% / 100% | ≈ 15.6k tok + the guides |
| **Compact core** | `AGENTS.md` 5.0 KB, then `llms.txt` **21.7 KB** | 23 topics, 117 KB total, one read each | **97.4% / 100%** | ≈ 6.0k tok |
| **Compact skill** | `AGENTS.md` + skill **22.4 KB** | same | 97.4% / 100% | ≈ 6.2k tok |
| **`AGENTS.md` index** | **7.0 KB** | `llms.txt` (compact) and the topics, by trigger | 69.1% / 100% | ≈ 2.0k tok always; 21.7 KB read only for new kinds of code |
| Types on demand | nothing | `sygnal-docs FetchRequest` 12 KB; `RenderResult` 2.4 KB; `PersistOptions` 1.7 KB; `latest` 0.6 KB | not additive | a lookup, not a fifth doc |
| Diagnostics as docs | nothing | the message | not additive | 11.3 KB of `go` sentences removed across both files |

**Compact core** (`candidates/compact-core/llms.txt`, hand-written): the model, the anatomy, eight canonical examples, a trigger table, the checker, and a testing section that keeps every `t.*` name inline (the E5 lesson: moving the common test facts behind a link raised failed runs from 0.29 to 0.75 per trial). Everything else moved verbatim into topic files; `tools/preservation.mjs` confirms no paragraph of today's `llms.txt` is uncovered except the index and headings. All its samples pass `sygnal-check --strict --a11y=error`, and I ran each example against `dist/` (8 of 8 pass; scratch check, not committed).

**`AGENTS.md` index** (`candidates/agents-index/AGENTS.md`): what `create-sygnal-app` would write, 7.0 KB, in the shape of Vercel's result: the component shape, then "about to write X → read Y" triggers, then the commands. It points at `node_modules/sygnal/llms/` and `dist/guide/`. `dist/guide/` ships 62 pages but has no router, sockets or testing page; the topic files fill that, so a real release must ship them too.

**Reference through the types.** `src/index.d.ts` already has 880 JSDoc blocks. Of the API names in the prose reference, 91% are declared and 88% appear in a JSDoc (`tools/types-reach.mjs`). Sentences that are option lists come to **23.2 KB in `llms.txt` and 13.1 KB in the skill**, nearly all already explained by JSDoc; that is an upper bound, since a sentence can also say something about behaviour. So writing more JSDoc would move little. The gap is access: `dist/index.d.ts` is 390 KB, and an agent that opens it pays 108k tokens. `candidates/docs-lookup/sygnal-docs.mjs` is a working prototype of `sygnal-check docs`: a declaration with its JSDoc, a member by name, or the docs for an import. Agents already grep: `dist/index.d.ts` was opened in 26 of 347 skill trials.

**Per-subpath docs and the import-keyed lookup.** Section 5 assesses the rule. The same prototype answers `sygnal-docs sygnal/yjs` and `sygnal-docs ./src` (which subpaths the code imports, what to read for each). It would sit in three places, in order of value: the `sygnal-check` output on first sight of an import ("`sygnal/yjs`: read `llms/collaboration.md`"), the Vite plugin in dev, and the MCP server as a `docs` tool. This costs zero core bytes. It does not solve discovery: an agent told to "make the list collaborative" won't import `sygnal/yjs` unless something names it. That is why the compact core keeps one 365 B line.

**Diagnostics as documentation.** See section 4. It works for most traps: a message names the fix at the moment it matters, and it is exactly where agents look. It fails for the traps that shape the design before any code exists and those that never fire in a test.

**Other ideas worth keeping.**
- **One fact per grep.** Agents read with `grep` and `sed` (llms-context README): one fact per line, with the API name in the line, beats a 5 KB bullet. Applies to the topic files.
- **Name each topic file for its import** (`sygnal/yjs` → `llms/yjs.md`), so one rule replaces the mapping.
- **Don't teach what the project already shows.** `create-sygnal-app`'s starter could carry one canonical component and test per template: copied examples are the highest-value context.

**Load order** (what must be in context before the first line, against what can wait):

| When | What | Size today → proposed |
|---|---|---|
| Before the first line | The model, the anatomy, the canonical examples, the `t.*` names, the triggers | 123 KB across two files → 21.7 KB |
| When a feature starts (trigger) | That feature's options and its example | carried always → one topic, 1–16 KB |
| When something is named | A symbol's options: a type lookup | 390 KB file → 0.6–12 KB |
| When a diagnostic fires | The fix: the message, then `sygnal-check explain` | carried always (11% of each file) → 0 B |

## 4. Traps

47 of the 56 diagnostics the context mentions can lose their sentence: the message and its `fix` already say what to do, and it fires in the normal loop (`npm test` with `strict`, `expectNoDiagnostics`, or `sygnal-check --strict`). Five must stay (SYG104, SYG256, SYG405 in the core; SYG430, SYG670 in a topic), and four keep only their positive form. Bytes are the sentences that name the code. Verdict table: appendix A.

| Verdict | Codes | `llms.txt` bytes | `SKILL.md` bytes |
|---|---|---|---|
| go: drop the sentence | 47 | 6,533 | 4,809 |
| short: keep the positive form | 4 | 630 | 968 |
| keep: needed before the first line | 5 | 648 | 1,207 |

Two caveats. SYG105 and SYG102 are info-level, which `expectNoDiagnostics` doesn't see, so a misspelled event name still runs silently; raise SYG105 before dropping its sentence. And "fires in the loop" assumes the agent runs the tests and the checker.

**One sentence is stale.** `llms.txt:209` says that without the driver "the static opens nothing and nothing reports it", and the skill says "silently". SYG643 reports it for `connections`. Fix the sentence whether or not the rest of this lands.

### Candidates for `dev-plans/BACKLOG-8.0.md` (not edited)

- **SYG101** (Intent action has no model entry): Throw at definition in dev (an action with no reducer is never intended)
- **SYG105** (EVENTS type selected but never emitted, or emitted but never selected): Raise to warn: an emitted or selected name with no partner is a bug, and the name registry makes it checkable
- **SYG106** (Parent prop is overwritten by a reserved view argument): Error in dev, as strict mode already makes it
- **SYG115** (Unknown DOM event shorthand): Throw in dev: `DOM.enter` can never mean anything
- **SYG116** (EVENTS value has no string type): Make it impossible: a sink function returning an `event()` result is unambiguous, so accept it
- **SYG132** (Declaration static that is never sent): Make it impossible: a root that declares `route`, `head`, … and has no `initialState` starts from `{}`
- **SYG143** (Widget tag used as a selector): Make it impossible: `DOM.select(Widget)` resolves to the widget host (controls() already has the machinery)
- **SYG202** (STATE reducer returned undefined): Decide: treat `undefined` from a root reducer as ABORT, or throw
- **SYG221** (set() called with a string): Make it work: `set('draft')` means "store the data here", which is what every agent who wrote it meant; or throw at definition, in production too
- **SYG222** (STATE reducer returned the same object after it was mutated in place): Throw in dev by freezing the state handed to reducers
- **SYG302** (Default import from 'xstream' or 'xstream/extra/*'): Make it work: the Vite plugin already resolves `xstream`, it can give a default export the shape the app expects
- **SYG421** (Invalid data (dataset) key): Make it impossible: `data={{ 'task-id': 1 }}` can be normalized to the camelCase key
- **SYG643** (Declaration static with no driver to take it): Hand-off: the session on driver wiring owns this one

A trap that can't occur needs no sentence and no diagnostic; these 13 are the ones where the fix is small and the intended meaning is unambiguous.

## 5. Per-subpath docs

Rule assessed: **the core names a subpath in one line and nothing more.** Today:

| File | Line | Bytes | Verdict |
|---|---|---|---|
| `llms.txt` | 283 "More (guides)": lists eight subpaths | 1,462 B | Violates: move the renderer and `sygnal/yjs` clauses to the index line. |
| `llms.txt` | 327 replay clause in Testing | 544 B line, 1 clause | Acceptable. |
| `llms.txt` | 7–16 index, 182 typed-API clause, 153 island clause | short | Fine. |
| `llms.txt` | 268–270 AI, 284 UI ("never hand-roll") | 1,368 B | Keep: `sygnal/ai` and `sygnal/ui` are not experimental, and the point of these lines is that agents use them. |
| `SKILL.md` | 211 typed API | 867 B | Violates: move to the typed-apis reference. |
| `SKILL.md` | 388 record and replay | 701 B | Violates: move to the replay reference. |
| `SKILL.md` | 177 island, 26 guide list | 286 B, part of 1,031 B | Trim. |

Experimental subpaths come to about **1.6 KB of `llms.txt` and 2.4 KB of the skill**. The rule is right, cheap, and saves ~2 KB. It won't move the cost.

## 6. Measurements

**Coverage.** The 49 reference solutions use 811 fact instances (`tools/coverage.mjs`): API tokens, a few semantic rules, and the `t.*` helpers their tests use. Inline means the token is in the file; one read means it is in a file the candidate names.

| Candidate | Bytes | ≈ tokens | Inline | Within one read | Missing |
|---|---|---|---|---|---|
| `llms.txt` today | 66,548 | 18,486 | 99.0% | 100% | none |
| `SKILL.md` today | 56,221 | 15,617 | 98.9% | 100% | none |
| Compact core | 21,701 | 6,028 | 97.4% | 100% | none |
| Compact skill | 22,411 | 6,225 | 97.4% | 100% | none |
| `AGENTS.md` index | 7,041 | 1,956 | 69.1% | 100% | none |

What compact leaves one read away is rare: `makeChatDriver`, `uiMessageStream`, `messageText`, `defineCatalog`, `SygnalEvents` (2–3 tasks each). The index leaves `.calculated`, `uid()`, `<Switchable>`, `t.ready`, form fields and others one read away. Per-task table: appendix B.

**Which files agents opened** (`tools/reads.mjs`):

| Run | Trials | Skill read | llms.txt | a topic file | a shipped guide | built JS or src | dist/index.d.ts | mean bytes read under the package |
|---|---|---|---|---|---|---|---|---|
| p9-final-opus | 12 | 12/12 | 6/12 | 0/12 | 11/12 | 4/12 | 0/12 | 26.3 KB |
| p6-final-opus | 20 | 20/20 | 2/20 | 0/20 | 19/20 | 10/20 | 0/20 | 31.2 KB |
| p6-final-sonnet | 20 | 20/20 | 5/20 | 0/20 | 19/20 | 5/20 | 1/20 | 29.3 KB |
| p6-final-haiku | 20 | 20/20 | 9/20 | 0/20 | 19/20 | 16/20 | 4/20 | 44.9 KB |
| p5-final-opus | 25 | 25/25 | 8/25 | 0/25 | 25/25 | 11/25 | 0/25 | 23.7 KB |
| p5-final-sonnet | 25 | 25/25 | 5/25 | 0/25 | 18/25 | 1/25 | 0/25 | 11.6 KB |
| p4-final6-opus | 145 | 145/145 | 52/145 | 0/145 | 18/145 | 25/145 | 19/145 | 5.1 KB |
| p46-ev-opus | 80 | 80/80 | 12/80 | 0/80 | 20/80 | 4/80 | 2/80 | 4.6 KB |
| llms-ctx-new-noskill-sonnet | 75 | 0/75 | 75/75 | 33/75 | 33/75 | 0/75 | 0/75 | 35.4 KB |
| llms-ctx-old-noskill-sonnet | 75 | 0/75 | 75/75 | 2/75 | 31/75 | 2/75 | 0/75 | 35.2 KB |
| p9-no-skill-opus | 12 | 12/12 | 12/12 | 0/12 | 10/12 | 5/12 | 1/12 | 93.6 KB |

`p9-no-skill-opus` counts 12/12 under "Skill read" although it had no skill: the analyzer's byte count picks up other reads on that run.

What this implies:
- **Agents read built code when the guides lack the fact.** Among skill runs, 22% of trials opened built JS or source (76/347; Haiku on the AI tier 16/20). In the no-skill runs, where `llms.txt` has the reference prose, it was 4% (7/162). The skill runs lean to the AI tier, which is the worst case in both groups, but the gap holds on it too. The cost of a missing fact is a jump to `dist/`.
- **So `llms.txt` is doing real reference work, and removing it risks a jump to `dist/`** unless the lookup and topic files replace it. That is why the compact core comes with triggers and a lookup, not less documentation.
- Reference is read on demand and not whole: mean read volume in no-skill runs is 35 KB, about half of `llms.txt`.

## 7. Eval arms and run proposal

**Arms** (in `evals/agent-ergonomics/variants/`, following the llms-context spike, all validated by `tests/variant.unit.mjs`, 17/17 pass):

| Variant | Skill | Package context |
|---|---|---|
| `agent-docs-current` | none | as shipped |
| `agent-docs-current-skill` | `skills/sygnal-dev` | as shipped |
| `agent-docs-compact` | none | compact `llms.txt` + topic set |
| `agent-docs-index` | none | index as `AGENTS.md`, compact `llms.txt` + topic set |
| `agent-docs-compact-skill` | the compact skill | compact `llms.txt` + topic set |

All five pass a literal `--dry-run` (commands below; nothing was materialized or spent).

**What the run can show.** Past Sonnet data gives within-task log SD of 0.15 for cost, 0.29 for billed tokens, 0.23 for wall time. Per arm, 80% power at 5% two-sided: a −15% change needs 13 trials for cost, 51 for billed tokens, 30 for wall time; −10% needs 32, 121, 71. A pass-rate gap of 15 pp would need about 120 per arm, so this can show efficiency and rule out a large regression, not a small one.

**Proposal: the smallest run that answers it, with Haiku.** Costs are the harness's dry-run estimates.

| Step | Arms | Tasks | Trials | Estimate |
|---|---|---|---|---|
| 1. Haiku pilot (runbook rule) | current, compact | 23, 24 | 2 per task and arm, 8 | $14 |
| 2. Sonnet, primary | current, compact, index | the llms-context 15 (10, 11, 13, 23–25, 30, 31, 33, 34, 44–46, 48, 49) | 3 per task and arm, 135 | **$24** |
| 3. Haiku | current, compact | 11, 23, 24, 25, 30 | 3 per task and arm, 30 | **$54** (from a $1.80/trial rate set on the AI tier; re-estimate after the pilot, stop if over $75) |
| 4. Optional: Sonnet, skill pair | current-skill, compact-skill | the same 15 | 2 per task and arm, 60 | $11 |

Minimum: steps 1–3, about **$92** cap $100; step 4 adds $11 and answers the skill question directly.

**Decision rule** (D228's): adopt compact if each task's pass count is within one trial of the control in Sonnet, Haiku's pass rate drops by no more than 10 pp, and cost or billed tokens fall by at least 10%. Adopt the index if it beats compact on cost at equal pass rate. Track trigger use: if under 80% of topic-task trials read the matching file, the triggers need work before shipping.

Commands (`--dry-run` written literally; the maintainer removes it to run):

```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs-pilot-current-haiku --variant agent-docs-current --arms sygnal --tasks 23,24 --trials 2 --model claude-haiku-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs-pilot-compact-haiku --variant agent-docs-compact --arms sygnal --tasks 23,24 --trials 2 --model claude-haiku-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs-current-sonnet --variant agent-docs-current --arms sygnal --tasks 10,11,13,23,24,25,30,31,33,34,44,45,46,48,49 --trials 3 --model claude-sonnet-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs-compact-sonnet --variant agent-docs-compact --arms sygnal --tasks 10,11,13,23,24,25,30,31,33,34,44,45,46,48,49 --trials 3 --model claude-sonnet-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs-index-sonnet --variant agent-docs-index --arms sygnal --tasks 10,11,13,23,24,25,30,31,33,34,44,45,46,48,49 --trials 3 --model claude-sonnet-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs-current-haiku --variant agent-docs-current --arms sygnal --tasks 11,23,24,25,30 --trials 3 --model claude-haiku-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs-compact-haiku --variant agent-docs-compact --arms sygnal --tasks 11,23,24,25,30 --trials 3 --model claude-haiku-5-5 --dry-run
```

## 8. Done in this spike

- `test/llms-txt.test.js`: a byte budget on `skills/sygnal-dev/SKILL.md`, set at today's 56,221 B, with a comment that it only goes down.
- Nothing is published or released; no template or topic file in the package changed. Candidates live under this folder.

## 9. Results of the paid runs (2026-11-09)

The maintainer ran the seven commands of section 7, 173 trials for **$23.00** at list price, then the two skill-pair commands, 60 trials for **$11.53**. All nine runs: 233 trials, **$34.53**. Full tables, per-task numbers and the method are in `data/results.md` (`tools/results.mjs`); raw results are in `evals/agent-ergonomics/results/agent-docs-*`.

**Short answer.** On the no-skill path, the compact core cost 14% less on Sonnet and 21% less on Haiku with no pass-rate loss that these runs could detect. The `AGENTS.md` index was not distinguishable from the compact core on cost, so it does not meet the adoption rule. On the skill path, which is how plugin users get the docs, the compact skill cost 22% less than today's skill with 30/30 passes against 29/30, at the price of about one more tool call per trial; see "The skill arms" below.

### What ran and what did not

| Arm | Sonnet (15 tasks × 3) | Haiku (5 tasks × 3) | Haiku pilot (2 tasks × 2) |
|---|---|---|---|
| `agent-docs-current` | 45 | 15 | 4 |
| `agent-docs-compact` | 45 | 15 | 4 |
| `agent-docs-index` | 45 | not in the proposal | not in the proposal |
| `agent-docs-current-skill` | 30 (15 tasks × 2) | 0 | 0 |
| `agent-docs-compact-skill` | 30 (15 tasks × 2) | 0 | 0 |

The seven commands were steps 1–3 of section 7; the skill pair was step 4 and ran after them, about an hour after the last no-skill Sonnet run. The subsections up to "Against the decision rule" cover the no-skill arms and were written first.

No run or trial is missing or failed to start: every run scored all its trials, every transcript ended in `success`, none reported an error, and no audit flags or process kills were raised. All runs used the same tarball, git SHA `c86f6d41` and Claude Code 2.1.303, and I confirmed in one trial directory of each main run that the arm received its intended `llms.txt` (66,548 or 21,701 B) and `AGENTS.md` (1,844 or 7,041 B).

### Per arm

Mean per trial, with the SD across trials in brackets. That SD includes the differences between tasks, so the paired table below is the one that decides.

| Run, arm | Trials | Pass (95% interval) | Hidden tests | Cost | Billed tokens | Peak context | Wall time | Run total |
|---|---|---|---|---|---|---|---|---|
| Sonnet, current | 45 | 44 (88–100%) | 308/315 | $0.181 (0.069) | 252k (163k) | 34.6k (9.5k) | 42.2 s (19.8) | $8.15 |
| Sonnet, compact | 45 | 45 (92–100%) | 315/315 | $0.154 (0.057) | 187k (108k) | 30.7k (9.5k) | 36.6 s (13.1) | $6.94 |
| Sonnet, index | 45 | 44 (88–100%) | 314/315 | $0.149 (0.047) | 192k (89k) | 29.5k (7.4k) | 36.6 s (11.7) | $6.68 |
| Haiku, current | 15 | 14 (70–99%) | 108/111 | $0.037 (0.019) | 1,034k (579k) | 74.7k (17.1k) | 120.6 s (51.6) | $0.55 |
| Haiku, compact | 15 | 13 (62–96%) | 108/111 | $0.029 (0.011) | 744k (337k) | 61.5k (16.7k) | 107.5 s (45.1) | $0.43 |
| Pilot Haiku, current | 4 | 4 | 26/26 | $0.038 | 1,237k | 78.8k | 125.5 s | $0.15 |
| Pilot Haiku, compact | 4 | 4 | 26/26 | $0.026 | 724k | 55.9k | 95.3 s | $0.10 |

Spread between repeat trials of one task (pooled log SD, Sonnet): cost 0.16–0.18, billed tokens 0.31–0.38, wall time 0.20–0.21, peak context 0.12–0.13. A single task's three-trial mean therefore moves by about ±10% for cost and about ±20% for billed tokens by chance.

### Which differences are larger than the noise

Paired by task. The ratio is the geometric mean of arm ÷ control, the interval resamples tasks, p is the exact sign-flip test over tasks. "Survives" means Holm correction across the eight comparisons of cost, billed tokens, peak context and wall time for compact and index against current on Sonnet.

| Comparison | Metric | Ratio | 95% interval | p | Tasks lower | Survives |
|---|---|---|---|---|---|---|
| Sonnet, compact ÷ current | cost | **0.86** | 0.78–0.94 | 0.007 | 12/15 | yes |
| | billed tokens | **0.77** | 0.65–0.89 | 0.003 | 13/15 | yes |
| | peak context | **0.88** | 0.82–0.95 | 0.007 | 12/15 | yes |
| | wall time | 0.90 | 0.80–0.99 | 0.086 | 11/15 | no |
| Sonnet, index ÷ current | cost | **0.83** | 0.75–0.92 | 0.005 | 12/15 | yes |
| | billed tokens | 0.82 | 0.69–0.96 | 0.029 | 11/15 | no |
| | peak context | **0.86** | 0.79–0.93 | 0.005 | 12/15 | yes |
| | wall time | 0.91 | 0.82–0.99 | 0.087 | 10/15 | no |
| Sonnet, index ÷ compact | cost | 0.97 | 0.90–1.06 | 0.50 | 10/15 | no difference shown |
| | billed tokens | 1.06 | 0.91–1.23 | 0.47 | 8/15 | no difference shown |
| | peak context | 0.97 | 0.91–1.05 | 0.46 | 10/15 | no difference shown |
| | wall time | 1.01 | 0.91–1.12 | 0.90 | 6/15 | no difference shown |
| Haiku, compact ÷ current | cost | 0.79 | see below | 0.063 | 5/5 | cannot reach significance |
| | billed tokens | 0.74 | see below | 0.125 | 4/5 | cannot reach significance |
| | peak context | 0.81 | see below | 0.063 | 5/5 | cannot reach significance |
| | wall time | 0.89 | see below | 0.125 | 4/5 | cannot reach significance |

- **Sonnet:** compact and index both cost less than the control, and those differences are larger than the noise. The savings are not uniform: compact cost more on 3 of 15 tasks (31, 44, 49, up to 1.15×).
- **Wall time:** the 9–10% drop does not survive correction. The arms also ran one after another rather than interleaved, so API load is confounded with time.
- **Haiku:** with five tasks the smallest possible p is 0.0625, so no test can pass, and a bootstrap over five tasks is not a reliable interval. The direction agrees on every task for cost and peak context, and the 8-trial pilot agrees (cost 0.67, peak 0.70). Read this as consistent, not established.
- **Why Sonnet saved less than the file shrank:** the core lost 67% of its bytes, but Sonnet's peak context fell only 12%. Sonnet usually measures the file and greps or reads ranges (39 KB of docs read per trial under the control, against a 66.5 KB core). Haiku `cat`s the whole file, and its peak context fell by 13.2k tokens against 3.9k for Sonnet.

### Pass rate: what the numbers cannot say

| Gap in pass rate | Difference | 95% interval |
|---|---|---|
| Sonnet, compact − current | +2.2 pp | −5.9 to +11.6 |
| Sonnet, index − current | 0.0 pp | −9.5 to +9.5 |
| Haiku, compact − current | −6.7 pp | −31.8 to +18.4 |

No pass-rate difference is larger than the noise. That is weak evidence of no harm: at 45 trials per arm and a 98% baseline, Fisher's test has 15% power to catch a drop to 90%, 45% to 85%, 73% to 80% and 90% to 75%. Haiku's point estimate is unfavourable by one trial, and its interval allows a large loss.

### The five failures

| Trial | Result | What went wrong | Caused by the layout? |
|---|---|---|---|
| Sonnet, current, 45 t1 | 0/7 | Sent no request to `/api/chat` under the hidden tests, though the agent's own mocked tests passed. Cause not traced further | Control arm, so no |
| Sonnet, index, 48 t2 | 6/7 | After switching to the month, the title changed but a month goal was missing from the list. Cause not traced | No sign it was the docs, not established |
| Haiku, current, 30 t2 | 4/7 | The order POST was never sent | Control arm, so no |
| Haiku, compact, 30 t2 | 5/7 | Read the forms docs, then chose hand-written validation over `form()`, and fields carried `aria-invalid="true"` when the tests expected them valid | Unclear. Task 30 also failed on the control |
| Haiku, compact, 23 t3 | 6/7 | Refresh after a failed load kept showing the error instead of "Loading…" | Not missing text: this trial read `llms/resources.md`, which states the rule, and applied it only to the success case |

In all 165 main trials the final code had no `sygnal-check` diagnostics and no wiring failures, so the checker separates no arm.

### What agents opened

| Run, arm | `llms.txt` | A topic file | A guide page | `dist/index.d.ts` | Built JS or package `src` | The task's matching file | Failed build/test runs, mean |
|---|---|---|---|---|---|---|---|
| Sonnet, current | 45/45 | 21/45 | 19/45 | 1/45 | 1/45 | 28/42 (67%) | 1.6 |
| Sonnet, compact | 45/45 | 33/45 | 16/45 | 3/45 | 0/45 | 29/42 (69%) | 0.8 |
| Sonnet, index | 21/45 | 45/45 | 31/45 | 4/45 | 0/45 | 42/42 (100%) | 1.4 |
| Haiku, current | 15/15 | 1/15 | 11/15 | 8/15 | 7/15 | 10/15 (67%) | 1.9 |
| Haiku, compact | 15/15 | 15/15 | 7/15 | 11/15 | 6/15 | 14/15 (93%) | 1.3 |

- The index does what it was built for: every Sonnet trial with a matching topic opened it, against 69% with the compact core alone. It clears section 7's 80% trigger check, though the match allows either the topic file or a named guide page. It did not buy a lower cost than compact.
- Only 21 of 45 index trials opened `llms.txt`, although the index tells them to read it before their first component. They went to topic files instead.
- Haiku's reliance on `dist/index.d.ts` and built JS did not drop under compact (`d.ts` 8 → 11 of 15, built JS 7 → 6). The compact core does not address the reading of `dist/` that §6 found; a lookup is still the proposal for that, and it remains unbuilt and unmeasured.

### Against the decision rule in section 7

| Rule | Result | Met? |
|---|---|---|
| Compact: each task's Sonnet pass count within one trial of the control | Largest gap one trial (task 45, in compact's favour) | yes |
| Compact: Haiku pass rate drops by no more than 10 pp | −6.7 pp, one trial of 15 | yes, on a very wide interval |
| Compact: cost or billed tokens fall by at least 10% | Sonnet −14% / −23%, Haiku −21% / −26% | yes |
| Index: beats compact on cost at equal pass rate | ratio 0.97 (0.90–1.06), 44 against 45 passes | **no** |
| Triggers: at least 80% of topic-task trials read the matching file | 100% on Sonnet | yes |

### Recommendation

1. **Ship the compact core as `llms.txt`, with the topic set**, for projects without the skill. It met its pre-set rule, and the saving is larger than the noise on Sonnet.
2. **Do not ship the index in `AGENTS.md` on this evidence.** It costs 5.2 KB in every session and did not beat the compact core. Its 100% topic reach is real and worth keeping as a candidate if a harder task set shows topic reach changes pass rate.
3. **Generate the skill from the compact core, and ship it in the same change as #1** (recommendation #2 at the top). "The skill arms" below has the evidence and what it leaves open. The compact-skill arm also had the compact `llms.txt`, so the two were measured together.
4. The remaining recommendations (#4–#7) do not depend on these runs. None was tested by them.

### What this does not show

- **A small pass-rate loss.** Section 7 said so in advance; anything under about 20 pp could be missed without the skill, and more with it (see below).
- **Tasks outside these 15**, or Haiku beyond 5. Experimental subpaths (`yjs`, `canvas`, `three` and others) were not exercised, so their topic files are untested.
- **Other models.** Opus was not run.
- **Long sessions or repeat work in one project.** Each trial is one fresh task.

**Harness caveats.**
- The prompt says "Use the sygnal-dev skill" even when a variant has none (`prepare.mjs:110`). 164 of the 165 main trials tried it and got `Unknown skill`. That hits all arms alike, so the comparison stands, but every trial spends a failed tool call, and absolute numbers are not those of a clean no-skill project.
- Section 7's Haiku estimates were far too high: $14 and $54 proposed against $0.25 and $0.98 actual, because the $1.80-per-trial rate behind them was set on the AI tier; Haiku trials cost about $0.03. The Sonnet estimates were right ($7.94 per arm against $6.68–8.15).

### The skill arms (Sonnet, 15 tasks × 2)

**No trial is missing or failed to start.** Both runs scored 30 of 30; every transcript ended in `success`; there were no audit flags or process kills. Every trial's Skill call succeeded (no `Unknown skill`, unlike the no-skill arms). The final code had no `sygnal-check` diagnostics or wiring failures in any of the 60 trials. Both arms used the same tarball and Claude Code 2.1.303, with a 56,221 B `SKILL.md` or a 22,411 B one, as intended.

| Arm | Trials | Pass (95% interval) | Hidden tests | Cost | Billed tokens | Peak context | Wall time | Run total |
|---|---|---|---|---|---|---|---|---|
| current-skill | 30 | 29 (83–99%) | 207/210 | $0.215 (0.049) | 216k (97k) | 45.9k (7.0k) | 33.3 s (12.7) | $6.45 |
| compact-skill | 30 | 30 (89–100%) | 210/210 | $0.169 (0.049) | 192k (104k) | 34.7k (7.5k) | 34.7 s (13.1) | $5.08 |

Mean per trial, SD across trials in brackets. Spread between repeat trials of one task (pooled log SD, from one degree of freedom per task): cost 0.06–0.09, billed tokens 0.17–0.23, wall time 0.12–0.16, peak context 0.05–0.07. The skill arms vary less than the no-skill arms because every trial loads the same file.

**Compact skill ÷ current skill, paired by task.** "Survives" means Holm correction across these four.

| Metric | Ratio | 95% interval | p | Tasks lower | Survives |
|---|---|---|---|---|---|
| cost | **0.78** | 0.73–0.83 | 0.0001 | 15/15 | yes |
| peak context | **0.75** | 0.72–0.78 | 0.0001 | 15/15 | yes |
| billed tokens | 0.85 | 0.74–0.99 | 0.044 | 12/15 | no |
| wall time | 1.04 | 0.96–1.12 | 0.40 | 8/15 | no difference shown |

The cost and peak-context differences are larger than the noise and appear on every task. One of those 15 was barely lower (task 33, ratio 1.00 after rounding). Wall time did not improve.

**What the saving cost.** These are secondary measures, not corrected for multiple comparisons.

| Per trial | Current skill | Compact skill | Difference (paired by task) |
|---|---|---|---|
| Tool calls | 5.8 | 6.8 | +1.0, p = 0.013; higher on 10 tasks, lower on 2 |
| Failed build/test runs | 0.4 | 0.8 | +0.43, p = 0.063; higher on 5 tasks, lower on 1 |
| Build/test iterations | 2.1 | 2.6 | +0.47, p = 0.18 |

The tool-call increase is real, and the failed-run increase is suggestive. A compact skill gives an agent less up front, and it makes up some of that with lookups and test runs. On Sonnet that trade still came out 22% cheaper, because context dominates the bill.

**Pass rate.** Compact − current is +3.3 pp (−8.3 to +16.7). Not larger than the noise.

**The one failure.** Current skill, task 30 t2, 4/7: it used `form()` with a `request`, and the order POST was never sent under the hidden tests. Haiku's no-skill control, also on task 30 t2, failed with the same signature. It is a control-arm failure, so the compact layout did not cause it. I did not trace the cause: other trials with the same `form()` and zod `.transform()` shape passed, so that shape alone does not explain it.

**What agents opened** (a `references/` file counts as a topic file).

| Arm | Called the skill | `llms.txt` | A topic file | A guide page | `dist/index.d.ts` | Built JS or package `src` | The task's matching file |
|---|---|---|---|---|---|---|---|
| current-skill | 30/30 | 3/30 | 10/30 | 14/30 | 0/30 | 0/30 | 20/28 (71%) |
| compact-skill | 30/30 | 7/30 | 16/30 | 9/30 | 5/30 | 0/30 | 21/28 (75%) |

The compact skill sends agents to topic files more often. Unfavourable: `dist/index.d.ts` went from 0 to 5 of 30, which is the 390 KB file a lookup is meant to replace, and 7 of 30 opened `llms.txt`, which repeats what the compact skill already loaded. Both costs are already included in the arm's numbers.

**Against the no-skill arms on the same 15 tasks** (3 trials per task without a skill, 2 with).

| Ratio, paired by task | Cost | Billed tokens | Peak context | Wall time | Tool calls | Failed build/test runs, difference |
|---|---|---|---|---|---|---|
| current-skill ÷ current | 1.24 (1.09–1.40), p 0.007 | 0.93 (0.77–1.14) | 1.36 (1.23–1.51), p 0.0002 | 0.81 (0.70–0.92), p 0.004 | 0.60 (0.53–0.68) | −1.16, p 0.009 |
| compact-skill ÷ compact | 1.12 (1.04–1.21), p 0.015 | 1.03 (0.88–1.20) | 1.15 (1.07–1.24), p 0.004 | 0.94 (0.84–1.03) | 0.82 (0.72–0.92) | −0.01, p 1.0 |
| compact-skill ÷ current | 0.96 (0.84–1.10) | 0.79 (0.65–0.98) | 1.02 (0.91–1.14) | 0.84 (0.74–0.95), p 0.018 | 0.69 (0.61–0.79) | −0.72, p 0.10 |

- A skill makes a trial more expensive than the same docs without one. It loads the whole file, where no-skill Sonnet agents grep it. Today's skill costs 24% more and the compact skill 12% more.
- Today's skill buys something for that: 40% fewer tool calls and about one fewer failed build or test per trial. The compact skill keeps the tool-call saving in part (18% fewer) and **loses the failed-run saving** (no difference from compact without a skill). That is the main unfavourable result for the compact skill.
- The compact skill costs about the same as today's no-skill control (0.96×, not distinguishable) and is the only skill arm that doesn't cost more than it.
- These comparisons cross runs made at different times and differ in trial count, so wall-time ratios in particular carry that confound. In every no-skill trial the prompt also named a skill that failed to load, which costs them one tool call the skill arms did not pay.

**Against the decision rule** (section 7's compact rule, applied to the skill pair): each task's pass count is within one trial of the control (only task 30 differs, 1/2 against 2/2, in compact's favour), and cost fell by 22%. Met.

**Recommendation on the skill: generate it from the compact source, and ship it with the compact core.**
- Both layouts then come from one file, which ends the two hand-kept copies. Today, a wording change such as the one below has to be made twice.
- The candidate here came from `tools/build-candidates.mjs`. Shipping it needs that step moved into `scripts/build-llms.mjs`, and `SKILL_BUDGET` lowered to the new size.
- If failed builds matter more than cost for a release, keep today's skill until a larger run settles the failed-run difference.

**What 2 trials per task cannot show.**
- **A pass-rate loss.** At 30 trials per arm and a 98% baseline, Fisher's test has 4% power to catch a drop to 90%, 18% to 85%, 41% to 80%, 63% to 75% and 81% to 70%. At this size only a loss of about 30 pp is caught reliably, so 30/30 says little about smaller ones.
- **Anything about one task.** Two trials give one degree of freedom per task. Per-task ratios (cost 0.63–1.00) are mostly noise, and the failed-run difference can't be located to a kind of task.
- **Whether the failed-run difference is real.** p = 0.063 with 6 tasks differing.
- **Whether agents would pick up the skill by themselves.** Every prompt says "Use the sygnal-dev skill", so triggering from the description was not tested.
- **Anything on Haiku or Opus with a skill.**
- **Which change made the difference.** The compact-skill arm changed `SKILL.md` and the package's `llms.txt` together.

### Where `App.drivers` would go (not applied)

The maintainer decided `App.drivers` is the canonical place for feature drivers, with `run(App, {...})` for environment overrides. The text is in `dev-plans/research/files-touched/README.md` on branch `claude/spike-files-touched-89c15d` (commit `062e037a`); that branch is not merged here, and the candidates stay as measured.

In `candidates/compact-core/llms.txt`:

| Line | Today | Change |
|---|---|---|
| before 260, the `run(App, drivers = {}, …)` bullet | no driver rule | add the proposed paragraph as a new bullet (369 B) |
| 171 (HTTP) | `main.js: run(Search, { HTTP: makeFetchDriver() })` | `Search.drivers = { HTTP: makeFetchDriver() }` on the root |
| 201 (sockets) | `main.js: run(Chat, { WS: makeSocketDriver() })` | `Chat.drivers = { WS: makeSocketDriver() }` on the root |
| 210 (router) | `main.js: run(App, { ROUTER: router.driver })` | `on the root: App.drivers = { ROUTER: router.driver }` |
| 220 (head) | `main.js: HEAD: makeHeadDriver()` | `App.drivers: HEAD: makeHeadDriver()` |
| 250 (timers) | `run(App, { TIMER: makeTimerDriver() })` | `App.drivers = { TIMER: makeTimerDriver() }` |

**Byte cost: +399 B** (369 for the paragraph, +30 net for the five recipes), measured on a scratch copy: the core goes from 21,701 to 22,100 B, about 110 tokens. The skill source needs no separate edit once it is generated, and goes from 22,411 to about 22,810 B.

The topic files have 14 lines naming `main.js` or `run(App, {` across 12 files, each needing review; renderer and test uses stay on `run()`. If the `AGENTS.md` index is ever adopted, its line 21 changes too. The wording can only ship with or after the release containing `App.drivers`, because the static does not exist before it.

### Next run, if wanted (not started; the maintainer decides)

| Run | Trials | Cost, from these runs' rates | Answers |
|---|---|---|---|
| Sonnet skill pair, 15 tasks × 5 more | 150 | about $29 | The failed-run difference, and a pass-rate loss down to about 15 pp |
| Haiku, current and compact on all 15 tasks × 3 | 90 | about $3 | Makes Haiku's comparison testable |

## 10. The docs lookup

The compact core removed the option lists, and in the runs above agents then went to the 390 KB `dist/index.d.ts` (8–11 of 15 Haiku trials, 5 of 30 compact-skill Sonnet trials). This section records the lookup built to replace that. **No model has used it yet**, so nothing here shows it helps; the proposed run below would.

### What was built

| Piece | Where |
|---|---|
| Generator: the types (every subpath, through the TypeScript checker), `llms.txt` + `llms/`, `dist/guide/` for "read this", and `sygnal-check/explanations.json`. Run by `npm run build` | `scripts/build-reference.mjs` |
| `sygnal-check docs <symbol> [--json]` | `sygnal-check/src/docs.js` |
| The MCP tool `docs`, beside `check`, `graph`, `explain` | `sygnal-check/src/mcp.js` |
| The two delivery forms, from the same answers | `dist/reference.json` (CLI, MCP), `dist/reference.md` (one `## symbol` heading each) |
| Drift and budget tests | `test/reference.test.js`, `sygnal-check/test/docs.vtest.js` |
| One line each in the compact core and compact skill. The measured `compact-core` and `compact-skill` stay as they were, so earlier runs remain comparable | `candidates/compact-{lookup,grep}[-skill]`, from `tools/build-lookup-candidates.mjs` |
| The reference generated against the compact topic set, so its `Read:` lines name files those arms have | `candidates/reference-compact/` |
| Eval arms, and two harness additions | 6 `variants/agent-docs-*` below; `removeAfterInstall`, `prompt.skillLine` |

**What it answers.** An export (`makeFetchDriver`), a static (`App.resources`, `.intent`), an option (`latest`, `FormOptions.show`), a source or sink (`DOM`, `DOM.click`, `HTTP`, `EFFECT`), a subpath (`sygnal/ui`) or a code (`SYG643`). An answer has the signature, the options with one line each, a usage example and the file to read. A name with several meanings lists them. An unknown name exits 1 and lists the nearest names.

**Size.**

| Measure | Value |
|---|---|
| Answers | 3,399, plus 1,986 aliases |
| Bytes per answer | median 264, 95th percentile 1,067, maximum 1,802 (cap 1,800 plus the framing) |
| `dist/reference.json` | 1.86 MB (419 KB gzipped) |
| `dist/reference.md` | 1.48 MB (388 KB gzipped) |
| Compact core with the line | 21,738 B (CLI) or 21,711 B (grep), against 21,701 B |
| Compact skill with the line | 22,442 B (CLI) or 22,415 B (grep), against 22,411 B |

The line replaces the core's existing "grep the name in `dist/index.d.ts`" row, so it costs 10–37 B. `test/reference.test.js` holds those candidates to a budget, and the `llms.txt` and `SKILL.md` budgets are unchanged.

**Weak spots.**
- Only 131 of the 380 functions, constants, statics, sources and sinks have an example (34%). It is taken only from code the docs actually show, and an entry with no real usage gets none rather than an invented one. The common symbols have one, and a test holds that for five of them.
- 268 of those 380 name a file to read. The rest are symbols no doc mentions.
- A long options list keeps its first lines and gives the rest by name only (`also: …`), so `HTTP` names `latest` without its description. `FetchRequest.latest` has it.
- `App.drivers` is unknown on this branch because the static is on another. It will answer once that branch lands, since the entry comes from the types.
- It needs `sygnal-check` installed and a `sygnal` release that ships `dist/reference.json`. Codes still answer without one.

**If only one form ships: the CLI.** It takes the name an agent has, including `App.resources` or a misspelling, and it cannot return more than one short answer. The grep form suits Sonnet's habit and needs no second package, but it has no nearest-name help, needs an exact regex, and is a 1.5 MB file in a package whose Haiku users `cat` what they find. The run below can overturn this; the tie-break is in the rule.

### What was verified, and what was not

| Check | Result |
|---|---|
| `npm run build` with the new step; `build-reference.mjs --check` | passed |
| `test/reference.test.js`, `test/llms-txt.test.js` | 18 of 18 |
| `sygnal-check` suite, plain | 2,148 of 2,149. The one failure is `scope-tables.vtest.js`, a 5 s timeout at machine load average 33. It passes alone (4 of 4), and it does not touch this code |
| `sygnal-check` suite, per-file mode | 2,149 of 2,149 |
| `evals/agent-ergonomics/tests/variant.unit.mjs` | 18 of 18 |
| Installed form: `npm pack`, unpacked into a project's `node_modules`, then `docs` for five kinds of name | answers as expected, no network used |
| Replay of real behaviour: the names agents grepped for in `dist/index.d.ts` (37 commands, 26 trials) through the lookup | 29 of 39 distinct names answered. The other 10 are app words or pieces of a regex (`customers`, `proceed`, `SYG6`), not Sygnal names |
| All 14 commands below | literal `--dry-run`; no trial directory created |

**Not verified.**
- No model has used either form. Whether agents reach for it instead of `dist/` is the question the run answers.
- `removeAfterInstall` and the prompt option are unit-tested, but no trial was materialized.
- The root `npm test` gate was not run, by instruction. The docs site was not rebuilt for its one added table row.
- The eval analysis script does not yet report these arms; `tools/results.mjs` needs the new runs added when they exist.

### The harness flaw, and what it does to comparisons

`prepare.mjs` told every Sygnal trial to "Use the sygnal-dev skill", even with no skill installed. New no-skill arms set `"prompt": { "skillLine": false }` and get "This app uses the Sygnal framework." instead. It is opt-in so that the older variants keep their meaning.

Earlier no-skill runs (`agent-docs-current`, `-compact`, `-index`) each carry a failed Skill call in 164 of 165 trials, and new no-skill arms do not. **So new no-skill arms must not be compared with those earlier runs**: any difference mixes the prompt, the date and the checker version. That is why the plan re-runs a compact control with the fixed prompt, `agent-docs-compact-ctl`. On the 11 tasks the two share, old compact against the new control gives a rough size for the flaw, descriptive only. The skill arms' prompt did not change, but they also get a fresh control, because the new package would otherwise contain the reference files.

Every control removes both reference files, the CLI arms remove `reference.md`, and the grep arms remove `reference.json`, so no arm can find the other's form by listing `dist/`.

### Task list

The 15 tasks are `11,13,22,23,24,25,26,27,30,31,32,33,44,45,46`.

- Six are the tasks whose reference solution uses the most Sygnal options the compact core no longer shows: 45, 13, 44, 23, 31, 46.
- Five are from earlier runs where agents most often opened `dist/` under the compact docs, or which depend on a moved topic: 11, 24, 25, 30, 33.
- Four are new, chosen because their topic moved out of the core: 22 (sockets), 26 (persistence), 27 (undo), 32 (widgets).

11 of the 15 are in the earlier list. The first rank is by name matching on solutions, which is rough; the choice also used judgment. Four of these tasks (13, 22, 25, 44) have reference solutions that fail on this build according to the files-touched spike, but agents have passed them, so the hidden suites can be passed.

### Decision rule (fixed before any run)

Each lookup arm is compared with its own control, same model and same skill setting.

**Measures.** A *`dist/` read* is a trial whose tool inputs open `index.d.ts`, built JS under `dist/`, or the package `src` (the regex in `tools/results.mjs`). The reference files do not count. *Used* means the trial ran `sygnal-check docs` or touched `reference.md`.

| # | Requirement | Threshold |
|---|---|---|
| 1 | Agents use it | At least 50% of Haiku no-skill trials. If not, the arm tests nothing: no conclusion, reword the line |
| 2 | `dist/` reads | At most half the control's share on Haiku, with and without the skill; not higher on Sonnet |
| 3 | Failed build/test runs | Mean paired difference at most +0.25 per trial |
| 4 | Cost | Paired ratio at most 1.05, upper 95% bound at most 1.15 |
| 5 | Pass rate | Within 2 of 45 of the control on Sonnet, within 3 of 45 on Haiku |

A form ships if it meets 1–5 on Haiku without the skill and 3–5 on Sonnet in both skill settings. If both qualify, ship the CLI, unless the grep form is better on cost or failed runs with an interval excluding no difference. If neither qualifies, ship neither and keep the compact core's existing row.

**What it can detect.** At 45 trials per arm, halving a 73% `dist/`-read rate is caught 92% of the time. On Sonnet, where the rate is about 17% or less, going to 5% is caught only 33% of the time, which is why Sonnet is only required not to rise. A pass-rate loss under about 20 points can still be missed, as before.

### Commands and cost, cheapest informative set first

Build first, because the harness packs this checkout's `dist/`:

```bash
npm run build
```

Remove `--dry-run` from a command to run it. Each passes as written.

| Step | Runs | Trials | Expected cost | Stop if |
|---|---|---|---|---|
| 0. Pilot, Haiku, tasks 23 and 30 × 2 | lookup, grep | 8 | about $0.30 | Neither form is used in any trial |
| 1. Haiku, no skill, 15 × 3 | control, lookup, grep | 135 | about $5 | |
| 2. Haiku, skill, 15 × 3 | control, lookup, grep | 135 | about $6 | |
| 3. Sonnet, no skill, 15 × 3 | grep, lookup, control | 135 | about $25 | Step 1 fails requirement 1 for both forms |
| 4. Sonnet, skill, 15 × 3 | grep, lookup, control | 135 | about $25 | |

Total about **$61**, and about 11 hours run one after another (Haiku 1.1 h per arm, Sonnet 40 min). **The harness's Haiku estimate is wrong**: it prints $29.59 per arm, from the AI-tier rate; measured Haiku trials cost about $0.03–0.04. The amounts above use the measured rates ($8.35 per Sonnet arm is the harness's own, and it was accurate). The arms still run one after another, so time of day is mixed in; Sonnet runs in the opposite order from Haiku to soften that.

**Step 0.**
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs-pilot-lookup-haiku --variant agent-docs-lookup --arms sygnal --tasks 23,30 --trials 2 --model claude-haiku-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs-pilot-grep-haiku --variant agent-docs-grep --arms sygnal --tasks 23,30 --trials 2 --model claude-haiku-5-5 --dry-run
```

**Step 1.**
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs2-compact-ctl-haiku --variant agent-docs-compact-ctl --arms sygnal --tasks 11,13,22,23,24,25,26,27,30,31,32,33,44,45,46 --trials 3 --model claude-haiku-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs2-lookup-haiku --variant agent-docs-lookup --arms sygnal --tasks 11,13,22,23,24,25,26,27,30,31,32,33,44,45,46 --trials 3 --model claude-haiku-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs2-grep-haiku --variant agent-docs-grep --arms sygnal --tasks 11,13,22,23,24,25,26,27,30,31,32,33,44,45,46 --trials 3 --model claude-haiku-5-5 --dry-run
```

**Step 2.**
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs2-compact-skill-ctl-haiku --variant agent-docs-compact-skill-ctl --arms sygnal --tasks 11,13,22,23,24,25,26,27,30,31,32,33,44,45,46 --trials 3 --model claude-haiku-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs2-lookup-skill-haiku --variant agent-docs-lookup-skill --arms sygnal --tasks 11,13,22,23,24,25,26,27,30,31,32,33,44,45,46 --trials 3 --model claude-haiku-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs2-grep-skill-haiku --variant agent-docs-grep-skill --arms sygnal --tasks 11,13,22,23,24,25,26,27,30,31,32,33,44,45,46 --trials 3 --model claude-haiku-5-5 --dry-run
```

**Step 3.**
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs2-grep-sonnet --variant agent-docs-grep --arms sygnal --tasks 11,13,22,23,24,25,26,27,30,31,32,33,44,45,46 --trials 3 --model claude-sonnet-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs2-lookup-sonnet --variant agent-docs-lookup --arms sygnal --tasks 11,13,22,23,24,25,26,27,30,31,32,33,44,45,46 --trials 3 --model claude-sonnet-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs2-compact-ctl-sonnet --variant agent-docs-compact-ctl --arms sygnal --tasks 11,13,22,23,24,25,26,27,30,31,32,33,44,45,46 --trials 3 --model claude-sonnet-5-5 --dry-run
```

**Step 4.**
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs2-grep-skill-sonnet --variant agent-docs-grep-skill --arms sygnal --tasks 11,13,22,23,24,25,26,27,30,31,32,33,44,45,46 --trials 3 --model claude-sonnet-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs2-lookup-skill-sonnet --variant agent-docs-lookup-skill --arms sygnal --tasks 11,13,22,23,24,25,26,27,30,31,32,33,44,45,46 --trials 3 --model claude-sonnet-5-5 --dry-run
```
```bash
node evals/agent-ergonomics/orchestrate.mjs --run agent-docs2-compact-skill-ctl-sonnet --variant agent-docs-compact-skill-ctl --arms sygnal --tasks 11,13,22,23,24,25,26,27,30,31,32,33,44,45,46 --trials 3 --model claude-sonnet-5-5 --dry-run
```

## Appendix A: every trap the context mentions

| Code | Severity | Reported by | Verdict | llms.txt B | SKILL B | Why |
|---|---|---|---|---|---|---|
| SYG101 | warn | dev-entry, static | go | 149 | 165 | Names the action and the two fixes; the anatomy shows the pairing |
| SYG102 | info | dev-entry, static | go | 149 | 165 | info: the message suggests the fix |
| SYG104 | warn | dev-entry, runtime, static | keep | 249 | 807 | Message is complete, but it decides where events are handled; one sentence in the model. The bubbling detail can go |
| SYG105 | info | dev-entry, static | go | 93 | 93 | info only, so `expectNoDiagnostics` misses it: a typo in an event name runs silently |
| SYG106 | warn | dev-entry | go | 220 | 160 | Names the prop and the rename |
| SYG110 | warn | static | go | 113 | 370 | Static |
| SYG111 | warn | static | short | 147 | 147 | Example comment carries it; the React habit (`value` + `onChange`) makes it likely |
| SYG112 | error | dev-entry, static | go | 163 | 0 | Names the closest entry |
| SYG115 | warn | dev-entry | go | 155 | 56 | Fix names the real event |
| SYG116 | error | dev-entry, static | go | 114 | 114 | Fix shows the form |
| SYG117 | warn | dev-entry, static | go | 347 | 236 | Names the ancestor that handles it |
| SYG118 | warn | dev-entry, static | go | 381 | 0 | Behavior-only |
| SYG127 | error | static, dev-entry | go | 91 | 53 | Error, names the key |
| SYG130 | error | dev-entry | go | 25 | 0 | Names the closest route |
| SYG132 | warn | dev-entry | go | 172 | 0 | Fix is one word |
| SYG140 | warn | dev-entry, static | go | 103 | 0 | Names the fix |
| SYG143 | warn | dev-entry, static | go | 59 | 0 | Fix shows the class form |
| SYG202 | warn | dev-entry | go | 0 | 44 | Warn; "no change" is shown in every example |
| SYG214 | error | runtime | go | 121 | 0 | It reports the thrown error; nothing to learn before it |
| SYG221 | error | dev-entry | go | 0 | 0 | Error, and the message writes the exact replacement |
| SYG222 | warn | dev-entry | short | 206 | 325 | Positive form ("return a new object") stays; a React habit |
| SYG224 | error | dev-entry, static | go | 481 | 0 | Error, says why |
| SYG230 | warn | dev-entry | go | 176 | 0 | Names the field and the fix |
| SYG237 | warn | dev-entry | go | 63 | 0 | Writes the fix |
| SYG256 | warn | static | keep | 9 | 9 | Static and only where provable; "guards read previousState" is the rule the model needs |
| SYG257 | info | dev-entry | go | 201 | 201 | Audit mode, upgrade only: migration guide, not the core |
| SYG258 | warn | static | short | 130 | 349 | Keep the `{ now, uuid }` line (tests depend on it); `--fix` rewrites the rest |
| SYG301 | error | dev-entry | go | 393 | 351 | Thrown, and it names the xstream form of 40 operators: the RxJS table (700 B) is a copy of the message |
| SYG302 | info | static | short | 147 | 147 | info only; the example import is the fix |
| SYG401 | warn | runtime, dev-entry, static | go | 71 | 71 | Fix shows the form |
| SYG402 | error | runtime | go | 0 | 45 | Error |
| SYG405 | error | runtime, static | keep | 267 | 164 | Thrown, but it decides where state lives: the most common React-shaped mistake. One clause in the model |
| SYG421 | error | dev-entry | go | 353 | 115 | Writes the fix |
| SYG425 | warn | dev-entry | go | 57 | 0 | Writes the fix |
| SYG429 | warn | dev-entry, static | go | 283 | 325 | Names the page |
| SYG430 | warn | dev-entry | keep | 0 | 227 | Layout only: never fires in a mock-DOM test. It belongs in the topic file, not the core |
| SYG454 | warn | static | go | 74 | 74 | Sygnal 6 only: version note, migration guide |
| SYG501 | error | static | go | 0 | 111 | Static, strict, removed form; nothing in training data teaches it |
| SYG503 | warn | static | go | 0 | 142 | Strict; `EFFECT` is shown |
| SYG504 | error | static | go | 0 | 104 | Strict, removed form |
| SYG505 | warn | static | go | 0 | 135 | Strict; `event()` is shown |
| SYG506 | error | static | go | 0 | 112 | Strict, removed form |
| SYG507 | info | static | go | 0 | 127 | info, strict |
| SYG508 | warn | dev-entry, static | go | 163 | 241 | Strict; reply actions are the example |
| SYG509 | warn | static | go | 130 | 349 | Strict; `--fix` |
| SYG610 | error | runtime | go | 163 | 101 | Error, request not sent; fix shows `ok` / `error` |
| SYG611 | error | runtime | go | 121 | 63 | Error |
| SYG612 | error | dev-entry, static | go | 531 | 108 | Error, names the guide section |
| SYG620 | error | runtime | go | 25 | 0 | Error |
| SYG635 | warn | dev-entry | go | 664 | 0 | Writes the fix |
| SYG637 | warn | static | go | 0 | 132 | Static |
| SYG640 | warn | dev-entry, static | go | 19 | 0 | Says it found nothing in that view |
| SYG641 | error | dev-entry, static | go | 24 | 0 | Error |
| SYG643 | warn | dev-entry, static | go | 86 | 57 | Fires for connections too: the core's "without it nothing reports it" is stale |
| SYG670 | error | runtime | keep | 123 | 0 | Security, fires only in a browser against a hosted URL; stays in `llms/ai.md` |
| SYG691 | warn | static | go | 0 | 389 | Names the closest procedure |

## Appendix B: coverage by task

| Task | Facts | llms.txt inline | SKILL inline | Compact inline / +1 read | Index inline / +1 read | Compact: not reachable |
|---|---|---|---|---|---|---|
| 01-clear-completed | 6 | 100% | 100% | 100% / 100% | 83% / 100% |  |
| 02-collection-pin | 10 | 100% | 100% | 100% / 100% | 100% / 100% |  |
| 03-events-status | 7 | 100% | 100% | 100% / 100% | 100% / 100% |  |
| 04-derived-total | 7 | 100% | 100% | 100% / 100% | 86% / 100% |  |
| 05-driver-quote | 9 | 100% | 100% | 100% / 100% | 78% / 100% |  |
| 06-fix-add-button | 5 | 100% | 100% | 100% / 100% | 80% / 100% |  |
| 07-fix-remove-button | 10 | 100% | 100% | 100% / 100% | 100% / 100% |  |
| 08-extract-rating | 7 | 100% | 100% | 100% / 100% | 100% / 100% |  |
| 09-board-moves | 13 | 100% | 100% | 100% / 100% | 92% / 100% |  |
| 10-signup-wizard | 14 | 100% | 100% | 100% / 100% | 86% / 100% |  |
| 11-search-debounce | 14 | 100% | 100% | 100% / 100% | 86% / 100% |  |
| 12-selection-panel | 17 | 100% | 100% | 94% / 100% | 71% / 100% |  |
| 13-course-portal | 22 | 100% | 100% | 100% / 100% | 77% / 100% |  |
| 14-fix-support-inbox | 13 | 100% | 100% | 100% / 100% | 77% / 100% |  |
| 15-fix-reading-list | 14 | 100% | 100% | 100% / 100% | 86% / 100% |  |
| 16-split-checkout | 15 | 100% | 100% | 100% / 100% | 80% / 100% |  |
| 17-address-lookup | 14 | 93% | 100% | 100% / 100% | 86% / 100% |  |
| 18-ts-collection-pin | 13 | 100% | 100% | 100% / 100% | 62% / 100% |  |
| 19-ts-events-status | 15 | 100% | 100% | 93% / 100% | 60% / 100% |  |
| 20-ts-board-moves | 16 | 100% | 100% | 100% / 100% | 63% / 100% |  |
| 21-ts-selection-panel | 23 | 100% | 100% | 96% / 100% | 57% / 100% |  |
| 22-chat-socket | 11 | 100% | 100% | 100% / 100% | 91% / 100% |  |
| 23-quote-resource | 10 | 100% | 100% | 100% / 100% | 100% / 100% |  |
| 24-list-detail-cache | 20 | 100% | 100% | 100% / 100% | 70% / 100% |  |
| 25-router-spa | 25 | 100% | 100% | 100% / 100% | 32% / 100% |  |
| 26-autosave-draft | 21 | 100% | 100% | 100% / 100% | 86% / 100% |  |
| 27-undo-editor | 11 | 100% | 100% | 100% / 100% | 64% / 100% |  |
| 28-stopwatch | 11 | 100% | 100% | 100% / 100% | 64% / 100% |  |
| 29-accessible-signup | 12 | 92% | 100% | 100% / 100% | 92% / 100% |  |
| 30-checkout-form | 25 | 100% | 100% | 100% / 100% | 68% / 100% |  |
| 31-command-menu | 8 | 100% | 100% | 100% / 100% | 88% / 100% |  |
| 32-sales-chart | 12 | 100% | 100% | 100% / 100% | 67% / 100% |  |
| 33-virtual-list | 12 | 100% | 100% | 100% / 100% | 67% / 100% |  |
| 34-sortable-playlist | 11 | 100% | 100% | 100% / 100% | 82% / 100% |  |
| 35-pantry-search | 15 | 100% | 100% | 100% / 100% | 67% / 100% |  |
| 36-pantry-restock-rules | 24 | 100% | 100% | 100% / 100% | 63% / 100% |  |
| 37-pantry-remove-tabs | 24 | 100% | 100% | 100% / 100% | 63% / 100% |  |
| 38-pipeline-hold | 27 | 100% | 100% | 100% / 100% | 85% / 100% |  |
| 39-pipeline-stages | 21 | 100% | 100% | 100% / 100% | 81% / 100% |  |
| 40-pipeline-remove-log | 10 | 100% | 100% | 100% / 100% | 80% / 100% |  |
| 41-expenses-budgets | 45 | 100% | 100% | 100% / 100% | 40% / 100% |  |
| 42-expenses-drafts | 43 | 100% | 100% | 100% / 100% | 44% / 100% |  |
| 43-expenses-remove-settings | 45 | 100% | 100% | 100% / 100% | 40% / 100% |  |
| 44-streaming-chat | 18 | 94% | 89% | 78% / 100% | 67% / 100% |  |
| 45-packing-assistant | 23 | 96% | 91% | 83% / 100% | 74% / 100% |  |
| 46-ticket-triage | 23 | 91% | 87% | 74% / 100% | 65% / 100% |  |
| 47-board-agent-tools | 18 | 94% | 94% | 94% / 100% | 83% / 100% |  |
| 48-dashboard-goals | 7 | 100% | 100% | 86% / 100% | 71% / 100% |  |
| 49-session-card | 15 | 93% | 93% | 87% / 100% | 80% / 100% |  |
