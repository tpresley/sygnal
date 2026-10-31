# llms.txt: size versus effectiveness (spike, 2026-10-30)

**Question.** `llms.txt` grew to 322 lines and 84 KB (about 23k tokens). Its test capped lines, so later additions made lines longer: one line was 5 KB. The real question is the tradeoff between size and effectiveness: how well agents write correct Sygnal code from it. The `sygnal-dev` skill covers the same ground for Claude Code.

**Answer in brief.** Split the agent context into a **core** that every agent reads in full and **topic files** it reads when needed. The core keeps everything an ordinary app uses. The topic files hold the rarely used subpaths. The core gets a short index of the topic files at the top and a pointer at each place where material was removed.

The skill's `references/` folder holds the same topic files, generated from one source. The cap is now bytes, not lines.

**Measured** (Sonnet, no skill, 75 trials per arm): pass rate 64/75 against 66/75 for the old single file, within noise (−2.7 pp, 95% CI −13.9 to +8.5). Billed tokens fell 11%, wall time 13% and learn time 25%. 36 of 40 topic-task trials read the right topic file. Don't fork the context by model class, with one optional exception (see "Forks").

## Evidence

### What this repo already measured (strongest evidence: same tasks, same harness)

| Experiment | What changed | Result | Source |
|---|---|---|---|
| E5 (PLAN-3) | Slimmed the skill to 11.9 KB, moving the `t.*` test-helper facts out to `llms.txt` §7 | Peak context −13% and cost −8%, but failed runs rose from 0.29 to 0.75 per trial, and runs were slower on 10 of 11 tasks. Agents guessed `t.state` in 13 of 55 trials, against 2 of 85 in the control. **Dropped.** | `evals/agent-ergonomics/results/PHASE3-RESULTS.md` |
| D226 → D232 (PLAN-5 4-S) | Skill as a 13.4 KB table of contents plus 12 references, with the same facts | Peak context −12–17% and cost −11–17% on Opus, Sonnet and Haiku. Pass rate unchanged within noise. Haiku used the PLAN-5 APIs in 12 of 15 trials, against 1 of 15. | `dev-plans/PLAN-5-status.md` D232 |
| D235 (toc S-14) | The same toc skill, run on tiers 1–2 and the ergo tier on Opus | Tiers 1–2: peak −28%, cost −21%, but wall +25% and learn time 2.4 → 5.5 s. Ergo: peak −17%, cost −13%, wall unchanged. **The full skill shipped**, because learn time went up. | same, D235 |

What these show:
- Moving **commonly used** facts behind a link costs more than it saves (E5).
- Moving everything behind a table of contents cuts cost and context but adds lookup time (D235).
- Neither experiment moved **rarely used** material while keeping the hot path inline. That is the design here.

### External evidence (a research subagent's survey; each claim rated by strength)

- **Progressive disclosure is the documented pattern for skills.** Anthropic's skill authoring guidance:
  - Keep the SKILL.md body under 500 lines.
  - Link references one level deep, directly from SKILL.md. With nested links, Claude may only `head` a file.
  - Give a reference file over 100 lines a table of contents.
  - Keep mutually exclusive or rarely used material in separate files.
  - Sources: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices and https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills. **Moderate** (official guidance, no published eval).
- **Prefer a passive index to on-demand skills.** Vercel tested Next.js APIs that were not in training data:

  | Setup | Pass rate |
  |---|---|
  | No docs | 53% |
  | Skill, default behavior | 53% (the skill was never invoked in 56% of runs) |
  | Skill plus an explicit instruction to use it | 79% |
  | Compressed AGENTS.md *index* of doc paths (8 KB) | 100% |

  Source: https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals. **Moderate to weak** (a vendor eval with undisclosed size and model, but a large effect).

  This is why the index sits in the always-read core and the core says *where* each feature is documented. It is not left to the agent to discover the topic files.
