cd /private/tmp/claude-501/-Users-troy-Documents-Displera-sygnal--claude-worktrees-sygnal-ide-plugins-research-4d5a79/16598ae1-1255-4106-af91-d83f59d2ad98/scratchpad/d-genai
node evals/run.mjs --set a1-dashboard --models qwen3:8b --enc tree,tree+plan,two 2>logs/a1dash-qwen.log > logs/a1dash-qwen.md
node evals/run.mjs --set a1-ops --models qwen3:8b --enc tree,tree+plan 2>logs/a1ops-qwen.log > logs/a1ops-qwen.md
node evals/run.mjs --set base --models llama3.2:latest,llama3.1:latest --enc tree,tree+plan,blocks 2>logs/base-llama.log > logs/base-llama.md
node evals/run.mjs --set base --models qwen3:8b --enc tree+plan --mode json --tag base-json 2>logs/base-json.log > logs/base-json.md
node evals/run.mjs --set base --models qwen3:8b --enc tree+plan --mode none --tag base-none 2>logs/base-none.log > logs/base-none.md
node evals/run.mjs --set base --models qwen3:8b --enc tree,tree+plan --think --tag base-think 2>logs/base-think.log > logs/base-think.md
node evals/run.mjs --set base --models qwen3:8b --enc tree,tree+plan --shots 1 --tag base-shots 2>logs/base-shots.log > logs/base-shots.md
echo done > logs/sweep1.done
