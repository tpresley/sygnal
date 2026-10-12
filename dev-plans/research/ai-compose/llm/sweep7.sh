cd /private/tmp/claude-501/-Users-troy-Documents-Displera-sygnal--claude-worktrees-sygnal-ide-plugins-research-4d5a79/16598ae1-1255-4106-af91-d83f59d2ad98/scratchpad/d-genai
until [ -f logs/sweep6.done ]; do sleep 5; done
node evals/run.mjs --set a1-ops --models qwen3:8b --enc tree --shots auto --tag a1ops-autoshots 2>logs/a1ops-autoshots.log > logs/a1ops-autoshots.md
node evals/run.mjs --set base --models qwen3:8b --enc tree --shots auto --tag base-autoshots 2>logs/base-autoshots.log > logs/base-autoshots.md
echo done > logs/sweep7.done
