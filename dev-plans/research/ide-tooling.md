# IDE tooling for Sygnal: language server, editor plugins

Research, 2026-10-09. Question: would a language server or other editor plugins (VS Code and others) be worth building for Sygnal, and which of the plugin types other front-end frameworks ship would actually help?

**Short answer: yes to a small language server, no to a large one.** Sygnal is plain JSX/TSX, so TypeScript already gives editors syntax, types, JSX completion and navigation. What TypeScript can't see are Sygnal's *string-wired seams*: intent keys ↔ model keys, intent selectors ↔ the view's classes, `EVENTS` types across files, reply actions (`ok: 'LOADED'`), `next('X')`, `<Collection from="x">`. sygnal-check already models every one of those seams. A thin LSP that puts its findings in the editor while you type is cheap: the proof of concept below is about 130 lines with zero dependencies. It reaches VS Code, Neovim, Zed, JetBrains and Claude Code from one server.

## 1. What other frameworks ship, and what applies to Sygnal

| Plugin type | Examples | Why they exist | Relevant to Sygnal? |
|---|---|---|---|
| Template-language servers | Vue (Volar: `@vue/language-server` + `@vue/typescript-plugin`, "hybrid mode"), Svelte language tools, Angular Language Service, Astro, Marko, Ember Glint | A custom file format or template syntax that TypeScript can't parse, so they have to supply syntax, types, completion and navigation themselves | **No.** Sygnal views are TSX/JSX, which TypeScript handles already. A grammar, a `vue-tsc`-style type checker or a separate TS server would duplicate what editors already do |
| Nothing beyond TS + ESLint | React, Solid, Preact | JSX is native to TS; framework rules ship as ESLint plugins (`eslint-plugin-react-hooks`, `eslint-plugin-solid`) | **The closest analogue**, but Sygnal's rules are cross-file (SYG104/105/129/609 need the project model), which fits ESLint's per-file model poorly (see §4) |
| TypeScript language-service plugins | lit-plugin / ts-lit-plugin, Next.js TS plugin (route config, `'use client'` rules), GraphQL and styled-components plugins | Domain checks and completions *inside* strings and conventions that TS treats as opaque | **Yes, in spirit**: this is Sygnal's gap. The mechanism (LSP vs tsserver plugin) is a delivery choice (§4) |
| Browser DevTools extension | React/Vue/Svelte/Solid DevTools | Runtime tree and state inspection | **Already built** (`devtools/`, `sygnal/devtools`) |
| Build-tool error overlays | `vite-plugin-checker`, Next.js overlay | Errors in the terminal and browser while the dev server runs | **Already built**: the `sygnal/vite` `check` option runs sygnal-check and shows a browser overlay |
| MCP servers for agents | `@sveltejs/mcp`, Next.js `next-devtools-mcp` | Docs and checks for coding agents | **Already built**: `sygnal-check mcp` (check, graph, explain) |
| Snippets / scaffolding | Most frameworks' marketplace snippet packs | Boilerplate | **Minor.** The component shape (`intent`/`model`/`initialState`) benefits a little; `create-sygnal-app` covers projects. Snippets can ride along in the extension at almost no cost |

The tooling Sygnal already has (DevTools, Vite overlay, MCP, CLI) covers every category except **in-editor feedback while typing**. That is the gap a language server fills.

## 2. Experiment A: what the editor shows today

The same counter, written three ways, with two deliberate bugs: a model key typo (`INCREMNT`) and a selector typo (`.incc` while the view renders `inc`). The files are in [`ide-tooling-poc/fixture/src`](ide-tooling-poc/fixture/src). I ran `tsc` (`strict`, `checkJs`) over them; it reports the same diagnostics VS Code would show.

