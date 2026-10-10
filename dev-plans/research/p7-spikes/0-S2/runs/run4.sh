#!/bin/sh
# 0-S2 Claude Code run 4: run 3 with the server's debounce set to 0 (check synchronously on didChange). $1 = fresh fixture copy, $2 = output prefix.
cd "$1" || exit 1
SYGNAL_LSP_DEBOUNCE=0 claude -p "In src/C.jsx, first add the comment line // counter at the top of the file, then rename the model key INCREMNT to INCREMENT. Change nothing else. Don't run any commands." --model haiku --max-turns 6 --output-format stream-json --verbose --setting-sources project,local --strict-mcp-config --permission-mode acceptEdits --plugin-dir /Users/troy/Documents/Displera/sygnal/.claude/worktrees/agent-a295b898e6963fd00/dev-plans/research/p7-spikes/0-S2/claude-plugin > "$2.jsonl" 2> "$2.err"
echo "exit $?"
