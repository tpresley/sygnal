#!/bin/sh
# I-1 run 1: the plugin (editors/claude-code) with the real server (sygnal-check from p7-i1, packed and installed in the fixture copy), debug log on.
# The 0-S2 run-3 prompt: the first edit warms the server, the last leaves SYG110 in the edited file (G-658).
# $1 = a fresh copy of ide-tooling-poc/fixture with sygnal-check in node_modules, $2 = output prefix.
cd "$1" || exit 1
claude -p "In src/C.jsx, first add the comment line // counter at the top of the file, then rename the model key INCREMNT to INCREMENT. Change nothing else. Don't run any commands." --model haiku --max-turns 6 --output-format stream-json --verbose --setting-sources project,local --strict-mcp-config --permission-mode acceptEdits --plugin-dir /Users/troy/Documents/Displera/sygnal/.claude/worktrees/agent-a736a514fd884b7dd/editors/claude-code --debug-file "$2.debug.log" > "$2.jsonl" 2> "$2.err"
echo "exit $?"