| Form | TypeScript (what VS Code shows) | sygnal-check |
|---|---|---|
| `A.tsx`: untyped TSX, statics as expandos (docs style) | Nothing Sygnal-specific; `DOM` is implicitly `any`, so there are no completions either | SYG101, SYG110 (with "did you mean '.inc'?"), SYG102 |
| `B.tsx`: canonical typed form, `Component<State, {}, {}, ActionsOf<typeof intent>>` | Catches the model typo (TS2561, "Did you mean 'INCREMENT'?"); **misses the selector typo** | Same 3 findings |
| `C.jsx`: plain JS (how most examples are written) | Nothing | Same 3 findings |

Takeaways:
- TypeScript catches Sygnal wiring bugs only in the fully typed form, and even then it misses selectors, cross-file EVENTS (unless the `SygnalEvents` registry is filled in), child-isolation (SYG104) and driver wiring (SYG609/643).
- sygnal-check finds them all, in every style, but today only on demand (CLI or MCP) or after a save while the Vite dev server runs.

## 3. Experiment B: a proof-of-concept language server

[`ide-tooling-poc/server.mjs`](ide-tooling-poc/server.mjs) is a zero-dependency LSP server over stdio, in the same hand-rolled style as `sygnal-check mcp`. [`client.mjs`](ide-tooling-poc/client.mjs) drives it the way an editor would. It provides:

- **diagnostics** for the whole project on startup, re-run 150 ms after each change, including **unsaved buffers**. The PoC patches `fs.readFileSync`; the real fix is a `readFile`/overlay option on `Project.loadFile` (`sygnal-check/src/model/project.js:90`, the only place it reads source);
- **hover** on a finding: the `explain` text (title, explanation, fix, docs link);
- a **quick fix** for every "did you mean '…'" finding (`'.incc'` → `'.inc'`).

Run it:

```bash
SYGNAL_CHECK_SRC=$PWD/sygnal-check/src node dev-plans/research/ide-tooling-poc/client.mjs $PWD/dev-plans/research/ide-tooling-poc/server.mjs $PWD/dev-plans/research/ide-tooling-poc/fixture src/C.jsx
```

Result: 3 diagnostics with ranges on open; the hover shows SYG110's explanation; one code action, `Change to '.inc'`; after an unsaved edit fixes both typos, 0 diagnostics, re-checked in 6–11 ms.

**Latency** ([`bench.mjs`](ide-tooling-poc/bench.mjs), full project re-check, `--strict`):

| Project | Lines | Cold | Warm |
|---|---|---|---|
| examples/kanban | 1.1k | 71 ms | 22 ms |
| examples/ai-panel-spa | 2.0k | 87 ms | 67 ms |
| examples/plan5-showcase (50 files) | 2.2k | 254 ms | 174 ms (≈ half parsing, half rules) |

That is roughly 80 ms per 1k lines, warm. With a debounce, that's fine up to about 10k lines. Beyond that it needs a per-file parse cache (keyed by content, which halves the time) and eventually incremental rules. Rules are project-wide by design, so "check only the changed file" is not a drop-in option.

Gaps found in sygnal-check for editor use (all small):
1. Diagnostics carry a start `line:column` but no **end**. The PoC infers the range from the token (string literal or identifier); the checker has the AST node and could emit `endLine`/`endColumn`.
2. No **in-memory source** option (above).
3. The `--graph` JSON has no **source positions** for actions, selectors or events. Navigation and completions need them, and the `Project` model already has the nodes.

## 4. Delivery options

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **`sygnal-check lsp`** (stdio LSP in the existing package) + thin VS Code extension (`vscode-languageclient`) | One server for VS Code, Neovim, Zed, Helix, JetBrains (LSP API) and **Claude Code** (plugins can declare `lspServers` / `.lsp.json`, and diagnostics arrive after each edit). Reuses the zero-dep JSON-RPC approach of `mcp.js`. Works for JS projects with no tsconfig | A second process next to tsserver; completions inside strings sit beside TS's own | **Recommended** |
| TypeScript language-service plugin (like lit-plugin, Next.js) | Runs inside tsserver; completions and diagnostics merge naturally with TS's | Needs a `plugins` entry in tsconfig/jsconfig, or an extension that contributes `typescriptServerPlugins`. Synchronous API inside tsserver's process. Usually diagnoses open files only, which is awkward for cross-file rules. Reaches only tsserver-based editors | Possible later, for completions only, if the LSP's completions feel second-class |
| ESLint plugin wrapping the rules | Rides the ESLint extension that's already installed almost everywhere; fits CI | Per-file lint model vs cross-file rules (needs a cached project like `eslint-plugin-import`); parses twice; no hover docs, completions or navigation | Only if users ask for it; the CLI already covers CI |

