# Releasing

This repository publishes three npm packages:

| Package | Folder | Depends on |
|---|---|---|
| `sygnal` | repository root | — |
| `sygnal-check` | `sygnal-check/` | — (reads source; doesn't import `sygnal`) |
| `create-sygnal-app` | `create-sygnal-app/` | its templates depend on `sygnal` and `sygnal-check` |

Publish them in the order below, so that each package's dependencies are on the registry before anything that installs them. The steps use 5.4.0 (with `sygnal-check` 0.1.0 and `create-sygnal-app` 1.1.0) as the example; replace the versions for later releases.

## 1. Prepare

Start from the merged release commit on `main`, with a clean working tree:

```bash
git checkout main && git pull
git status                                  # must be clean
npm whoami                                  # must be the account that owns the packages
```

Check the versions:

- `package.json`: `5.4.0`.
- `sygnal-check/package.json`: `0.1.0`.
- `create-sygnal-app/package.json`: `1.1.0`.
- Every `create-sygnal-app/template-*/package.json` depends on `"sygnal": "^5.4.0"` and has the dev dependency `"sygnal-check": "^0.1.0"`.
- The `CHANGELOG.md` entry has the right date.

## 2. Install, build and run the gates

```bash
npm ci
npm ci --prefix browser-tests
npm install --prefix sygnal-check
npm ci --prefix docs
# each example has its own dependencies (examples/kanban links the root package)
for d in examples/*/; do [ -f "$d/package.json" ] && npm install --prefix "$d"; done

npm run build:all                           # clears dist/, then rollup bundles + bundled dist/index.d.ts
npm test                                    # vitest, example suites, type tests, browser tests
npm test --prefix sygnal-check
node scripts/check-doc-samples.mjs          # every doc/agent sample is strict-clean
node scripts/gen-error-docs.mjs --check     # error reference matches explanations.json
npm run build --prefix docs                 # docs site + link check
```

All of them must pass. `npm test` needs the `sygnal-check` install above (the Vite plugin tests load it). Then check the size gate: the gzipped kanban production bundle must stay within the agreed limit (42,300 B, D48):

```bash
node scripts/size-gate.mjs
```

It builds `examples/kanban` twice (needs `npm run build` and `npm install --prefix examples/kanban`) and prints both sizes. The gated number is the build with `sygnal({ nativeGlobalThis: false })`, so it keeps measuring the core plus xstream's original dependencies; the default build, with the `globalthis` alias (G-099), is reported for information. It exits non-zero when the gated number is over budget.

## 3. Check the package contents

```bash
npm pack --dry-run
(cd sygnal-check && npm pack --dry-run)
(cd create-sygnal-app && npm pack --dry-run)
```

Expect:

- **`sygnal`**:
  - `dist/` with `index.{cjs,esm}.js`, a single bundled `dist/index.d.ts` (no `dist/cycle/` declarations), `sygnal.min.js`, the `jsx*`, `diagnostics`, `vite`, `astro` and `vike` entries, and their source maps;
  - `src/`, used for the sub-entry types such as `src/jsx.d.ts` and `src/vite/plugin.d.ts`;
  - `llms.txt`, `CHANGELOG.md`, `README.md`, `LICENSE` and `package.json`.
- **`sygnal-check`**: `bin/sygnal-check.js`, `src/` (including `model/` and `rules/`), `schema/inspect.schema.json`, `explanations.json`, `README.md`, `LICENSE` and `package.json`.
- **`create-sygnal-app`**: `index.js`, `README.md`, `LICENSE`, `package.json`, and all eight `template-*` folders. Each folder has an `AGENTS.md`, a `CLAUDE.md`, a `package.json` and a `*.test.*.tmpl` starter test.

## 4. Publish

Publish in this order:

```bash
# 1. sygnal-check first: the new templates list it as a dev dependency.
cd sygnal-check && npm publish && cd ..

# 2. sygnal: prepublishOnly runs build:all again.
npm publish

# 3. create-sygnal-app last: its templates need sygnal@^5.4.0 and sygnal-check@^0.1.0.
cd create-sygnal-app && npm publish && cd ..
```

If a publish fails partway through, fix the problem and publish only the packages that are missing. A published version can't be republished; bump its patch version instead.

npm 11 stages each publish and takes a few minutes to process it, so `npm view <pkg> version` can still show the old version right after a successful publish. Publishing the same version again during that window fails with E409 "previously staged"; that means the first publish worked, so wait instead of retrying.

## 5. Tag

```bash
git tag v5.4.0
git push origin v5.4.0
```

Create the GitHub release from the tag, and use the `CHANGELOG.md` entry as its notes.

## 6. Smoke check from the registry

Scaffold every template from the published packages in a scratch directory outside the repository. Then run its tests, the static check in strict mode and a production build:

```bash
mkdir -p /tmp/sygnal-smoke && cd /tmp/sygnal-smoke
for t in vite vite-pwa vike astro; do
  for lang in js ts; do
    npx --yes create-sygnal-app@latest "$t-$lang" --template "$t" --"$lang" --install < /dev/null
    (
      cd "$t-$lang" &&
      npm ls sygnal sygnal-check &&                  # 5.4.0 and 0.1.0, from the registry
      npm test &&
      if [ "$t" = vike ]; then npx --no-install sygnal-check pages --strict; else npx --no-install sygnal-check --strict; fi &&
      npm run build
    ) || echo "SMOKE FAILED: $t-$lang"
  done
done
```

Every project must install `sygnal` 5.4.0 and `sygnal-check` 0.1.0. Each one's tests must pass, `sygnal-check --strict` must report nothing, and the build must succeed. `--no-install` makes sure that the check runs the copy the template installed, not a fresh download. Also check that `node_modules/sygnal/llms.txt` exists in one of the projects.

If a smoke check fails, fix the problem on `main` and publish a patch release of the affected package.
