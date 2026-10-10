#!/bin/sh
# run.sh <work dir>: the I-2 Neovim checks, headless. For each settings mode (none, strict, init)
# it makes a fresh fixture (../make-fixture.sh), runs test.lua in `nvim --headless`, and leaves
#   <work dir>/nvim-<mode>.json    the test report (see test.lua)
#   <work dir>/nvim-<mode>.jsonl   the LSP traffic (lsp-tap.mjs)
# then prints a one-line verdict per step.
set -e
WORK="$1"
[ -n "$WORK" ] || { echo "usage: run.sh <work dir>" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
for MODE in none strict init; do
  PROJ="$WORK/proj-nvim-$MODE"
  sh "$HERE/../make-fixture.sh" "$PROJ" >/dev/null
  rm -f "$WORK/nvim-$MODE.jsonl" "$WORK/nvim-$MODE.json"
  ( cd "$PROJ" && SYGNAL_SETTINGS="$MODE" SYGNAL_TAP="$HERE/../lsp-tap.mjs" SYGNAL_TAP_LOG="$WORK/nvim-$MODE.jsonl" \
      SYGNAL_RESULT="$WORK/nvim-$MODE.json" SYGNAL_ROOT_B="$PROJ-b" \
      nvim --headless --clean -u "$HERE/init.lua" src/C.jsx +"luafile $HERE/test.lua" )
  sleep 1 # let the tap log the server's exit
  echo "== mode: $MODE"
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    for (const s of r.steps) console.log((s.ok ? "  ok   " : "  FAIL ") + s.name)
    const log = require("fs").readFileSync(process.argv[2], "utf8").trim().split("\n").map(JSON.parse)
    const ex = log.find(l => l.event === "exit")
    const m = log.filter(l => l.dir === "in" && l.msg.method).map(l => l.msg.method)
    console.log("  server exit:", ex ? `code ${ex.code}` : "not logged", "| shutdown:", m.includes("shutdown"), "| exit:", m.includes("exit"))
  ' "$WORK/nvim-$MODE.json" "$WORK/nvim-$MODE.jsonl"
done
