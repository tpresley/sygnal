#!/bin/sh
# Build sygnal-native (Go) into ./bin. esbuild's parser packages are internal/ to its module, so
# copy them from the module cache into this module (import paths rewritten), uncommitted
# (.gitignore). Needs Go >= 1.24; downloads esbuild from the Go module proxy once.
#   sh build.sh [esbuild version, default v0.25.12]
set -e
here=$(cd "$(dirname "$0")" && pwd)
v=${1:-v0.25.12}
cache=${GOMODCACHE:-$(go env GOMODCACHE)}
(cd / && GOFLAGS=-mod=mod go mod download github.com/evanw/esbuild@$v)
src="$cache/github.com/evanw/esbuild@$v/internal"
rm -rf "$here/internal"
cp -R "$src" "$here/internal"
chmod -R u+w "$here/internal"
find "$here/internal" -name '*_test.go' -delete
find "$here/internal" -name '*.go' -exec sed -i.bak 's#"github.com/evanw/esbuild/internal/#"sygnalnative/internal/#' {} +
find "$here/internal" -name '*.bak' -delete
(cd "$here" && go build -trimpath -ldflags='-s -w' -o bin/sygnal-native .)
ls -la "$here/bin/sygnal-native"
