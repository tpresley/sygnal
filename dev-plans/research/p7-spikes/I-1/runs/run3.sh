#!/bin/sh
# I-1 run 3: run 2's project (no sygnal-check) with the real plugin (editors/claude-code, its launcher), debug log on:
# the launcher's empty server should start once, log one stderr line, and give the model nothing; the skill still loads.
# $1 = a fresh copy of ide-tooling-poc/fixture with NO node_modules, $2 = output prefix.
cd "$1" || exit 1
claude -p "Fix the bug in src/C.jsx so clicking the + button increments the count. Don't run any commands." --model haiku --max-turns 6 --output-format stream-json --verbose --setting-sources project,local --strict-mcp-config --permission-mode acceptEdits --plugin-dir /Users/troy/Documents/Displera/sygnal/.claude/worktrees/agent-a736a514fd884b7dd/editors/claude-code --debug-file "$2.debug.log" > "$2.jsonl" 2> "$2.err"
echo "exit $?"