- **Code examples carry most of the signal; descriptions and parameter lists carry little.** "When LLMs Meet API Documentation" tested 1,017 APIs:
  - Docs raised correct API use by 83–220%.
  - Removing the examples caused the largest drop, about −58% relative.
  - Removing parameter lists slightly *helped*.
  - Wrong examples get copied.

  Source: https://arxiv.org/abs/2503.15231. **Strong** for 7–32B models and GPT-4o-mini; frontier agents were not tested. For us this means keep the canonical examples inline and strict-checked, which `check-doc-samples` and the sample tests already do. It also means don't spend core bytes on option lists. The AI topic file now includes the skill's full composed-page example and its test.
- **Longer context hurts every model, even far below the window.**
  - Chroma's "Context Rot" (18 models): a focused prompt of about 300 tokens beat the full 113k-token prompt for every model. https://www.trychroma.com/research/context-rot (strong)
  - NoLiMa: most models fall below 50% of their short-context score by 32k tokens when the question and answer share no wording. https://arxiv.org/abs/2502.05167 (strong)
  - RULER: https://arxiv.org/abs/2404.06654 (strong)
  - "Lost in the Middle": the middle of a long context is recalled worst. https://arxiv.org/abs/2307.03172 (strong for 2023 models; weaker in newer ones)
- **Instruction capacity is limited, and small models collapse first.** IFScale (20 models):
  - The best model followed 68.9% of 500 simultaneous instructions.
  - gpt-4o-mini and claude-3.5-haiku followed about 10%.
  - Instructions late in a long list are dropped more often.

  Source: https://arxiv.org/abs/2507.11538. **Strong** for that task, and an approximation of coding rules.
- **Placement.** Anthropic recommends long documents at the top of the prompt and the question at the end ("up to 30%" better). https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices (moderate)

  For a reference file this means: put the directives (version, canonical forms, where things are) first, and keep the hard rules few and early.
