#!/bin/sh
# I-1 run 2: a project WITHOUT sygnal-check, the language server as the bare `npx --no-install sygnal-check lsp` (raw-npx-plugin, no launcher), debug log on:
# what Claude Code does when the server can't start (error shown? restarts? anything for the model?).
# $1 = a fresh copy of ide-tooling-poc/fixture with NO node_modules, $2 = output prefix.
cd "$1" || exit 1
claude -p "Fix the bug in src/C.jsx so clicking the + button increments the count. Don't run any commands." --model haiku --max-turns 6 --output-format stream-json --verbose --setting-sources project,local --strict-mcp-config --permission-mode acceptEdits --plugin-dir /Users/troy/Documents/Displera/sygnal/.claude/worktrees/agent-a736a514fd884b7dd/dev-plans/research/p7-spikes/I-1/raw-npx-plugin --debug-file "$2.debug.log" > "$2.jsonl" 2> "$2.err"
echo "exit $?"