## 5. What the server should do, ranked by value

1. **Live diagnostics.** All of sygnal-check's findings (SYG1xx/4xx/6xx/7xx, `--strict` per workspace setting) at the exact token, while typing. The PoC shows this works. Highest value: these bugs are silent at runtime by definition (a misspelled action just does nothing).
2. **Hover and code actions.** `explain` text on hover; quick fixes from "did you mean"; the `--fix` canonical-form rewrites (SYG504/505/506) and `--controls` as code actions; "add a model entry for `X`" for SYG101.
3. **Completions at the seams** (needs positions, gap 3): model keys from the intent's actions; `DOM.click('…')` classes and ids from the component's own view; `EVENTS.select('…')` from emitted types across the project; `ok:` / `error:` / `next('…')` action names; `<Collection from="…">` state keys. This matters most for JS/untyped users, who get no completions today (`DOM` is `any`).
4. **Navigation.** Go to definition from intent key ↔ model entry, from selector → the element in the view, `EVENTS.select('X')` ↔ its emitters. Find references; **rename an action** across intent, model, `next()` and reply names.
5. Code lens ("handled by model · emits EVENTS 'SAVED'") and snippets: cheap extras.

Don't build: a grammar, formatter, custom type checker, or our own TS server. TypeScript already covers all of those for JSX.

## 6. Agents

Sygnal invests heavily in agent ergonomics (PLAN-1/2/5 evals). An LSP is also an agent tool: in Claude Code, a plugin's LSP server pushes diagnostics into the session after every edit, so an agent sees SYG110 without remembering to run `sygnal-check`, and without a running Vite dev server. That's a testable claim: add an arm to `evals/agent-ergonomics` with the LSP plugin installed and compare silent-wiring-bug rates and turns against the current skill + MCP setup. Of everything here, this is probably the cheapest way to show measurable value.

## 7. Suggested plan and rough cost

| Step | Content | Rough size |
|---|---|---|
| 0 | sygnal-check: `readFile` overlay option, end ranges, per-file parse cache | small, all in `model/project.js` / `diagnostic.js` |
| 1 | `sygnal-check lsp`: diagnostics, hover, quick fixes, `--fix` rewrites as code actions; tests driven like `mcp`'s | ~300–500 lines + tests |
| 2 | VS Code extension (`sygnal-vscode`: client, settings `strict`/`a11y`/paths, snippets), published to the Marketplace and Open VSX; a Claude Code plugin manifest; editor setup docs (Neovim/Zed/JetBrains) | small code, new release channel |
| 3 | Eval arm (§6) | one eval run |
| 4 | Positions in the project model → completions, go-to-definition, rename | medium; decide after 1–3 |

Ongoing cost: two extra release channels (Marketplace, Open VSX) and an LSP protocol surface to keep working. The rules themselves stay single-sourced in sygnal-check, so the CLI, Vite overlay, MCP and editor can't drift apart.

## Sources

- Vue language tools, hybrid mode: https://github.com/vuejs/language-tools
- Svelte MCP: https://mcpservers.org/servers/sveltejs/mcp ; Next.js DevTools MCP: https://hub.docker.com/mcp/server/next-devtools-mcp/overview
- eslint-plugin-solid: https://www.npmjs.com/package/eslint-plugin-solid
- Claude Code plugins reference (LSP servers): https://code.claude.com/docs/en/plugins-reference
