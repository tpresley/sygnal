#!/bin/sh
# I-1 run 4 (G-658 probe): run 1 plus settle-plugin, a PostToolUse hook that waits 300 ms after each Edit/Write.
# If the last edit's SYG110 now reaches the model, the drop in run 1 is the race between the server's publish and the
# attachment pass that follows the tool result; if not, the pass runs before PostToolUse hooks finish (or elsewhere).
# $1 = a fresh copy of ide-tooling-poc/fixture with sygnal-check in node_modules, $2 = output prefix.
cd "$1" || exit 1
claude -p "In src/C.jsx, first add the comment line // counter at the top of the file, then rename the model key INCREMNT to INCREMENT. Change nothing else. Don't run any commands." --model haiku --max-turns 6 --output-format stream-json --verbose --setting-sources project,local --strict-mcp-config --permission-mode acceptEdits --plugin-dir /Users/troy/Documents/Displera/sygnal/.claude/worktrees/sygnal-ide-plugins-research-4d5a79/editors/claude-code --plugin-dir /Users/troy/Documents/Displera/sygnal/.claude/worktrees/sygnal-ide-plugins-research-4d5a79/dev-plans/research/p7-spikes/I-1/settle-plugin --debug-file "$2.debug.log" > "$2.jsonl" 2> "$2.err"
echo "exit $?"
