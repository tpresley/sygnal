# PLAN-7 Status Tracker

Tracks progress for [PLAN-7.md](PLAN-7.md) (editor tooling: `sygnal-check lsp`, the VS Code extension, the Claude Code plugin). The coordinator maintains it.

**Numbering:** decisions continue from **D297** (D297–D304 below), gaps from **G-657**.

**Integration branch:** `plan7-integration`, cut on 2026-10-10 at `eb208337` (= `main` `b02eb715` merged into the research branch `claude/sygnal-ide-plugins-research-4d5a79` at `2831b13e`, + the research, the plan and D297–D304), in the worktree `.claude/worktrees/sygnal-ide-plugins-research-4d5a79`. `origin/main` had no newer commits at the cut. Spikes run in agent worktrees on `exp/p7-s1` … `exp/p7-s3`.

**State:** Phase 0 in progress (started 2026-10-10).

## Decisions

| # | Date | Decision |
|---|---|---|
| D297 | 2026-10-10 | P7-Q1: release as sygnal-check 0.4.0, create-sygnal-app 2.2.0, VS Code extension 0.1.0; `sygnal` 6.1.1 only for the Vite plugin's config default (D299); N- items as sygnal-check 0.5.0 / extension 0.2.0 |
| D298 | 2026-10-10 | P7-Q2: the server lives in `sygnal-check` as `sygnal-check lsp`, hand-written like `mcp`; `dependencies` stay `@babel/parser` only; a client library checks conformance in tests |
| D299 | 2026-10-10 | P7-Q3: a shared JSON config (`sygnal-check.config.json` or the `package.json` `"sygnal-check"` key) read by the CLI, MCP, the server, and as the default of the Vite plugin's `check` option |
| D300 | 2026-10-10 | P7-Q4: extension id `sygnal.sygnal` (publisher `sygnal` or the user's existing one), source in `editors/vscode/`, `vscode-languageclient` bundled in the `.vsix`; Marketplace + Open VSX; the user owns the publisher accounts and publishes |
| D301 | 2026-10-10 | P7-Q5: the extension runs the workspace's `sygnal-check` first, the bundled copy as a visible fallback |
| D302 | 2026-10-10 | P7-Q6: navigation and completions (N-1/N-2) are gated after Phase 2, on 0-S3's estimate and first-release feedback |
| D303 | 2026-10-10 | P7-Q7: E-1 runs on Haiku and Sonnet after the release point, spend approved first; the plugin goes into agent docs only on ≥ 20% fewer failed runs or iterations with no pass-rate loss |
| D304 | 2026-10-10 | P7-Q8: the Claude Code plugin ships the LSP server and the `sygnal-dev` skill; the MCP server is not enabled by default |

## Phase tracker

| Item | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 0-A | Baseline: integration branch, this file, PoC + bench re-run, large-project fixture, E-1 spend estimate | ✅ | `plan7-integration` | — | Below: [0-A results](#0-a-results) |
| 0-S1 | Ranges audit per rule | running | `exp/p7-s1` | | report → `research/p7-spikes/0-S1.md` |
| 0-S2 | Client capability matrix (VS Code, Claude Code; Neovim/Helix/LSP4IJ from docs, not installed) | running | `exp/p7-s2` | | report → `research/p7-spikes/0-S2.md` |
| 0-S3 | Positions for N-1/N-2: estimate | running | `exp/p7-s3` | | report → `research/p7-spikes/0-S3.md` |

## 0-A results

**PoC re-run** on `plan7-integration` (sygnal-check 0.3.0): unchanged behaviour. 3 findings on open, hover with SYG110's explanation, `Change to '.inc'`, 0 findings after the unsaved fix; 3–24 ms per check on the fixture.

**Large-project fixture:** [`research/p7-spikes/0-A/gen-large.mjs`](research/p7-spikes/0-A/gen-large.mjs) copies the kanban, plan5-showcase and ai-panel-spa `src/` trees (tests excluded) round-robin to a target size; generated on demand, not committed. [`bench-latency.mjs`](research/p7-spikes/0-A/bench-latency.mjs) measures a whole-project check (cold = first check in the process; warm = median). Apple M3 Max, Node 24.14.0, `--strict`:

| Project | Files | Lines | Cold | Warm | Warm: build (parse + model) | Warm: rules |
|---|---|---|---|---|---|---|
| examples/kanban | 5 | 1.1k | 27 ms | 8 ms | 4 ms | 4 ms |
| examples/ai-panel-spa | 13 | 2.0k | 53 ms | 26 ms | 12 ms | 15 ms |
| examples/plan5-showcase | 50 | 2.2k | 82 ms | 45 ms | 18 ms | 27 ms |
| generated, 14 copies | 327 | 20.8k | 427–437 ms | 345–362 ms | 134–140 ms | 214–223 ms |
| generated, 34 copies | 753 | 50.3k | 993 ms | 870 ms | 321 ms | 549 ms |

Without `--strict` the 20k project is the same within noise (379 ms warm). The process start plus import plus one check of the 20k project is 0.50–0.51 s wall.

Findings:
1. **Linear scaling, ≈ 17 ms per 1k lines warm, of which ≈ 11 ms is rules.** C-3's parse cache removes most of the build share on a one-file edit, so the 20k project should re-check in ≈ 230 ms, within the planned **≤ 300 ms** gate. Cold start (≈ 0.5 s) is far inside **≤ 2 s**. Keystroke to diagnostics, with a 150 ms debounce, should be ≈ 380 ms, inside **≈ 500 ms**. The §3 numbers stand; 0-A fixes them as the gate's starting limits.
2. **Rules alone pass 300 ms at about 27k lines** (550 ms at 50k). Beyond that, PLAN-7 §6's mitigation applies (scope per-component rules to the changed files' components). Not built speculatively.
3. **A check blocks Node's event loop for its whole duration** (≈ 360 ms at 20k). Hover, code-action and completion requests that arrive mid-check would wait. Proposed amendment to L-1: run checks in a `worker_thread` (the main thread keeps the documents and answers requests from the last results), or at least check `$/cancelRequest` and pending changes between files. Decide in Phase 2 with 0-S2's client behaviour; recorded as **G-657**.

**E-1 spend estimate** (asked for again before any run, D303; the costs per trial are from REPORT-v5/v6, Sygnal arm):

| Model | Tasks | Trials | Cost per trial | Estimate |
|---|---|---|---|---|
| Sonnet 5.5 | tier 1 (01–08) + 14 | 9 tasks × 5 × 2 variants = 90 | ≈ $0.15–0.22 | $14–20 |
| Sonnet 5.5 | 44–47 | 4 × 5 × 2 = 40 | ≈ $0.29 | ≈ $12 |
| Haiku 5.5 | pilot (G-653: no Haiku 5.5 records on tier 1) | 8 | unknown, ≈ $0.8–1.5 | $6–12 |
| Haiku 5.5 | tier 1 + 14, 3 trials | 9 × 3 × 2 = 54 | ≈ $0.8–1.5 (pilot decides) | $43–81 |
| Haiku 5.5 | 44–47, `e1-lsp` only (control: the 20 Sygnal trials of `p6-final-haiku` on the PLAN-6 final build; reuse only if the `e1-lsp` build differs from it in sygnal-check alone) | 20 | ≈ $1.80 | ≈ $36 |
| **Total** | | **212** | | **≈ $111–161** |

Cheaper variants if needed: Sonnet only (≈ $26–32), or Haiku only on the debug tasks 06, 07, 14 (≈ $15–27). The run happens in Phase 3, after the release point.

## Gaps

| # | Found | Severity | Area | Gap | Status |
|---|---|---|---|---|---|
| G-657 | 0-A | med | L-1 | A whole-project check blocks the server's event loop (≈ 360 ms at 20k lines), delaying hover/code actions/completions | Open → Phase 2 (worker thread or cancellable checks) |

## Log

- 2026-10-10: Phase 0 started. `plan7-integration` cut at `eb208337`. 0-A done (above). Spikes 0-S1, 0-S2 and 0-S3 started in agent worktrees. Neovim, Helix and JetBrains IDEs aren't installed here, so 0-S2 drives VS Code and Claude Code and documents the others from their docs.
