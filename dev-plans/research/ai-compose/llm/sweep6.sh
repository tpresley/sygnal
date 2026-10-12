cd /private/tmp/claude-501/-Users-troy-Documents-Displera-sygnal--claude-worktrees-sygnal-ide-plugins-research-4d5a79/16598ae1-1255-4106-af91-d83f59d2ad98/scratchpad/d-genai
until [ -f logs/sweep5.done ]; do sleep 5; done
node evals/run.mjs --set edits --models qwen3:8b --enc tree --edit ops2 --tag edits-ops2 2>logs/edits-ops2.log > logs/edits-ops2.md
node evals/run.mjs --set a2-edits --models qwen3:8b --enc tree --edit ops2 --tag a2edits-ops2 2>logs/a2edits-ops2.log > logs/a2edits-ops2.md
echo done > logs/sweep6.done
