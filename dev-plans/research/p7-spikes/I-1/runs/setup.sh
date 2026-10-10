#!/bin/sh
# I-1: the fixture copies the runs use. $1 = an empty scratch directory. Makes:
#   $1/fixture-base     ide-tooling-poc/fixture + package.json + sygnal-check from this branch (npm pack, installed), so
#                       `npx --no-install sygnal-check lsp` works there (runs 1 and 4 use copies of it)
#   $1/fixture-missing  the same fixture with no package.json and no node_modules (runs 2 and 3)
# Then: cp -R "$1/fixture-base" "$1/fx1" && sh run1.sh "$1/fx1" "$1/run1"   (a fresh copy per run)
set -e
repo=/Users/troy/Documents/Displera/sygnal/.claude/worktrees/sygnal-ide-plugins-research-4d5a79
mkdir -p "$1/pack" "$1/fixture-base" "$1/fixture-missing"
npm pack "$repo/sygnal-check" --pack-destination "$1/pack"
cp -R "$repo/dev-plans/research/ide-tooling-poc/fixture/." "$1/fixture-base/"
cp -R "$repo/dev-plans/research/ide-tooling-poc/fixture/." "$1/fixture-missing/"
printf '{\n  "name": "p7-i1-fixture",\n  "private": true,\n  "type": "module"\n}\n' > "$1/fixture-base/package.json"
npm install --prefix "$1/fixture-base" --no-audit --no-fund -D "$1"/pack/sygnal-check-*.tgz
ls "$1/fixture-base/node_modules/.bin/sygnal-check"
