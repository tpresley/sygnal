# PLAN-6 eval runbook (4-E: the p6 tier 44–47, and the S-14 re-baseline)

Every command below except the checks calls the model and **costs money** (D295 budget: $90). Run them from your own terminal, one at a time, in a checkout of the integration branch with this tier merged, after:

```bash
npm ci && npm ci --prefix sygnal-check && npm run build      # the build every run packs; don't rebuild between or during runs
node evals/agent-ergonomics/verify.mjs --arm both --task 44,45,46,47   # free: 8 task/arm pairs, 16 mutants, ALL OK expected
```

Each run first makes one tiny `claude -p` preflight call (`--preflight` on a `--dry-run` makes only that call and prints the model the CLI resolves; add it if you want to see `claude-haiku-5-5` resolve before spending). Full model ids only. Each line is resumable: re-run the same command after an interruption or a usage-limit stop; scored trials are skipped.

## Runs

| # | Run | Command | Trials | Orchestrator estimate | Estimate from PLAN-5's p5 tier |
|---|---|---|---|---|---|
| 1 | `p6-final-opus` | `node evals/agent-ergonomics/orchestrate.mjs --run p6-final-opus --variant p6-final --arms sygnal,react --tasks p6 --trials 5 --concurrency 4 --model claude-opus-5-5 --preflight` | 40 | $10.77, ≈ 17 min | ≈ $17 ($0.43/trial, `p5-final-opus`) |
| 2 | `p6-final-sonnet` | `node evals/agent-ergonomics/orchestrate.mjs --run p6-final-sonnet --variant p6-final --arms sygnal,react --tasks p6 --trials 5 --concurrency 4 --model claude-sonnet-5-5 --preflight` | 40 | $4.83, ≈ 17 min | ≈ $6 ($0.15/trial, `p5-final-sonnet`) |
| 3 | `p6-final-haiku` | `node evals/agent-ergonomics/orchestrate.mjs --run p6-final-haiku --variant p6-final --arms sygnal,react --tasks p6 --trials 5 --concurrency 4 --model claude-haiku-5-5 --preflight` | 40 | unknown (no `claude-haiku-5-5` records yet), ≈ 21 min | ≈ $19 ($0.48/trial on Haiku 4.5, `p5-final-haiku`) |
| 4 | `p6-s14-opus` | `node evals/agent-ergonomics/orchestrate.mjs --run p6-s14-opus --variant p5-final --arms sygnal --tasks tier1,tier2,ergo --trials 5 --concurrency 4 --model claude-opus-5-5 --preflight` | 80 | $26.40, ≈ 35 min | ≈ $28 (`p5-s14b-opus`: $27.76) |
| | **Total** | | **200** | ≈ $42 + Haiku | **≈ $70** |

`--preflight` without `--dry-run` is the default behaviour (the preflight always runs); writing it is harmless. To see a plan again without spending, add `--dry-run` **literally** to the line (never through a shell variable).

- **Runs 1–3** (the p6 tier): `p6-final` is `branch` under its own name (this build, `skills/sygnal-dev`, starter 2), like `p5-final` for PLAN-5. Both arms. The React arm's starters pin `@ai-sdk/react` 4.0.140 + `ai` 7.0.137 (44–46) and `zod` 4.6.5 (45, 47).
- **Run 4** (G-632): the S-14 learn-time / peak-context re-baseline with the 6.1 checker. Same tasks and variant as `p5-s14b-opus` (`p5-final`: tiers 1–2 + `ergo`, Sygnal, Opus); the variant is resolved from this checkout, so it measures this build, this skill and this `sygnal-check` (SYG731's class-only tab findings included).

## After the runs

The orchestrator analyzes each run. Then:

```bash
# p6 tier: pass rates and the Sygnal-React gap, per model
node evals/agent-ergonomics/analysis/compare.mjs --base p6-final-opus:react   --next p6-final-opus:sygnal   --tasks p6 --metrics pass,wall,learn,peakContext,costUsd
node evals/agent-ergonomics/analysis/compare.mjs --base p6-final-sonnet:react --next p6-final-sonnet:sygnal --tasks p6 --metrics pass,wall,costUsd
node evals/agent-ergonomics/analysis/compare.mjs --base p6-final-haiku:react  --next p6-final-haiku:sygnal  --tasks p6 --metrics pass,wall,costUsd
# S-14: the 6.1 build against PLAN-5's (bar: learn time and peak context no more than about 10% worse)
node evals/agent-ergonomics/analysis/compare.mjs --base p5-s14b-opus --next p6-s14-opus --arms sygnal --tasks tier1,tier2 --metrics pass,wall,learn,peakContext,costUsd
node evals/agent-ergonomics/analysis/compare.mjs --base p5-s14b-opus --next p6-s14-opus --arms sygnal --tasks ergo --metrics pass,wall,learn,peakContext,costUsd
# operability of what the trials built (free, local qwen3:8b on Ollama; tasks 45 and 47, both arms)
node evals/agent-ergonomics/analysis/operability.mjs --run p6-final-opus --runs 3 --json /tmp/p6-operability-opus.json
```

S-14 references (`p5-s14b-opus`, matched means): `ergo` learn 9.7 s, peak 42.8k; tiers 1–2 learn 3.0 s (≈ 2 s on PLAN-4; within noise), peak ≈ 33.9k. More than about 10% worse on `ergo` learn or on peak context anywhere → trim the agent docs before release.

Classify failed trials (run.md step 5; `analysis/wiring.mjs --run <run>` prints a `score.mjs --classify` line per unclassified failure), then re-run `analyze.mjs` for that run. Commit `results/<run>.json`, `results/transcripts/<run>.tsv` and `results/analysis/<run>.{json,md}`.

## Resuming

- Interrupted (Ctrl-C, crash, sleep): run the same command again. Scored trials are skipped, finished-but-unscored trials are only scored, partial ones are moved aside and redone.
- Usage limit: the run pauses (5 m, 15 m, 30 m, 1 h) and retries; if the limit persists it stops with exit code 75 and prints the exact command that resumes it.
- Don't rebuild (`npm run build`) or change `skills/sygnal-dev` while a run is unfinished: the tarball / variant hash check refuses to resume (`--allow-mixed` overrides, but the run is then mixed).
