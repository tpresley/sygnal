# Sygnal for VS Code

Diagnostics, explanations and quick fixes for [Sygnal](https://sygnal.js.org/) apps, as you type.

Sygnal's wiring mistakes fail silently at run time: an intent selector the view never renders, an action with no model entry, an EVENTS type nobody listens to, a child component's class used in the parent. This extension runs [`sygnal-check`](https://www.npmjs.com/package/sygnal-check), Sygnal's static checker, as a language server, so these show up in the editor as soon as you write them, with the same rules and settings as the CLI and your CI.

<!-- Screenshot: a SYG110 squiggle with its hover and the "Change '.incc' to '.inc'" quick fix. -->

## Features

- **Findings as you type**, for the whole project: a change in one file can create or clear a finding in another (EVENTS, child components, Collections), and those files are updated too. Each finding names the component, the problem and the fix, and links its code to the [error reference](https://sygnal.js.org/reference/errors).
- **Hover** on a finding: what the code means, why it fails silently, and how to fix it.
- **Quick fixes** (`Ctrl+.` / `Cmd+.`): the checker's suggestions, such as "Change '.incc' to '.inc'" or "Add a model entry for 'SAVE'", and "Suppress SYGnnn on this line".
- **Fix all**: `Sygnal: Fix All in File` applies every mechanical fix in the file (what `sygnal-check --fix` does). To run it on save:

  ```json
  "editor.codeActionsOnSave": { "source.fixAll.sygnal": "explicit" }
  ```

- **Snippets** for `.jsx` and `.tsx` files, in Sygnal's canonical forms:

  | Prefix | Inserts |
  |---|---|
  | `sygcomp` | a component: destructured view, `intent`, object-form `model`, `initialState` (in `.tsx`: `Component<State, {}, {}, ActionsOf<typeof intent>>` and `IntentSources`) |
  | `sygeffect` | a model entry with an `EFFECT` sink |
  | `sygevent` | a model entry that updates state and emits a global event with `event()` |

## Commands

| Command | |
|---|---|
| `Sygnal: Restart Server` | Restarts the language server (and picks the `sygnal-check` again, e.g. after you install it) |
| `Sygnal: Show Output` | The server's log. Clicking **Sygnal** in the status bar does the same |
| `Sygnal: Explain Code…` | Pick any SYG code to read its explanation |
| `Sygnal: Fix All in File` | Applies every auto-fixable Sygnal fix in the active file |

## Which sygnal-check it runs

1. **Your project's own** `node_modules/sygnal-check`, when it is version 0.4.0 or later (the first with the language server). The editor then reports exactly what your CLI and CI report.
2. Otherwise, the **copy bundled with the extension**. The status bar item shows which one is in use: hover over **Sygnal** for the version and where it comes from. If your project has an older `sygnal-check`, the extension says so once and suggests `npm i -D sygnal-check@latest`.

In a workspace you haven't trusted (Restricted Mode), the extension only runs its bundled copy, never code from the workspace.

The server runs on VS Code's own Node.js, so you don't need Node installed for the bundled copy.

## When it runs

The extension activates in a workspace with a `sygnal-check.config.json`, or when you open a JavaScript or TypeScript file. It starts the server only when a workspace folder uses Sygnal: a `sygnal-check.config.json`, or a `package.json` that depends on `sygnal` or `sygnal-check` (or has a `"sygnal-check"` config key). Otherwise it stays idle, and starts once one of those files appears.

Each workspace folder is checked as its own project. A folder with no Sygnal components gets no findings.

## Settings

By default every setting is unset (`null`), so the config file decides, and the editor, the CLI and CI check the same way. A setting you set overrides the config file. All of them can be set per workspace folder (`.vscode/settings.json`).

| Setting | Type | |
|---|---|---|
| `sygnal.strict` | boolean | Also run the strict-mode rules (canonical forms, SYG5xx), like `--strict` |
| `sygnal.a11y` | `"warn"` \| `"error"` | Severity of the accessibility findings (SYG7xx) |
| `sygnal.ignore` | string[] | Codes to drop, e.g. `["SYG105"]`. Replaces the config file's list |
| `sygnal.paths` | string[] | Files, directories or globs to check, relative to the folder (e.g. `["src"]`, `["pages"]` for Vike) |
| `sygnal.verbose` | boolean | Also show info findings |
| `sygnal.trace.server` | `"off"` \| `"messages"` \| `"verbose"` | What the server logs to the Sygnal output |

## The config file

Put the project's settings in `sygnal-check.config.json` at the project root, so the CLI, CI and the editor share them:

```json
{ "strict": true }
```

or in `package.json`:

```json
{ "sygnal-check": { "strict": true } }
```

See the [`sygnal-check` README](https://github.com/tpresley/sygnal/tree/main/sygnal-check#configuration) for every key.

## Other editors and agents

The server is `sygnal-check lsp`, a standard Language Server Protocol server on stdio, so other editors can use it too: see [the docs](https://sygnal.js.org/).

## Links

- [Sygnal documentation](https://sygnal.js.org/)
- [Diagnostic codes](https://sygnal.js.org/reference/errors)
- [Issues](https://github.com/tpresley/sygnal/issues)

## License

MIT
