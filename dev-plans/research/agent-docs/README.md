# Agent docs: cutting the context Sygnal costs (spike, 2026-11-09)

**Question.** The agent context is `llms.txt` (66.5 KB), `SKILL.md` (56.2 KB) and ten topic files (54.5 KB). Sygnal trials carry +32–35k tokens of context over React and cost 1.3–3× more. How much of it has to be there before the first line, and how do the experimental subpaths stop loading it, without moving code out of the package?

**Limits of this spike.** No paid runs were made, so nothing here shows a pass-rate change; the proposal in section 7 would. Token counts are bytes ÷ 3.6 (the ratio the llms-context spike measured with cl100k_base). The trap verdicts and paragraph kinds are hand-assigned. The coverage table measures whether API names are present, not whether agents use them well. The root `npm test` gate was not run (other sessions are busy); `test/llms-txt.test.js`, the eval unit tests and the checks named below were.

## Recommendation (accept or reject)

| # | Do this | Evidence | Cost |
|---|---|---|---|
| 1 | Replace the core `llms.txt` with the **compact core** (21.7 KB, ⅓ of today), everything removed moved verbatim to on-demand topic files. | Fact coverage: 97.4% of what the 49 reference solutions use is inline, 100% within one read (today 99% / 100%). | Run §7 before it ships. E5 and D235 say a cut can cost more than it saves. |
| 2 | **Generate the skill from the same source** (22.4 KB against 56.2 KB). | The two files carry the same facts in two wordings: only 28–34% shares exact wording, 652 of the 1,064 distinct API names are in both, and no skill trial needs both. | With #1. |
| 3 | Put the **trigger index in `AGENTS.md`** (7.0 KB; passive, always in context). | Vercel: 100% against 53–79% for a skill; here the llms-context core index found the right topic in 36/40 trials. | Run §7 decides it against #1 alone. |
| 4 | Keep **option lists out of the core**, reachable by symbol: the types already answer them. Ship `sygnal-check docs <Symbol\|sygnal/x\|dir>`. | 88% of the API names in reference prose already sit in a JSDoc; about 23 KB of `llms.txt` is option-list sentences. `dist/index.d.ts` is 390 KB, so agents need a lookup, not more JSDoc. | Small; a prototype is in the folder. |
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
