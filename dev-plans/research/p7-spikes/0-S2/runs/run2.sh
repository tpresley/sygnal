#!/bin/sh
# 0-S2 Claude Code run 2: as run 1, plus ENABLE_LSP_TOOL=1. $1 = a fresh copy of ide-tooling-poc/fixture, $2 = output prefix.
cd "$1" || exit 1
ENABLE_LSP_TOOL=1 claude -p "Fix the bug in src/C.jsx so clicking the + button increments the count. Don't run any commands." --model haiku --max-turns 6 --output-format stream-json --verbose --setting-sources project,local --strict-mcp-config --permission-mode acceptEdits --plugin-dir /Users/troy/Documents/Displera/sygnal/.claude/worktrees/agent-a295b898e6963fd00/dev-plans/research/p7-spikes/0-S2/claude-plugin > "$2.jsonl" 2> "$2.err"
echo "exit $?"
