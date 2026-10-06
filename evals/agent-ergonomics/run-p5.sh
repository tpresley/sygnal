#!/bin/zsh
# PLAN-5 eval package (D228): run from the repo root of the plan5-integration checkout.
#   zsh evals/agent-ergonomics/run-p5.sh opus|sonnet|haiku|s14
# Each model step: tier 30–34 (Sygnal + React), the forms A/B (task 30) and the toc skill arm (30–34).
# s14: the S-14 learn-time minimum on Opus (tiers 1–2 + ergo).
# Spends money: no --dry-run here. Add --dry-run to the ORCH line to preview.
set -e
cd "$(dirname "$0")/../.."
ORCH="node evals/agent-ergonomics/orchestrate.mjs --trials 5 --concurrency 4"
case "$1" in
  opus)   M=claude-opus-5-5 ;;
  sonnet) M=claude-sonnet-5-5 ;;
  haiku)  M=claude-haiku-4-5-20251001 ;;
  s14)
    eval $ORCH --run p5-s14-opus --variant p5-final --arms sygnal --tasks tier1,tier2,ergo --model claude-opus-5-5
    exit 0 ;;
  *) echo "usage: run-p5.sh opus|sonnet|haiku|s14"; exit 1 ;;
esac
eval $ORCH --run p5-final-$1       --variant p5-final       --arms sygnal,react --tasks p5 --model $M
eval $ORCH --run p5-f1-behavior-$1 --variant p5-f1-behavior --arms sygnal       --tasks 30 --model $M
eval $ORCH --run p5-f1-helpers-$1  --variant p5-f1-helpers  --arms sygnal       --tasks 30 --model $M
eval $ORCH --run p5-4s-toc-$1      --variant p5-4s-toc      --arms sygnal       --tasks p5 --model $M
