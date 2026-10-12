cd /private/tmp/claude-501/-Users-troy-Documents-Displera-sygnal--claude-worktrees-sygnal-ide-plugins-research-4d5a79/16598ae1-1255-4106-af91-d83f59d2ad98/scratchpad/d-genai
until [ -f logs/sweep7.done ]; do sleep 5; done
curl -s localhost:11434/api/ps > logs/ps-before-latency.json
node evals/run.mjs --set base --models qwen3:8b --enc tree,tree+plan --tag base-latency 2>logs/base-latency.log > logs/base-latency.md
curl -s localhost:11434/api/ps > logs/ps-after-latency.json
echo done > logs/sweep8.done
