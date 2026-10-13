#!/bin/bash
# Adds this example's MCP server to Claude Desktop (macOS) as "sygnal-kindo-agents", over stdio.
#
# Claude Desktop keeps claude_desktop_config.json in memory and rewrites it while it runs, so an
# edit made while it is open is lost. This script quits Claude, waits for it to exit, adds the
# entry (keeping everything else, with a backup), and opens Claude again.
#
# Run it from macOS Terminal (not from a terminal inside Claude, which closes with it):
#   bash examples/mcp-kindo-agents/scripts/add-to-claude-desktop.sh
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
server="$here/server/server.js"
node_bin="$(command -v node)"
cfg="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
app_bin="/Applications/Claude.app/Contents/MacOS/Claude"

[ -f "$here/dist/index.html" ] || { echo "dist/index.html is missing: run npm run build in $here first"; exit 1; }

if pgrep -f "$app_bin" > /dev/null; then
  echo "Quitting Claude..."
  osascript -e 'tell application "Claude" to quit'
  for _ in $(seq 1 60); do pgrep -f "$app_bin" > /dev/null || break; sleep 0.5; done
  if pgrep -f "$app_bin" > /dev/null; then echo "Claude is still running; quit it (Cmd-Q) and run this again."; exit 1; fi
fi

[ -f "$cfg" ] && cp "$cfg" "$cfg.bak-sygnal-kindo"
"$node_bin" -e '
const fs = require("fs")
const [cfg, node, server] = process.argv.slice(1)
const c = fs.existsSync(cfg) ? JSON.parse(fs.readFileSync(cfg, "utf8")) : {}
c.mcpServers = { ...(c.mcpServers || {}), "sygnal-kindo-agents": { command: node, args: [server, "--stdio"] } }
fs.writeFileSync(cfg + ".tmp", JSON.stringify(c, null, 2))
fs.renameSync(cfg + ".tmp", cfg)
' "$cfg" "$node_bin" "$server"
echo "Added sygnal-kindo-agents ($node_bin $server --stdio)"

open -a Claude
echo "Claude is starting. In a chat, ask: Use run_kindo_agent to show my Kindo agents"
