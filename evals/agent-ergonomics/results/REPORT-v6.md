# Eval report v6: PLAN-6 (`sygnal/ai`)

Runs from 2026-10-09, launched by the maintainer from their terminal following
`P6-RUNBOOK.md`. Build: `plan6-integration` with the G-650 fix (`a80591f4`). Variant `p6-final`
(this build, `skills/sygnal-dev`, starter 2) for the new tier; `p5-final` for the S-14
re-baseline. Analysis: `analysis/compare.mjs`, `analysis/analyze.mjs`, with the transcripts in
`/tmp/sygnal-evals/trials/<run>`.

## Spend

| Run | Trials | Cost | Pre-run estimate |
|---|---|---|---|
| `p6-final-opus` | 40 | $23.32 | ≈ $11–17 |
| `p6-final-sonnet` | 40 | $7.81 | ≈ $5–6 |
| `p6-final-haiku` (`claude-haiku-5-5`) | 40 | $60.34 | ≈ $19 |
| `p6-s14-opus` | 80 | $27.19 | ≈ $26–28 |
| **Total** | **200** | **$118.66** | ≈ $70 (budget $90, D295) |

**Over budget by $28.66.** The Haiku estimate used Haiku 4.5's per-trial cost from PLAN-5. Haiku
5.5 costs about 3× that per trial in these tasks ($1.51 per trial on average against $0.48),
and there were no Haiku 5.5 records to estimate from. Future estimates should use a small pilot
(4–8 trials) for any model without records.

## 1. The new tier (tasks 44–47): Sygnal vs React

Tasks: 44 streaming chat (send, streaming draft, stop, error + retry); 45 an assistant operating an
existing app (client tools, consent before a removal); 46 ticket triage with a decision model and
escalation to chat; 47 make a board agent-operable through WebMCP. The React arm uses the AI SDK 7
(`useChat`, client tools) and WebMCP directly.

Matched means over the four tasks, 5 trials per task and arm:

| Model | Pass (R → S) | Wall | Cost | Peak context (k) | Learn (s) |
|---|---|---|---|---|---|
| Opus 5.5 | 100% → 100% | 85.6 → 91.6 s (1.07×) | $0.40 → $0.77 (1.93×) | 29.5 → 64.7 (+35.2) | 1.3 → 23.8 |
| Sonnet 5.5 | 95% → 100% | 31.5 → 52.5 s (1.67×) | $0.10 → $0.29 (3.05×) | 17.2 → 49.6 (+32.4) | 0 → 10.9 |
| Haiku 5.5 | 100% → 100% | 129.2 → 175.3 s (1.36×) | $1.22 → $1.80 (1.48×) | 70.4 → 103.0 (+32.7) | 0.4 → 83.6 |

- **Correctness:** Sygnal passed every trial on every model (60/60). React passed 59/60. Its one
  failure was Sonnet, task 47, trial 3: the confirmation dialog existed but the tests never found
  it open, an app-level timing defect, so it's classified `other`.
- **Cost of learning:** the Sygnal arm reads the skill (42.7 KB, every trial) and the AI guides
  (≈ 31 KB mean of `node_modules/sygnal` reads, against ≈ 8 KB for React's `ai`/`@ai-sdk/react`
  reads). The React arm relies on what the models already know about the AI SDK. Peak context is a
  near-constant **+32–35k** on all three models. PLAN-5's `mod` tier had a constant +19–20k, so
  the AI tasks add ≈ +13k of reading.
- Sygnal wrote less code on Opus and Haiku (LOC 0.75× and 0.83×). Sygnal trials always wrote a
  test (100%); Sonnet's React trials wrote one in 35%.

**What the extra reading was for.** Transcript search for reads of the built library code
(`dist/index.esm.js` in 10/20 Opus trials, `dist/ai.esm.js` in 9/20):

- **Tasks 44–45:** every such trial looked at `uiMessageStream`'s implementation to learn **what it
  POSTs** to the server (`messages`, `trigger`, `messageId`, how `body` / `transportOptions` are
  merged). The guide shows the server route but not the request body.
- **Task 47:** agents searched for the default WebMCP confirm dialog's markup ("Allow the AI agent…",
  Allow / Deny, `showModal`) to rely on it or test it. The guide doesn't describe that dialog's
  DOM.

Both are documentation gaps with a direct fix: G-651 and G-652 below.

## 2. S-14 re-baseline (G-632): the 6.1 build vs PLAN-5

Same tasks and variant as `p5-s14b-opus` (tiers 1–2 and `ergo`, Sygnal arm, Opus, 5 trials):

| Tasks | Pass | Learn (s) | Peak context (k) | Wall | Cost |
|---|---|---|---|---|---|
| tiers 1–2 (12 tasks) | 100% → 100% | 3.0 → 3.3 | 33.8 → 33.7 | 34.5 → 32.0 s | $0.312 → $0.301 |
| `ergo` (4 tasks) | 100% → 100% | 9.7 → 9.0 | 42.8 → 43.7 | 55.5 → 56.0 s | $0.453 → $0.456 |

**Within the bar** (no more than about 10% worse on learn time or peak context): PLAN-6 added
the AI sections to `llms.txt` and the skill without slowing work on the existing tasks. The
+0.3 s on tiers 1–2 is on a ≈ 3 s base, within PLAN-5's measured noise. SYG731's new findings on
the starters (G-632) didn't show up as extra work.

## 3. Operability

On the reference solutions, after the G-650 fix (`operability.mjs`, qwen3:8b, 3 runs): task 47
Sygnal 12/12, React 12/12; task 45 Sygnal 8/9, React 9/9. On the trials' own code:
`OPERABILITY_PENDING`.

## Gaps

| ID | Gap | Fix |
|---|---|---|
| G-651 | The chat guide doesn't document `uiMessageStream`'s request body (`id`, `messages`, `trigger`, `messageId`, `body` merge, `transportOptions`), so agents read the built code (tasks 44–45) | A request-body section in `guide/ai-chat.md` and one line in the skill / `llms.txt` |
| G-652 | The WebMCP guide doesn't describe the default confirm dialog's DOM (role, labelling, Allow / Deny, Escape) or how to test it | A section in `guide/webmcp.md` |
| G-653 | Haiku 5.5 cost ≈ 3× the Haiku 4.5-based estimate | Pilot a model without records before estimating a run |
