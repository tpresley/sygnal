# PLAN-6 Status Tracker

Tracks progress for [PLAN-6.md](PLAN-6.md) (`sygnal/ai`: LLM inference in apps, and apps that agents can operate). The coordinator maintains it.

**Numbering:** decisions continue from **D240** (D240–D250 below), gaps from **G-581**.

**Integration branch:** `plan6-integration`, cut from `plan6-plan` (`e3c86070`, = `main` `2d3569bf` + the research and the plan) on 2026-10-09, in the main checkout. Spikes run in agent worktrees on `exp/p6-s1` … `exp/p6-s5`.

**State:** Phase 0 running: 0-A done (below); spikes 0-S1…0-S5 running.

## Decisions

| # | Date | Decision |
|---|---|---|
| D240 | 2026-10-09 | One subpath, `sygnal/ai`, for everything in PLAN-6; transports needing a library take it as an optional peer (D209) |
| D241 | 2026-10-09 | WebMCP ships experimental (`experimentalExposeWebMcp`), tracks the draft, outside semver until the origin trial ends (Chrome 156) |
| D242 | 2026-10-09 | The static is `agent` (`{ name, description, read, actions }`); `sygnal-check` suggests it for `agents`/`tools`; `chat` and `commandBar` use the host's `agent` by default |
| D243 | 2026-10-09 | Docs transports split by guide: getting started / local / live examples on `openResponses()` + Ollama; production guides on an AI SDK server (`uiMessageStream()`) with an open-relay warning |
| D244 | 2026-10-09 | P6-Q1: release as 6.1.0 |
| D245 | 2026-10-09 | P6-Q2: `llms.txt` limit raised to 320 lines (+5) |
| D246 | 2026-10-09 | P6-Q3: eval tasks 35–38 with a React arm; spend asked for before any run |
| D247 | 2026-10-09 | P6-Q4: MCP Apps (X-1) in Phase 3 if time allows, otherwise 6.2 |
| D248 | 2026-10-09 | P6-Q5: transports wave 1 `uiMessageStream`, `openResponses`, `chatCompletions`, `chromePrompt`; wave 2 `anthropicMessages`, `agui`, `fromAISDK` |
| D249 | 2026-10-09 | P6-Q6: the `chat` behavior's tools are the host's and its live descendants' `agent` declarations by default; `agent: false` / `agent: [Comp, …]` narrows |
| D250 | 2026-10-09 | P6-Q7: WebMCP context = a read-only tool + a state summary in tool descriptions, re-registered on change |

## 0-A baseline (2026-10-09)

**Budgets** (measured on `plan6-integration` after `npm run build`):

| Budget | Value | Left for PLAN-6 |
|---|---|---|
| Core (kanban gzip, nativeGlobalThis false; gate 42,700 B, D230) | 42,690 B | **10 B**: PLAN-6 is designed for 0 core bytes |
| `llms.txt` | 313 lines | **7 lines** (limit 315 → 320, D245; the test change lands with Phase 4's sync) |
| SKILL.md | 42,100 B | no gate in tests; PLAN-5 held it at 42,100 B (D238) |

**Code reservations (§4):** SYG150–159, 240–249, 440–449, 670–679, 730–739 are all free in `src/extra/diagnostics/codes.ts` (checked 2026-10-09). Highest codes per lane: 149, 238, 302, 435, 508, 669, 724, 903.

**Experiments re-run on this build** (`research/llm-experiments/`, against local Ollama 0.40.2):

| Experiment | Result | Same as the research |
|---|---|---|
| 1: renders per 300-token reply | none / microtask 302; frame 22–24 (Anthropic, Responses, AI SDK bridge); tools, round trip, abort, latest pass | yes |
| 4: decisions through `makeFetchDriver` (`nimble`) | labels 10/10, urgency 6/10, 1 below 0.6; median 340 ms (cold 2.6 s: the model was loading) | yes |
| 5: decision command bar | 8/8 | yes |

**Eval spend estimate (D246; to be asked for before Phase 4 runs):** about **$55** for tasks 35–38, both arms, Opus and Haiku, from PLAN-5's 0-A estimate (≈ $70 for five tasks plus the forms A/B), and about **$28** for the S-14 learn-time check (`p5-s14b-opus` cost $27.76). The local-model operability check (task 38 and the reference solutions) costs nothing.

## Phases

| ID | Work | Status | Branch | Merge | Notes |
|---|---|---|---|---|---|
| 0-A | Baseline, decisions, reservations, experiments re-run, eval estimate | ✅ done | `plan6-integration` | 2026-10-09 | Above |
| 0-S1 | Streaming in the core (L-1, L-4) | 🔄 running | `exp/p6-s1` | | |
| 0-S2 | Agent layer on the runtime API (A-1, A-4), 0 core bytes | 🔄 running | `exp/p6-s2` | | |
| 0-S3 | WebMCP in a real browser (A-2, A-3) | 🔄 running | `exp/p6-s3` | | |
| 0-S4 | Schemas: `input` / `output` contract | 🔄 running | `exp/p6-s4` | | |
| 0-S5 | Live examples for AI docs | 🔄 running | `exp/p6-s5` | | |

## Gaps

| ID | Found in | Gap | Status |
|---|---|---|---|

## Log

- 2026-10-09 — PLAN-6 approved; P6-Q1…Q7 accepted as recommended (D244–D250). `plan6-integration` cut. 0-A done. Spikes 0-S1…0-S5 started in parallel worktrees.
