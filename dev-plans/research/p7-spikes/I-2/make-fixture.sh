#!/bin/sh
# make-fixture.sh <dir>: the I-2 test project. A copy of ide-tooling-poc/fixture plus
#   src/E.jsx            a strict-only finding (emit() → SYG505) for the workspace/configuration test
#   src/F.jsx            selects 'WENTT', a near miss of E.jsx's 'WENT': a SYG105 pair with relatedInformation
#   package.json         "dependencies": { "sygnal": "*" } (not installed: the checker doesn't need it)
#   sygnal-check.config.json  { "strict": false }
#   node_modules/sygnal-check  this branch's sygnal-check, from `npm pack` (so `npx --no-install sygnal-check lsp` works)
# A second folder <dir>-b (a plain copy of the fixture) is made for the multi-root tests.
set -e
DIR="$1"
[ -n "$DIR" ] || { echo "usage: make-fixture.sh <dir>" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
FIX="$REPO/dev-plans/research/ide-tooling-poc/fixture"
rm -rf "$DIR" "$DIR-b" "$DIR.pack"
mkdir -p "$DIR" "$DIR-b" "$DIR.pack"
cp -R "$FIX/." "$DIR/"
cp -R "$FIX/." "$DIR-b/"
cat > "$DIR/src/E.jsx" <<'EOF'
import { emit } from 'sygnal'
function Emitter({ state }) {
  return <button className="go">{state.n}</button>
}
Emitter.initialState = { n: 0 }
Emitter.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
Emitter.model = { GO: emit('WENT', (state) => state.n) }
export default Emitter
EOF
cat > "$DIR/src/F.jsx" <<'EOF'
function Listener({ state }) {
  return <span>{state.seen}</span>
}
Listener.initialState = { seen: 0 }
Listener.intent = ({ EVENTS }) => ({ SEEN: EVENTS.select('WENTT') })
Listener.model = { SEEN: (state) => ({ ...state, seen: state.seen + 1 }) }
export default Listener
EOF
echo '{ "strict": false }' > "$DIR/sygnal-check.config.json"
echo '{ "strict": false }' > "$DIR-b/sygnal-check.config.json"
# install the tarball before declaring the sygnal dependency, so npm fetches nothing else
echo '{ "name": "i2-fixture", "private": true }' > "$DIR/package.json"
npm pack "$REPO/sygnal-check" --pack-destination "$DIR.pack" >/dev/null 2>&1
npm install --prefix "$DIR" --no-save --no-package-lock --no-audit --no-fund "$DIR.pack"/sygnal-check-*.tgz >/dev/null
echo '{ "name": "i2-fixture", "private": true, "type": "module", "dependencies": { "sygnal": "*" } }' > "$DIR/package.json"
echo '{ "name": "i2-fixture-b", "private": true, "type": "module", "dependencies": { "sygnal": "*" } }' > "$DIR-b/package.json"
rm -rf "$DIR.pack"
echo "fixture: $DIR (and $DIR-b)"
