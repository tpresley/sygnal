#!/bin/sh
# Inside the container (docker/README in ../README.md): build the three variants, generate the inputs,
# check that the three agree, and time them. /repo is the worktree (read-only), /work the
# native-tooling folder (read-write), /cache a named volume (cargo, target/, Go and npm caches, the
# npm parser install, the Go build dir, the generated inputs).
set -e
C=/cache
mkdir -p $C/npm-lite $C/inputs $C/go-build
echo "== versions"; node -v; go version; rustc --version; nproc
# JS lite: oxc-parser's linux-arm64 binary
[ -d $C/npm-lite/node_modules/oxc-parser ] || (cd $C/npm-lite && npm init -y >/dev/null && npm install --silent oxc-parser@0.156.0)
# Go: esbuild's parser copied into a build dir (as native-go/build.sh does)
rsync_go() { rm -rf $C/go-build/*; cp -R /work/native-go/main.go /work/native-go/go.mod /work/native-go/go.sum $C/go-build/; }
rsync_go
(cd / && go mod download github.com/evanw/esbuild@v0.25.12)
cp -R $GOMODCACHE/github.com/evanw/esbuild@v0.25.12/internal $C/go-build/internal && chmod -R u+w $C/go-build/internal
find $C/go-build/internal -name '*_test.go' -delete
find $C/go-build/internal -name '*.go' -exec sed -i 's#"github.com/evanw/esbuild/internal/#"sygnalnative/internal/#' {} +
(cd $C/go-build && go build -trimpath -ldflags='-s -w' -o $C/sygnal-native-go .)
# Rust
(cd /work/native-rust && cargo build --release --quiet)
cp $CARGO_TARGET_DIR/release/sygnal-native-rs $C/sygnal-native-rs
ls -la $C/sygnal-native-go $C/sygnal-native-rs
# inputs: the same generators as on the host
for spec in "synth500 500" "synth2000 2000"; do set -- $spec; [ -d $C/inputs/$1 ] || node /work/bench/gen-synthetic.mjs $C/inputs/$1 $2; done
for spec in "large20k 20000" "large100k 100000"; do set -- $spec; [ -d $C/inputs/$1 ] || node /repo/dev-plans/research/p7-spikes/0-A/gen-large.mjs $C/inputs/$1 $2; done
[ -d $C/inputs/plan5-showcase ] || cp -R /repo/examples/plan5-showcase/src $C/inputs/plan5-showcase
echo "== parity (lines; equal = identical sorted output)"
for d in plan5-showcase synth500 synth2000 large20k large100k; do
  node /work/lite/run-oxc.mjs $C/npm-lite $C/inputs/$d > $C/out-js-$d.txt
  $C/sygnal-native-go $C/inputs/$d > $C/out-go-$d.txt
  $C/sygnal-native-rs $C/inputs/$d > $C/out-rs-$d.txt
  echo "$d: js $(grep -c . $C/out-js-$d.txt) go $(grep -c . $C/out-go-$d.txt) rust $(grep -c . $C/out-rs-$d.txt)" \
    "js=go $(cmp -s $C/out-js-$d.txt $C/out-go-$d.txt && echo yes || echo NO) js=rust $(cmp -s $C/out-js-$d.txt $C/out-rs-$d.txt && echo yes || echo NO)"
done
echo "== in-process, warm (median of the repeats)"
for d in plan5-showcase synth500 synth2000 large20k large100k; do
  node /work/docker/warm-js.mjs $C/npm-lite $C/inputs/$d 9
  for j in 1 $(nproc); do
    echo "  go   -j $j: $($C/sygnal-native-go -j $j -time -repeat 9 $C/inputs/$d 2>&1 >/dev/null)"
    echo "  rust -j $j: $($C/sygnal-native-rs -j $j -time -repeat 9 $C/inputs/$d 2>&1 >/dev/null)"
  done
done
echo "== end to end, process included (median of 7)"
for d in plan5-showcase large20k large100k; do
  node /work/docker/e2e.mjs "$d" "node /work/lite/run-oxc.mjs $C/npm-lite $C/inputs/$d" "$C/sygnal-native-go $C/inputs/$d" "$C/sygnal-native-rs $C/inputs/$d" "$C/sygnal-native-go -j 1 $C/inputs/$d" "$C/sygnal-native-rs -j 1 $C/inputs/$d"
done
