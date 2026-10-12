cd /private/tmp/claude-501/-Users-troy-Documents-Displera-sygnal--claude-worktrees-sygnal-ide-plugins-research-4d5a79/16598ae1-1255-4106-af91-d83f59d2ad98/scratchpad/d-genai
until [ -f logs/sweep1.done ]; do sleep 5; done
node evals/tools.mjs --so 2>logs/tools.log > logs/tools.md
node evals/run.mjs --set ext --models qwen3:8b --enc tree,tree+plan 2>logs/ext.log > logs/ext.md
node evals/run.mjs --set edits --models qwen3:8b --enc tree+plan --edit whole,ops 2>logs/edits.log > logs/edits.md
node evals/run.mjs --set a2-params --models qwen3:8b --enc tree,tree+plan 2>logs/a2params.log > logs/a2params.md
node evals/run.mjs --set a2-edits --models qwen3:8b --enc tree+plan --edit whole,ops 2>logs/a2edits.log > logs/a2edits.md
node evals/stream.mjs --models qwen3:8b --enc tree,tree+plan 2>logs/stream.log > logs/stream.md
echo done > logs/sweep2.done
