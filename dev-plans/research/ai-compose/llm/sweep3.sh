cd /private/tmp/claude-501/-Users-troy-Documents-Displera-sygnal--claude-worktrees-sygnal-ide-plugins-research-4d5a79/16598ae1-1255-4106-af91-d83f59d2ad98/scratchpad/d-genai
until [ -f logs/sweep2.done ]; do sleep 5; done
node evals/run.mjs --set a1-dashboard --models qwen3:8b --enc tree --shots 1 --tag a1dash-shots 2>logs/a1dash-shots.log > logs/a1dash-shots.md
node evals/run.mjs --set a1-ops --models qwen3:8b --enc tree --shots 1 --tag a1ops-shots 2>logs/a1ops-shots.log > logs/a1ops-shots.md
echo done > logs/sweep3.done