- **The llms.txt convention.**
  - Required: an H1. Recommended: a blockquote summary, then H2 lists of `[name](url): notes` links. An `## Optional` section can be skipped. https://llmstxt.org/
  - `llms-full.txt` is a widely used convention (Mintlify, Anthropic's docs) but is not in the spec.
  - Svelte ships `llms.txt` (an index), `llms-small.txt`, `llms-medium.txt` and `llms-full.txt`. The only stated reason is context-window size, and no benchmark is published. https://svelte.dev/docs/llms
- **Cursor rules** (https://cursor.com/docs/context/rules): keep rules under 500 lines, split them into composable rules, give concrete examples, and reference files rather than copying them.
- **Context7** (retrieval of ranked snippets): Upstash reports about 65% fewer tokens. That is self-reported and measures cost, not success.
- **AGENTS.md**: gives no guidance on size.
- **Model-class differences.** The evidence is strong that *every* model degrades with length and that small models degrade faster. The evidence is **weak** that small models need a differently *shaped* context, rather than less of it and more explicit. I found no controlled study showing that small models fail to follow links to references.

## What moved, and why

The core keeps everything an ordinary app or eval task needs:
- the mental model and anatomy;
- every canonical example;
- `uses` behaviors and forms;
- commands, `ELEMENT`, timers and persistence;
- `defineWidget` basics and web components;
- HTTP and `resources` with their full rules;
- sockets and the router;
- the API facts, the xstream / RxJS table, the wiring rules and diagnostics;
- **all of §7 Testing.** That is the E5 lesson.

The topic files (`llms/<topic>.md`) hold the subpaths that few apps use. Each was moved verbatim by a script, so no fact changed:

| Topic file | From | Why it can move |
|---|---|---|
| `ai.md` | the `sygnal/ai` section (9 KB), plus the skill's composed-page example | Only AI features need it. The core keeps the `chat` behavior's canonical line and the API-key rule (SYG670). |
| `ui.md` | `sygnal/ui` parts, Menu / Select / Combobox, adapters, `sortable`, `<VirtualCollection>`, browser sources, library recipes | The core keeps a "never hand-roll these" line naming each API, so the agent knows it exists and where it is documented (the passive-index lesson). |
| `graphics.md` | islands, `sygnal/three`, `sygnal/canvas` (4 KB of one 5 KB line) | Experimental and specialized. |
| `typed-apis.md` | `sygnal/api` | Dev preview. |
| `collaboration.md` | `sygnal/yjs` | Experimental. |
| `renderers.md` | terminal, agent-ui, React Native, primitives, host, worker | Specialized. |
| `sandbox.md` | `sygnal/sandbox` | Dev preview. |
| `replay.md` | `sygnal/replay` | Dev preview. |

Each topic file begins with "It assumes the core", so it never re-teaches the anatomy.

### Sizes

Token counts use tiktoken `cl100k_base` as a proxy. Claude's tokenizer differs, but the ratios hold.

| File | Before | After |
|---|---|---|
| `llms.txt` (what every agent reads) | 84,249 B / 23,330 tok / 322 lines | **63,963 B / 17,594 tok** (−24%) |
| `llms/*.md` (on demand) | — | 32,401 B / 9,075 tok in 8 files (largest: `ai.md`, 14,170 B) |
| `llms-full.txt` (generated) | — | 96,232 B / 26,670 tok |
| `skills/sygnal-dev/SKILL.md` | 57,064 B / 15,882 tok / 444 lines | **52,652 B / 14,664 tok / 397 lines** (−8%) |
| skill `references/` (copies of `llms/`) | — | 8 files, the same bytes |

Before the split, the AI section alone was 11% of `llms.txt`. The material that moved was 26% of the file and about 5,700 tokens that every agent was paying for.

## How it is built and checked

- **Sources (hand-written):** `llms.txt` (the core, whose `## Topic files` index sits right after the summary) and `llms/<topic>.md`.
- **`node scripts/build-llms.mjs`** writes the copies:
  - `docs/public/llms.txt` and `docs/public/llms/*.md`, served at https://sygnal.js.org/llms/…
  - `llms-full.txt` and its docs copy: the core plus every topic, in index order
  - `skills/sygnal-dev/references/*.md`: byte-identical topic files

  The skill reaches the Claude Code plugin through the existing `editors/claude-code` symlink, which covers the whole directory.
- **npm ships** `llms.txt`, `llms/` and `llms-full.txt` (`package.json` `files`).
- **`test/llms-txt.test.js`** replaces the 322-line cap with these checks:
  - every copy is current (`stale()`);
  - core ≤ **64,500 B**;
  - each topic ≤ **16,000 B** and starts with the "assumes the core" header;
  - the index lists exactly the files in `llms/`;
  - the core body points at every topic;
  - the skill links every reference;
  - npm ships them.
- **Fragment tests** (`p4-4a1`, `p4-4g1`, `p6-4l`, `p9`) read the *corpus* (`test/helpers/agent-context.js`):
  - `llms-full.txt` for the llms side;
  - SKILL.md plus `references/` for the skill side.

  So a fact that moved to a topic file is still checked verbatim. The p9 test that runs the skill's composed-page blocks now finds them in `references/ai.md`.
- **`scripts/check-doc-samples.mjs`** also checks `llms/*.md`: 961 samples, all clean under `--strict`.
- **Budget choice.**
  - Bytes, not tokens, so the budget needs no tokenizer dependency. Bytes track tokens closely here: about 3.6 B per token in every file.
  - Not lines, because lines can be made arbitrarily long.
  - The core budget leaves about 0.5 KB of headroom on purpose. The next feature has to earn its core bytes or go in a topic file.
  - **Raised to 65,000 B (+500 B), 2026-10-30, with the maintainer's approval.** The Temper feedback fixes (round 3)
    used the last headroom (the core reached 64,495 B), and item 9 needed 146 B more in the testing lines: the
    `{ files: [file] }` init and `simulateAction`'s scope (the rendered component only; `{ component: Child }`; an
    unknown name fails the test). Rule for raises: only by what the addition needs, rounded up to the next 500 B,
    with no trimming of other content to make room. The core is 64,646 B after it.

## Effectiveness

### Zero-cost check (subscription-billed subagents)

**Setup.**
- 4 tasks × 2 arms, one trial each, run as Claude Code subagents on Sonnet 5.5 and scored by the harness. Records: `results/llms-ctx-spike-old.json` and `results/llms-ctx-spike-new.json`, `--method subagent`.
- Both arms used the same packed build. In **old**, `node_modules/sygnal/llms.txt` was replaced by the pre-split file and `llms/` and `llms-full.txt` were deleted.
- Neither arm had a skill: the prompt said "the sygnal-dev skill is not available … your references are the project's AGENTS.md and node_modules/sygnal". This is the case where only the layout of `llms.txt` matters.
- Each agent listed the `node_modules/sygnal` files it opened.

**Task choice.** Two tasks need a moved topic: 34 sortable-playlist (`ui.md`) and 44 streaming-chat plus 46 ticket-triage (`ai.md`). The other is a core regression guard: 23 quote-resource.

| Task | Arm | Hidden tests | `--strict` | Wall (s) | Context at end (tok) | Files read under `node_modules/sygnal` |
|---|---|---|---|---|---|---|
| 23 quote-resource | old | 7/7 | clean | 111 | 91.3k | llms.txt |
| 23 quote-resource | new | 7/7 | clean | 48 | 93.0k | llms.txt |
| 34 sortable-playlist | old | 6/6 | clean | 53 | 97.5k | llms.txt, guide/drag-and-drop.md |
| 34 sortable-playlist | new | 6/6 | clean | 41 | 97.9k | llms.txt, **llms/ui.md**, guide/drag-and-drop.md |
| 44 streaming-chat | old | 8/8 | clean | 59 | 111.5k | llms.txt, guide/ai-chat.md, agent.md |
| 44 streaming-chat | new | 8/8 | clean | 84 | 113.7k | llms.txt, **llms/ai.md**, guide/ai-chat.md, agent.md |
| 46 ticket-triage | old | 5/5 | clean | 113 | 135.1k | llms.txt, ai-decisions.md, recipes/ai-support-inbox.md, ai-chat.md (partial) |
| 46 ticket-triage | new | 5/5 | clean | 96 | 110.3k | llms.txt, **llms/ai.md**, ai-decisions.md, recipes/ai-support-inbox.md, resources.md, ai-chat.md |

**What this shows.**
- **No regression** at this sample size: 8 of 8 pass and all are strict-clean.
- **The index works.** Each new-arm agent on a topic task found and read the right topic file (3 of 3), without being told the files exist. The core-only task read nothing extra.
- Every agent also used the shipped guides the core and topic files link to, in both arms.
- **What it can't show.**
  - Sonnet 5.5 is at the ceiling on these tasks, so there is no pass-rate difference to see.
  - Wall time and context are single trials. The subagent's own system prompt (about 80k tokens) swamps the difference of about 5,700 tokens.
  - The wall times lean toward the new arm (3 of 4 faster), but n = 1 per cell. Measuring this properly is the paid plan's job.

### Paid eval: Sonnet no-skill pair (run 2026-10-30)

The maintainer approved the Sonnet pilot and the Sonnet no-skill pair, not the Opus pair, and ran them from their own terminal: the auto-mode classifier in this session refused paid commands even with an allow rule. Same build, same 15 tasks, 5 trials per task per arm, `claude-sonnet-5-5`, no skill, so the layout of `llms.txt` is the only difference. Runs: `llms-ctx-old-noskill-sonnet` (pre-split single file), `llms-ctx-new-noskill-sonnet` (core plus topic files); pilots `llms-ctx-pilot-{old,new}-noskill-sonnet` (tasks 34 and 46, 2 trials each: 4/4 in both arms, $0.78 and $0.66).

**Pass rate on the hidden tests (Wilson 95% intervals):**

| | Old: one file, 84 KB | New: core 64 KB + topics | New − old (Newcombe 95%) |
|---|---|---|---|
| All 15 tasks | 66/75 = 88.0% [78.7, 93.6] | 64/75 = 85.3% [75.6, 91.6] | −2.7 pp [−13.9, +8.5] |
| Topic tasks (31, 33, 34, 44–46, 48, 49) | 36/40 = 90.0% [76.9, 96.0] | 35/40 = 87.5% [73.9, 94.5] | −2.5 pp [−17.4, +12.3] |
| Core tasks (10, 11, 13, 23–25, 30) | 30/35 = 85.7% [70.6, 93.7] | 29/35 = 82.9% [67.3, 91.9] | −2.9 pp [−20.3, +14.7] |

The difference is two trials, well inside the noise. Per task, 13 of 15 tasks scored the same in both arms. The two that differ are 25 router-spa (4/5 → 3/5) and 45 packing-assistant (5/5 → 4/5), one trial each. The new arm's failures are the old arm's failure modes:
- 30 checkout-form, 1/5 in both arms: the order is never POSTed.
- 49 session-card, 2/5 in both: no card button.
- 25: "Leave" doesn't complete the navigation.
- 33: a form submission isn't prevented.

So 30 and 49 are task or doc gaps independent of the layout; they are worth their own look.

**Cost and effort (means per trial):**

| | Old | New | Change |
|---|---|---|---|
| Cost | $0.170 | $0.165 | −3% |
| Billed tokens | 237.8k | 211.1k | −11% |
| Peak context | 32.1k | 31.7k | −1% |
| Output tokens | 4,896 | 4,731 | −3% |
| Assistant turns | 9.9 | 9.0 | −9% |
| Tool calls | 9.7 | 8.5 | −12% |
| Wall time | 50.4 s | 43.9 s | −13% |
| Learn time | 10.5 s | 7.9 s | −25% |
| `sygnal-check` clean on the final code | 70/75 | 70/75 | same |

The core tasks gained the most: billed tokens −17%, turns 9.7 → 8.1, learn time 8.4 → 5.9 s. Peak context barely moved, because agents don't load `llms.txt` whole.

**Did agents find the topic files?** Counted from the transcripts. Agents mostly read the context with `cat`, `grep` and `sed` in Bash, not with the Read tool. The counter is a scratch script for now; it should move into `lib/transcript.mjs` (follow-up).
- Every trial in both arms opened `llms.txt`. It was read whole in 19/75 old trials and 30/75 new: the smaller file gets read whole more often.
- **New arm:** 36 of 40 topic-task trials read the matching topic file (`ui.md` for 31/33/34, `ai.md` for 44–49). No core-task trial opened a topic file. All 4 that didn't read the topic file passed anyway.
- **Old arm:** 4 of 40 topic-task trials found `llms/*.md` by listing the package. The control variant swaps only `llms.txt`, so the packed topic files were still there. This slightly favours the control.

**Real cost:** $26.56 in total (pilots $1.44, old arm $12.77, new arm $12.35), against the ≈ $32 estimate and the $45 limit.

**Verdict:** under the proposed rule:
- Topic tasks: 35 vs 36, within one trial.
- Core tasks: −1 trial overall, not more than one per task.
- Cost: down 3% per trial, and billed tokens down 11%.

The split passes the rule. It isn't a measurable quality gain on Sonnet; the gain is efficiency: fewer tokens, turns and seconds at the same pass rate.

**The Opus pair (≈ $87) is not worth running for this decision.** Sonnet already resolves the topic files 36/40 times, and both arms fail on the same tasks for reasons unrelated to the layout. A pass-rate difference of a few points would need several hundred trials per arm to detect. The open signal is cost and time, which Sonnet already shows. A Haiku or local-model run would answer the remaining question better, whether small models need an `llms-small.txt` (question 3), and is cheaper to pilot.

### Failure root causes and fixes (after the A/B)

Every failure was diagnosed against the trial's final code and the hidden test. None came from the layout of `llms.txt`. The maintainer approved these fixes:

| Task | Failures | Cause | Fix |
|---|---|---|---|
| 30 checkout-form | 8/10 | `form({ request })` added `progress: 'form.PROGRESS'` to every submit, and a progress request goes over XMLHttpRequest, so the test's stubbed `fetch` saw nothing. The app worked in a browser. | A JSON submit stays on `fetch`; progress is added only for a multipart submit or `progress: true` (`src/extra/form.ts`). |
| 49 session-card | 6/10 | The hidden test required an answered card to keep its buttons; removing them also meets the prompt ("can't be answered again"). | The hidden test now accepts removed or disabled buttons and clicks in the newest card. All 10 A/B trials pass it; `verify.mjs` is ALL OK. **So later runs of task 49 aren't directly comparable with these A/B numbers.** |
| 25 router-spa | 3/10 | The block was set in the hidden `EditPage` and the proceed sent from `App`; a block is keyed by its sender, so it outlived the proceed and caught the next link. | A forced navigation (a `proceed`) clears the block it overrode (`src/extra/router.ts`); docs: a block belongs to the component that set it. |
| 33 virtual-list | 2/10 | `DOM.submit(sel, { preventDefault: true })`: the shorthand dropped its second argument. | The shorthand passes options to `events()` (`src/core/runtime.ts`, types in `src/index.d.ts`). |
| 45 packing-assistant | 1/10 | `input: z.object({ packed })` with `(state, packed) => …` stored an object. Model slip. | One line in `llms/ai.md`: a tool reducer's data is the parsed input. |

### Paid eval plan (as written before the run)

The harness supports this as is. There are four variant specs in `evals/agent-ergonomics/variants/`; `tests/variant.unit.mjs` validates them.

| Variant | Skill | llms.txt in the package |
|---|---|---|
| `llms-ctx-old` | the skill at `6df80015` (before the split) | pre-split single file (`variants/llms-ctx/llms-old.txt`, applied with `afterInstall`) |
| `llms-ctx-new` | this branch's skill with `references/` | the new core plus topic files |
| `llms-ctx-old-noskill` | none | pre-split |
| `llms-ctx-new-noskill` | none | new |

All four use the same build. Only the context differs.

**The no-skill pair is the primary comparison.** There the layout of `llms.txt` alone decides what the agent learns. Claude Code users with the plugin get the skill, but every other agent (Cursor, Codex, a local model) gets only `llms.txt`.

**Tasks.**
- Topic-heavy tasks show whether agents find and use the topic files: 31 command-menu, 33 virtual-list, 34 sortable-playlist (`ui.md`); 44 streaming-chat, 45 packing-assistant, 46 ticket-triage, 48 dashboard-goals, 49 session-card (`ai.md`).
- Core tasks are the regression guard on the content that stayed: 10, 11, 13, 23, 24, 25, 30.
- That is 15 tasks.

**Trials and cost.** Five trials per task and arm on Opus 5.5 = 150 trials per pair. Past cost per trial (results/*.json, mean of both arms): Opus ≈ $0.36–0.67 (p5-s14 $0.36, p6-final $0.58, p9-final $0.56). Haiku 5.5's $1.51 per trial (p6-final-haiku) is too expensive to include.

| Run | Trials | Estimate |
|---|---|---|
| **Minimum:** no-skill pair, Opus | 150 | ≈ **$87** (the harness's `--dry-run` estimate is $43.42 per arm of 75 trials) |
| Skill pair, Opus | 150 | ≈ $85 |
| No-skill pair, Sonnet 5.5 ($0.20 per trial in p6-final), the mid-tier check | 150 | ≈ **$30** |

The runbook's rule applies to the Sonnet run: pilot 4–8 trials first and re-estimate from the pilot's cost.

**Measures.**
- Pass rate on the hidden tests.
- `sygnal-check --strict` clean on the final code.
- Peak context and cost per trial.
- Learn time.
- **Topic-file reads per trial.** `transcript-stats` already counts reads of skill `.md` files; reads of `node_modules/sygnal/llms/*.md` need a small addition to `lib/transcript.mjs`.

**Decision rule (proposed):** adopt the split if the topic tasks pass at least as often, the core tasks don't drop by more than one trial per task, and peak context or cost falls. That matches D228's "no lower pass rate" rule.

**Commands** (the coordinator runs them after approval; `--dry-run` first, literally):

```bash
node evals/agent-ergonomics/orchestrate.mjs --run llms-ctx-old-noskill --variant llms-ctx-old-noskill --arms sygnal --tasks 10,11,13,23,24,25,30,31,33,34,44,45,46,48,49 --trials 5 --model claude-opus-5-5 --dry-run
node evals/agent-ergonomics/orchestrate.mjs --run llms-ctx-new-noskill --variant llms-ctx-new-noskill --arms sygnal --tasks 10,11,13,23,24,25,30,31,33,34,44,45,46,48,49 --trials 5 --model claude-opus-5-5 --dry-run
```

## Forks by model class

**Proposed: none now. One optional fork if the Sonnet or Haiku runs justify it.** The evidence that every model needs *less*, and that small models need even less, is strong. The evidence that small models need a *different structure* is weak (see above).

The split already produces three sizes from one source, with no extra maintenance:
- the core alone, for agents that should follow the index;
- the core plus one topic, for an agent that follows a link;
- `llms-full.txt`, for one-shot tools that load a single file and cannot follow links (Context7-style indexers, a chat paste).

That is Svelte's layout (index, then medium, then full), with generated copies instead of hand-maintained ones.

The one fork worth considering is **`llms-small.txt` for small and local models**: the canonical examples and wiring rules only, about 15 KB. It would be generated by a section allowlist (`build-llms.mjs` keeping §1, §2, §3's code blocks, §5 and the §7 example), so it stays one source. I didn't build it, because:
- no evidence here shows that small models gain from the shape rather than the size;
- the harness's only local-model check is `analysis/operability.mjs` (Ollama qwen3:8b), and it measures operating an app, not writing one.

Open question 3 is about this.

## Open questions for the maintainer

1. **Run the Opus pair?** The Sonnet pilot and no-skill pair ran ($26.56): same pass rate within noise, 11% fewer billed tokens, 13% less wall time.
   *Recommendation:* no. Sonnet showed no pass-rate difference, and this decision doesn't need Opus to confirm efficiency. If anything, pilot Haiku for question 3. Separately, look into tasks 30 and 49, which fail in both arms.
2. **Is the core budget right?** It is 64,500 B, a 24% cut.
   *Recommendation:* keep it for 7.2. The next cut is worth measuring, not guessing. Candidates:
   - the 7.0 timing paragraph (§2, 2 KB, mostly upgrade guidance) → `llms/upgrading-6-to-7.md`;
   - Sockets' spec-key list (1.4 KB) → its guide;
   - the "More (guides)" link list;
   - the Router's SSR and Vike options.

   E5 says to cut nothing from §7 Testing.
3. **Build `llms-small.txt`?**
   *Recommendation:* not now. Add it only if a Haiku or local-model run shows the core is too long for them, and then generate it from section markers, never by hand.
4. **Should the index stay at the top of `llms.txt`?** It costs about 1.3 KB before the mental model.
   *Recommendation:* yes. The Vercel result says the pointer must be read for the content behind it to be used, and the start of a file is the most reliably read position.
5. **Should the skill split further**, moving the HTTP, resources, router and socket sections to references the way the D226 toc skill did?
   *Recommendation:* no. D235 measured that layout and chose the full skill: lookup time went up while pass rate stayed flat. This spike moves only what the core doesn't need.
6. **Should the topic files carry an `## Optional` section** (llmstxt.org) for their long option lists?
   *Recommendation:* not yet. Each file is at most 14 KB, and most are under 2 KB.
7. **Should the docs page `integration/agents` also tell users to put the index in `AGENTS.md`?** This follows Vercel's finding that a pointer in an always-loaded file beats a skill. The `create-sygnal-app` templates already point at `llms.txt`.
   *Recommendation:* yes, a one-line addition to the templates' AGENTS.md: "Feature topics: `node_modules/sygnal/llms/` (index at the top of llms.txt)". It is left out of this spike because it changes the templates and their release smoke tests.
