#!/bin/sh
# run.sh <work dir> [seconds]: IntelliJ IDEA (Community) + LSP4IJ against the I-2 fixture, with an
# isolated IDE home under <work dir>/idea (idea.properties: config, system, plugins and log paths), so
# the user's own JetBrains settings are never read or written.
#   - installs LSP4IJ into that plugins dir if it isn't there (`idea installPlugins`);
#   - writes the LSP4IJ server definition (UserDefinedLanguageServerSettings.xml) and its settings
#     (LanguageServersSettings.xml) into config/options, the server wrapped in ../lsp-tap.mjs;
#   - trusts the fixture (trusted-paths.xml);
#   - on a machine where no JetBrains IDE has been started, the IDE first shows its End User
#     Agreement and Data Sharing dialog: a person must answer it (an agent may not accept terms),
#     so give a long [seconds] for that first run;
#   - opens the fixture and src/C.jsx, waits [seconds] (default 60), then quits the IDE.
# Leaves <work dir>/idea-lsp.jsonl (LSP traffic) and <work dir>/idea/log/idea.log.
set -e
WORK="$1"; WAIT="${2:-60}"
[ -n "$WORK" ] || { echo "usage: run.sh <work dir> [seconds]" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$WORK"; WORK="$(cd "$WORK" && pwd)"
APP="${IDEA_APP:-/Applications/IntelliJ IDEA CE.app}"
IDE="$WORK/idea"; PROJ="$WORK/proj-idea"; LOG="$WORK/idea-lsp.jsonl"
mkdir -p "$IDE/config/options" "$IDE/system" "$IDE/plugins" "$IDE/log"
cat > "$IDE/idea.properties" <<EOF
idea.config.path=$IDE/config
idea.system.path=$IDE/system
idea.plugins.path=$IDE/plugins
idea.log.path=$IDE/log
EOF
cp "$APP/Contents/bin/idea.vmoptions" "$IDE/idea.vmoptions"
cat >> "$IDE/idea.vmoptions" <<EOF
-Didea.initially.ask.config=never
-Dide.show.tips.on.startup.default.value=false
EOF
export IDEA_PROPERTIES="$IDE/idea.properties" IDEA_VM_OPTIONS="$IDE/idea.vmoptions"
[ -d "$IDE/plugins/lsp4ij" ] || "$APP/Contents/MacOS/idea" installPlugins com.redhat.devtools.lsp4ij >"$IDE/install.log" 2>&1

sh "$HERE/../make-fixture.sh" "$PROJ" >/dev/null
rm -f "$LOG"
CMD="node $HERE/../lsp-tap.mjs $LOG npx --no-install sygnal-check lsp"
sed "s|@CMD@|$CMD|" "$HERE/UserDefinedLanguageServerSettings.xml" > "$IDE/config/options/UserDefinedLanguageServerSettings.xml"
cp "$HERE/LanguageServersSettings.xml" "$IDE/config/options/LanguageServersSettings.xml"
cat > "$IDE/config/options/trusted-paths.xml" <<EOF
<application>
  <component name="Trusted.Paths.Settings">
    <option name="TRUSTED_PATHS">
      <list>
        <option value="$WORK" />
      </list>
    </option>
  </component>
</application>
EOF

"$APP/Contents/MacOS/idea" "$PROJ" "$PROJ/src/C.jsx" >"$IDE/stdout.log" 2>&1 &
PID=$!
echo "IDE pid $PID; waiting $WAIT s"
sleep "$WAIT"
kill -TERM "$PID" 2>/dev/null || true
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
kill -0 "$PID" 2>/dev/null && { echo "IDE still running: SIGKILL"; kill -KILL "$PID"; }
echo "done; traffic in $LOG"
