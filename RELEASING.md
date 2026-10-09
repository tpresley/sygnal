# Releasing

This repository publishes three npm packages:

| Package | Folder | Depends on |
|---|---|---|
| `sygnal` | repository root | — |
| `sygnal-check` | `sygnal-check/` | — (reads source; doesn't import `sygnal`) |
| `create-sygnal-app` | `create-sygnal-app/` | its templates depend on `sygnal` and `sygnal-check` |

Publish them in the order below, so that each package's dependencies are on the registry before anything that installs them.

The steps use placeholders for the versions. Choose them first (the choice is the maintainer's; see the `[Unreleased]` entry in `CHANGELOG.md`, or the newest one, for what changed):

| Placeholder | Package | Last published |
|---|---|---|
| `<SYGNAL>` | `sygnal` | 6.0.0 |
| `<CHECK>` | `sygnal-check` | 0.2.0 |
| `<CSA>` | `create-sygnal-app` | 2.0.0 |

`sygnal-check` and `create-sygnal-app` get a new version whenever their folder changed since the last release (`git log v6.0.0.. -- sygnal-check create-sygnal-app`). In 6.0.0 both did: `sygnal-check` 0.2.0 added the accessibility lane and the 6.0 rules, and `create-sygnal-app` 2.0.0's templates moved to `sygnal` ^6.0.0.

## 1. Prepare

Start from the merged release commit on `main`, with a clean working tree:

```bash
git checkout main && git pull
git status                                  # must be clean
npm whoami                                  # must be the account that owns the packages
```

Set the versions (no `npm version`: it also commits and tags):

- `package.json`: `"version": "<SYGNAL>"`.
- `sygnal-check/package.json`: `"version": "<CHECK>"`.
- `create-sygnal-app/package.json`: `"version": "<CSA>"`.
- The template dependencies, in **every** one of these ten files:
  - `create-sygnal-app/template-vite/package.json`
  - `create-sygnal-app/template-vite-ts/package.json`
  - `create-sygnal-app/template-vite-pwa/package.json`
  - `create-sygnal-app/template-vite-pwa-ts/package.json`
  - `create-sygnal-app/template-vike/package.json`
  - `create-sygnal-app/template-vike-ts/package.json`
  - `create-sygnal-app/template-astro/package.json`
  - `create-sygnal-app/template-astro-ts/package.json`
  - `create-sygnal-app/template-mcp-app/package.json`
  - `create-sygnal-app/template-mcp-app-ts/package.json`

  set `"sygnal": "^<SYGNAL>"` under `dependencies` and `"sygnal-check": "^<CHECK>"` under `devDependencies`. A caret range on a 0.x version doesn't cross minors (`^0.1.0` never installs 0.2.0), so a new `sygnal-check` minor reaches new projects only through this bump. Check with:

  ```bash
  grep -n -E '"sygnal(-check)?":' create-sygnal-app/template-*/package.json
  ```
- `CHANGELOG.md`: rename `## [Unreleased]` to `## <SYGNAL> — <date>`, and fill in the "Measured impact" paragraph.
- `ROADMAP.md`: the release line names the template range (`sygnal` ^6.0.0); update it if it still describes the current release.

Commit these changes before running the gates.

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

All of them must pass. `npm test` needs the `sygnal-check` install above (the Vite plugin tests load it).

### Size gate

The gzipped kanban production bundle must stay within the agreed budget, **42,700 B** (D48; raised by D185, D222 and D230; `BUDGET` in `scripts/size-gate.mjs`):

```bash
node scripts/size-gate.mjs                  # --budget <bytes> to try another limit
```

It builds `examples/kanban` twice (it needs `npm run build` and `npm install --prefix examples/kanban` first) and prints both sizes:

- **(a), gated:** built with `sygnal({ nativeGlobalThis: false })`, so it keeps measuring the core plus xstream's original dependencies. It must be at or under the budget; the script exits non-zero otherwise.
- **(b), informational:** the default build, with the `globalthis` alias (about 4 KB smaller). This is what users get.

For reference, 6.0.0 measured (a) 42,690 B (10 B headroom) and (b) 38,679 B. Record both numbers in the release notes or PR.

## 3. Check the package contents

```bash
npm pack --dry-run
npm pack --dry-run --prefix sygnal-check ./sygnal-check
npm pack --dry-run --prefix create-sygnal-app ./create-sygnal-app
```

Expect:

- **`sygnal`**:
  - `dist/` with `index.{cjs,esm}.js`, a single bundled `dist/index.d.ts` (no `dist/cycle/` declarations), `sygnal.min.js`, the `jsx*`, `diagnostics`, `vite`, `astro` and `vike` entries, and their source maps;
  - `dist/vike/config/+config.js` with its `dist/vike/config/package.json` (`"type": "module"`), and no `+config.cjs.js`;
  - `dist/shims/globalthis.cjs` (the `sygnal/shims/globalthis` export used by the Vite plugin's alias);
  - `src/`, used for the sub-entry types such as `src/jsx.d.ts` and `src/vite/plugin.d.ts`;
  - `llms.txt`, `CHANGELOG.md`, `README.md`, `LICENSE` and `package.json`.
- **`sygnal-check`**: `bin/sygnal-check.js`, `src/` (including `model/` and `rules/`), `schema/inspect.schema.json`, `explanations.json`, `README.md`, `LICENSE` and `package.json`.
- **`create-sygnal-app`**: `index.js`, `README.md`, `LICENSE`, `package.json`, and all ten `template-*` folders. Each folder has an `AGENTS.md`, a `CLAUDE.md`, a `package.json` and a `*.test.*.tmpl` starter test.

## 4. Smoke check the templates before publishing

Run the smoke loop of step 7 against local tarballs, so a template problem is found before anything is on the registry. Pack the three packages into a scratch directory and install the scaffolder from its tarball (running `create-sygnal-app/index.js` from the repository fails: its own dependencies aren't installed there):

```bash
mkdir -p /tmp/sygnal-release/packs
npm pack --pack-destination /tmp/sygnal-release/packs
npm pack --prefix sygnal-check ./sygnal-check --pack-destination /tmp/sygnal-release/packs
npm pack --prefix create-sygnal-app ./create-sygnal-app --pack-destination /tmp/sygnal-release/packs
npm install --prefix /tmp/sygnal-release/csa /tmp/sygnal-release/packs/create-sygnal-app-<CSA>.tgz
```

Then, for each template, scaffold with `node /tmp/sygnal-release/csa/node_modules/create-sygnal-app/index.js <name> --template <t> --<lang> --no-install`, point its `sygnal` and `sygnal-check` dependencies at `file:/tmp/sygnal-release/packs/sygnal-<SYGNAL>.tgz` and `file:…/sygnal-check-<CHECK>.tgz`, `npm install`, and run the checks of step 7 (tests, `sygnal-check --strict`, `tsc` for TypeScript templates, build, Vike navigation).

## 5. Publish

Publish in this order:

```bash
# 1. sygnal-check first: the templates list it as a dev dependency.
npm publish --prefix sygnal-check ./sygnal-check

# 2. sygnal: prepublishOnly runs build:all again.
npm publish

# 3. create-sygnal-app last: its templates need sygnal@^<SYGNAL> and sygnal-check@^<CHECK>.
npm publish --prefix create-sygnal-app ./create-sygnal-app
```

If a publish fails partway through, fix the problem and publish only the packages that are missing. A published version can't be republished; bump its patch version instead.

**npm 11 staged publishes.** npm 11 stages each publish and takes a few minutes to process it, so `npm view <pkg> version` can still show the old version right after a successful publish, and `npx create-sygnal-app@latest` can still fetch the old scaffolder. Publishing the same version again during that window fails with E409 "previously staged"; that means the first publish worked, so wait instead of retrying. Wait until `npm view sygnal version`, `npm view sygnal-check version` and `npm view create-sygnal-app version` all show the new versions before the registry smoke check (step 7).

## 6. Tag

```bash
git tag v<SYGNAL>
git push origin v<SYGNAL>
```

Create the GitHub release from the tag, and use the `CHANGELOG.md` entry as its notes.

## 7. Smoke check from the registry

Scaffold every template from the published packages in a scratch directory outside the repository. Then run its tests, the static check in strict mode, a type check for the TypeScript templates and a production build:

```bash
mkdir -p /tmp/sygnal-smoke && cd /tmp/sygnal-smoke
for t in vite vite-pwa vike astro; do
  for lang in js ts; do
    npx --yes create-sygnal-app@latest "$t-$lang" --template "$t" --"$lang" --install < /dev/null
    (
      cd "$t-$lang" &&
      npm ls sygnal sygnal-check &&                  # <SYGNAL> and <CHECK>, from the registry
      npm test &&
      if [ "$t" = vike ]; then npx --no-install sygnal-check pages --strict; else npx --no-install sygnal-check --strict; fi &&
      if [ "$lang" = ts ]; then npx --no-install tsc --noEmit -p .; fi &&
      npm run build
    ) || echo "SMOKE FAILED: $t-$lang"
  done
done
```

Every project must install `sygnal` <SYGNAL> and `sygnal-check` <CHECK>. Each one's tests must pass, `sygnal-check --strict` must report nothing, `tsc --noEmit` must report nothing for the four TypeScript templates (the `vite build` of a TS template doesn't type-check, and the declarations are where type-level changes show up), and the build must succeed. `--no-install` makes sure that the check runs the copy the template installed, not a fresh download. Also check that `node_modules/sygnal/llms.txt` exists in one of the projects.

**Vike client navigation.** The unit tests don't cover hydration or client routing, so check both Vike templates in a browser. In `vike-js` and `vike-ts`, run `npm run preview` and open the printed URL:

1. On `/`, click **+** twice: the counter shows 2 (the page hydrated).
2. Click **About** in the nav: the About page renders, the URL is `/about`, and the page doesn't reload (the network panel shows no document request).
3. Click **Home**: the counter renders and **+** works again.
4. There is one nav bar (no duplicated Layout), and the browser console shows no errors or warnings (in particular none about `passToClient`).

This can be scripted with Playwright (`browser-tests/` has it installed): load the page, click, and assert on `.counter-display`, `h1` and a `window` flag set before navigating that would be lost by a full reload.

If a smoke check fails, fix the problem on `main` and publish a patch release of the affected package.
