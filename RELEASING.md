# Releasing

This repository publishes three npm packages:

| Package | Folder | Depends on |
|---|---|---|
| `sygnal` | repository root | — |
| `sygnal-check` | `sygnal-check/` | — (reads source; doesn't import `sygnal`) |
| `create-sygnal-app` | `create-sygnal-app/` | its templates depend on `sygnal` and `sygnal-check` |

They are published in the order below, so that each package's dependencies are on the registry before anything that installs them.

Two editor integrations ship from this repository too, outside npm (PLAN-7). Release them after `sygnal-check` (they run its language server): the VS Code extension (`editors/vscode/`, [§8](#8-the-vs-code-extension-editorsvscode)) and the Claude Code plugin (`editors/claude-code/`, [§9](#9-the-claude-code-plugin-editorsclaude-code)).

The steps use placeholders for the versions. Choose them first (the choice is the maintainer's; see the `[Unreleased]` entry in `CHANGELOG.md`, or the newest one, for what changed):

| Placeholder | Package | Last published |
|---|---|---|
| `<SYGNAL>` | `sygnal` | 6.4.0 |
| `<CHECK>` | `sygnal-check` | 0.8.1 |
| `<CSA>` | `create-sygnal-app` | 2.6.0 |

`sygnal-check` and `create-sygnal-app` get a new version whenever their folder changed since the last release (`git log v6.4.0.. -- sygnal-check create-sygnal-app`). In 6.0.0 both did: `sygnal-check` 0.2.0 added the accessibility lane and the 6.0 rules, and `create-sygnal-app` 2.0.0's templates moved to `sygnal` ^6.0.0.

## How a release runs

Publishing is done by GitHub Actions, with no stored credentials (`.github/workflows/release.yml`):

1. **You prepare the release** (§1): version bumps, template ranges, changelog entries, committed to `main` (pushed directly or merged from a pull request).
2. **The Release workflow starts** when one of the five version files changes on `main`: `package.json`, `sygnal-check/package.json`, `create-sygnal-app/package.json`, `editors/vscode/package.json`, `editors/claude-code/.claude-plugin/plugin.json`. Its `plan` job (`scripts/release-plan.mjs`) lists which versions aren't published yet; when none is new, the run ends there.
3. **The gates run** (`.github/workflows/gates.yml`, the same as CI on every pull request): `npm test`, `sygnal-check`, the docs samples and error reference, the docs build and live demos in Chromium, Firefox and WebKit, the size gate, the extension gate in a downloaded VS Code, and every template from this commit's tarballs (§2–§4).
4. **You approve.** The `publish` job uses the environment `release` (deployments from `main` only, required reviewer: the maintainer): GitHub asks you to review the deployment (a notification, or Actions → the run → Review deployments).
5. **It publishes what is new**, in order: `sygnal-check`, `sygnal`, `create-sygnal-app` (npm trusted publishing: OIDC, provenance attached), the tag `v<SYGNAL>` and its GitHub release (notes from `CHANGELOG.md`), the extension to the Marketplace (Microsoft Entra ID) and Open VSX (trusted publishing) from the `.vsix` the gates built, the tag `vscode-v<version>` with the `.vsix` attached, and the plugin's tag `sygnal--v<version>`.
6. **The registry smoke check runs** (§7): every template from the published packages. A failure fails the run, and GitHub notifies you.

A release of one package (a `sygnal-check` patch, an extension-only release) is just that package's version change. Re-running a failed run publishes only what is still missing (`--skip-duplicate` for the extension registries).

**Dry run.** Actions → Release → Run workflow (from `main`; "Dry run" is checked by default) runs the plan with every target counted as new, the gates, and after your approval `npm publish --dry-run` (`npm pack --dry-run` for a version npm already has: the registry refuses even a dry run over a published version) and `vsce verify-pat --azure-credential` (the Marketplace sign-in); it uploads and tags nothing. A dry run doesn't sign in to npm, so the first real release is the first test of npm's trusted publishing. Use it after changing the workflow or the trust setup.

**Run locally.** `node scripts/release-plan.mjs` prints what a release of this checkout would publish; `node scripts/release-smoke.mjs --local | --registry` runs the template smoke checks (§4, §7).

### One-time setup (the maintainer's accounts)

The trust is pinned to the workflow file `release.yml` and the environment `release` on every registry; nothing else can publish.

- **GitHub:** the environment `release` (Settings → Environments): required reviewer `tpresley`, deployment branches `main`. Its variables `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` (identifiers, not secrets) name the Marketplace identity below.
- **npm, for each of `sygnal`, `sygnal-check`, `create-sygnal-app`:** the package's Settings → Trusted publishing → GitHub Actions: owner `tpresley`, repository `sygnal`, workflow `release.yml`, environment `release`, and allow `npm publish`. A new trusted publisher that hasn't published within 2 days expires, so add it shortly before a release (and recreate it if it expired; it can't be edited). After the first release through it, set Settings → Publishing access → "Require two-factor authentication and disallow tokens", and delete any old automation tokens. Needs npm ≥ 11.5.1 on the runner (Node 24; the workflow checks it).
- **Open VSX:** open-vsx.org → Settings → Trusted Publishers → the extension `sygnal.sygnal` → GitHub Actions: `tpresley` / `sygnal` / `release.yml` / environment `release`. Delete the old access tokens (a token set as `OVSX_PAT` would take precedence).
- **VS Code Marketplace** (§8): a Microsoft Entra app registration trusted by GitHub for this environment, added to the publisher `sygnal` as Contributor. Until `AZURE_CLIENT_ID` is set, releases skip the Marketplace with a warning. Global Azure DevOps tokens stop working on December 1, 2026.

## 1. Prepare

Start from `main`, with a clean working tree:

```bash
git checkout main && git pull
git status                                  # must be clean
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
  The templates' `sygnal-check.config.json` (PLAN-7 I-3) is read only from `sygnal-check` 0.4.0 on (0.3.0 never opens it), so the range must reach 0.4.0 for new projects to use it.
- `CHANGELOG.md`: rename `## [Unreleased]` to `## <SYGNAL> — <date>`, and fill in the "Measured impact" paragraph.
- `ROADMAP.md`: the release line names the template range (`sygnal` ^6.0.0); update it if it still describes the current release.

Bump the extension (§8) and the plugin (§9) in the same commit when they ship. Commit, and push to `main` (or merge a pull request): the Release workflow starts. Running the gates locally first (§2–§4) is optional; the workflow runs them before anything is published.

## 2. Install, build and run the gates

The Release workflow runs these (`gates.yml`, also CI on every pull request). To run them locally:

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
  - `dist/` with `index.{cjs,esm}.js`, a single bundled `dist/index.d.ts` (no `dist/cycle/` declarations), `sygnal.min.js`, the `jsx*`, `diagnostics`, `devtools`, `element`, `ui`, `ui-menu`, `ui-select`, `ui-combobox`, `zag`, `react`, `ai` (6.1.0: `dist/ai.{cjs,esm}.js`, a re-export of the main bundle), `vite`, `astro` and `vike` entries, and their source maps;
  - `dist/guide/`, the guides shipped for agents (6.1.0: 47 files, including `ai-chat.md`, `ai-decisions.md`, `agent.md`, `webmcp.md` and `mcp-apps.md`);
  - `dist/vike/config/+config.js` with its `dist/vike/config/package.json` (`"type": "module"`), and no `+config.cjs.js`;
  - `dist/shims/globalthis.cjs` (the `sygnal/shims/globalthis` export used by the Vite plugin's alias);
  - `src/`, used for the sub-entry types such as `src/jsx.d.ts`, `src/ai.d.ts` and `src/vite/plugin.d.ts`;
  - `llms.txt`, `CHANGELOG.md`, `README.md`, `LICENSE` and `package.json`.
- **`sygnal-check`**: `bin/sygnal-check.js`, `src/` (including `model/`, `rules/` and, from 0.4.0, `lsp/` for the language server), `schema/inspect.schema.json`, `explanations.json`, `README.md`, `LICENSE` and `package.json`.
- **`create-sygnal-app`**: `index.js`, `README.md`, `LICENSE`, `package.json`, and all ten `template-*` folders. Each folder has an `AGENTS.md`, a `CLAUDE.md`, a `package.json`, a `*.test.*.tmpl` starter test, and (PLAN-7 I-3) `.vscode/extensions.json` and `sygnal-check.config.json` (the dot-directory must be in the tarball); the two `template-mcp-app*` folders (6.1.0) also have `server/` (`server.js`, `forecast.js`, `server.test.js.tmpl`).

## 4. Smoke check the templates before publishing

The checks of §7 against this checkout's tarballs, so a template problem is found before anything is on the registry (the gates' `templates` job):

```bash
npm run build:all
node scripts/release-smoke.mjs --local      # --only vike-ts for one project; logs in the printed folder
```

It packs the three packages, installs the scaffolder from its tarball (running `create-sygnal-app/index.js` from the repository fails: its own dependencies aren't installed there), scaffolds each template with `--no-install`, points its `sygnal` and `sygnal-check` at the tarballs, installs, and runs the checks of §7.

## 5. Publish

The Release workflow publishes, after your approval (see [How a release runs](#how-a-release-runs)). Order: `sygnal-check` first (the templates list it as a dev dependency), then `sygnal` (its `prepublishOnly` runs `build:all` again), then `create-sygnal-app` (its templates need both).

**By hand** (the fallback when the workflow can't run; with "disallow tokens" set, `npm publish` asks for your 2FA code):

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

The workflow tags `v<SYGNAL>` and creates its GitHub release from the `CHANGELOG.md` entry. By hand:

```bash
git tag v<SYGNAL>
git push origin v<SYGNAL>
```

Create the GitHub release from the tag, and use the `CHANGELOG.md` entry as its notes.

## 7. Smoke check from the registry

The workflow's `smoke` job waits until npm serves the new versions (§5), then scaffolds every template from the published packages. By hand:

```bash
node scripts/release-smoke.mjs --registry   # create-sygnal-app@<CSA> from npm; requires sygnal <SYGNAL> and sygnal-check <CHECK>
```

Each project is scaffolded into a new folder (create-sygnal-app refuses a folder that exists and isn't empty) and must install `sygnal` <SYGNAL> and `sygnal-check` <CHECK>; its tests must pass, `sygnal-check --strict` (`pages` for Vike) must report nothing, `tsc --noEmit` must report nothing for the five TypeScript templates (the `vite build` of a TS template doesn't type-check, and the declarations are where type-level changes show up), and the build must succeed. The checks run with `--no-install`, so they use the copy the template installed, not a fresh download. `node_modules/sygnal/llms.txt` must exist. The `mcp-app` tests cover the view and its MCP server; `npm start` in one of them serves MCP on `http://localhost:3001/mcp` (`node server/server.js --stdio` for stdio), where `tools/list` shows `get_forecast` and `resources/read` returns the built view.

**Vike client navigation**, which the unit tests don't cover: for `vike-js` and `vike-ts` the script runs `npm run preview` and checks in Chromium (Playwright from `browser-tests/`) that two clicks on **+** show 2 (the page hydrated), that **About** renders at `/about` without a page reload, that **Home** renders the counter again, that there is one nav bar (no duplicated Layout), and that the console shows no errors or warnings (in particular none about `passToClient`).

If a smoke check fails, fix the problem on `main` and publish a patch release of the affected package.

## 8. The VS Code extension (`editors/vscode/`)

The extension (id `sygnal.sygnal`) is published to the VS Code Marketplace and to Open VSX (VSCodium, Cursor, Windsurf and others) as the same `.vsix`. It bundles a copy of `sygnal-check` from `sygnal-check/` at build time, as the fallback for projects without a capable one (D301), so release it after `sygnal-check` and from the released commit. Only the maintainer publishes; the tokens never go into the repository.

Last published: the extension 0.5.1 (2026-10-14; tag `vscode-v0.5.1`, the first through the release workflow) and the Claude Code plugin 0.1.3 (tag `sygnal--v0.1.3`).

**One-time setup (the maintainer's accounts).** The publisher `sygnal` exists on both registries (0.1.0).
- **VS Code Marketplace, Microsoft Entra ID** (global Azure DevOps tokens stop working on December 1, 2026). The workflow signs in to Entra as an app registration that trusts GitHub's OIDC token for this repository's environment `release`, then runs `vsce publish --azure-credential` (`@vscode/vsce` 4.0.0, pinned in `editors/vscode`). No secret and no Azure subscription are involved. Microsoft documents this route for Azure Pipelines; the GitHub Actions form follows the same steps:
  1. In the Azure portal (Microsoft Entra ID → App registrations → New registration): name it, e.g. `sygnal-marketplace-publisher`, single tenant, no redirect URI. Note its **Application (client) ID** and **Directory (tenant) ID**.
  2. On the app, Certificates & secrets → Federated credentials → Add credential → "GitHub Actions deploying Azure resources": organization `tpresley`, repository `sygnal`, entity type **Environment**, environment `release`. (Subject `repo:tpresley/sygnal:environment:release`.)
  3. In GitHub, add the variables `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` to the environment `release`.
  4. Run Actions → **Marketplace identity** → Run workflow. Its summary shows the app's Azure DevOps profile id. Add that id at https://marketplace.visualstudio.com/manage/publishers/sygnal → Members, role **Contributor**.
  5. Run **Marketplace identity** again: its last step (`vsce verify-pat --azure-credential sygnal`) must pass. Then revoke the old Azure DevOps personal access tokens.

  `vsce publish --oidc` (Marketplace trusted publishing) exists in vsce 4 but the Marketplace doesn't accept it yet (October 2026); it would replace the app registration when it does.
- **Open VSX, trusted publishing:** registered for `sygnal.sygnal` (see [the setup above](#one-time-setup-the-maintainers-accounts)); the workflow runs `ovsx publish --trusted-publishing` (`ovsx` 1.2.0, pinned in the workflow). A new version appears on open-vsx.org a few minutes after publishing (it is scanned first).

**Each release:** bump the version and add the changelog section (step 1) in the release commit; the workflow runs steps 2–5. By hand:
1. Bump `version` in `editors/vscode/package.json` and add a section to `editors/vscode/CHANGELOG.md`. The extension has its own version line (0.1.0 first). If the minimum server version changes, update `MIN_LSP_VERSION` in `editors/vscode/src/resolve.ts`, the extension README and the smoke test text. The Marketplace doesn't take pre-release semver: use `vsce publish --pre-release` with an odd minor for pre-releases.
2. Gate:
   ```bash
   npm ci --prefix sygnal-check
   npm ci --prefix editors/vscode
   npm --prefix editors/vscode test      # type check, unit tests, build, smoke test in the installed VS Code
   ```
   The smoke test opens VS Code from `/Applications/Visual Studio Code.app` (`VSCODE_PATH` overrides it) and downloads nothing; the gates download VS Code and run it under `xvfb-run`. The root `npm test` includes the snippets gate (`test/p7-v1-snippets.test.js`).
3. Package and inspect:
   ```bash
   npm --prefix editors/vscode run package     # writes editors/vscode/sygnal-<version>.vsix
   (cd editors/vscode && npx vsce ls --tree)   # the bundle, server/sygnal-check with @babel/parser, snippets, icon; no sources or tests
   ```
   vsce reads `package.json` in the current directory (`npx --prefix` only says where vsce is installed), hence the `cd`. Expect about 645 KB (0.5.0). Optionally install it locally first: `code --install-extension editors/vscode/sygnal-<version>.vsix`.
4. Publish the same file to both registries (the workflow does this with OIDC, no tokens). By hand, with tokens: both tools read their token from the environment (`VSCE_PAT`, `OVSX_PAT`), so never type a token into a command: it stays in the shell history (and in any transcript of the terminal). `read -s` sets it without echoing or recording it:
   ```bash
   read -s 'VSCE_PAT?Marketplace token: ' && export VSCE_PAT; echo   # bash: read -s -p 'Marketplace token: ' VSCE_PAT
   read -s 'OVSX_PAT?Open VSX token: ' && export OVSX_PAT; echo
   (cd editors/vscode && npx vsce publish --packagePath sygnal-<version>.vsix)
   npx ovsx publish editors/vscode/sygnal-<version>.vsix
   unset VSCE_PAT OVSX_PAT
   ```
   A token that ended up in a command line or a log has to be revoked and replaced (Azure DevOps personal access tokens; open-vsx.org → Settings → Access Tokens).
5. Tag `vscode-v<version>` and attach the `.vsix` to the GitHub release.

## 9. The Claude Code plugin (`editors/claude-code/`)

The marketplace file (`.claude-plugin/marketplace.json`, name `sygnal`) is read from `main` when users run `/plugin marketplace add tpresley/sygnal`. The plugin's skill is a symlink to `skills/sygnal-dev/`, copied into the user's plugin cache at install. Users get a new copy only when `version` in `editors/claude-code/.claude-plugin/plugin.json` changes; auto-update is off by default for third-party marketplaces.

1. **When:** bump the plugin's `version` in any release that changes `editors/claude-code/` **or `skills/sygnal-dev/`**: patch for skill text or docs, minor for new plugin behaviour.
2. **Order:** publish `sygnal-check` first when the plugin needs a newer server (0.1.0 needs sygnal-check ≥ 0.4.0 for diagnostics; the skill works without it, and the plugin's launcher stays quiet without a capable sygnal-check).
3. **Check:**
   ```bash
   claude plugin validate editors/claude-code   # one expected warning: the skill symlink isn't followed by the validator
   claude plugin validate skills
   claude plugin validate --strict .
   npx vitest run test/p7-i1-claude-plugin.test.js
   ```
4. **Merge to `main` and push.** The Release workflow tags `sygnal--v<version>` (its gates check that `plugin.json` and the marketplace entry agree). By hand: `claude plugin tag editors/claude-code --push` (try `--dry-run` first). Installs follow `main`; the tag is for history and for plugins that depend on this one.
5. **Smoke test** in a scratch `CLAUDE_CONFIG_DIR`: `claude plugin marketplace add tpresley/sygnal`, `claude plugin install sygnal@sygnal`, then `claude plugin details sygnal@sygnal` must list one skill and one LSP server.
6. Add a line about it to the `CHANGELOG.md` entry of the release that ships it.
