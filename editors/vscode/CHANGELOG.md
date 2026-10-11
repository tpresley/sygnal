# Changelog

## 0.2.0

The language server's new features (sygnal-check 0.5.0, also bundled):

- **Completions** for the names Sygnal wires by string: view classes and ids in a `DOM` selector, unhandled actions in a model key (as a snippet), EVENTS types in `EVENTS.select()` / `event()`, the model's actions in `next()` and reply names, state keys in `<Collection from>`.
- **Go to definition / Find All References** on actions, EVENTS types, class and id names, controls, state keys, context entries and child components.
- **Code lenses** on intent keys (what handles the action), model keys (what triggers it) and EVENTS selects / emits (how many emitters / listeners). Clicking one opens the targets in a peek view (the client command `sygnal.showReferences`, advertised to the server in `experimental.commands.commands`). New setting `sygnal.codeLens` (unset: on).
- **Rename** of actions, EVENTS types, class / id names, state keys and context entries, which refuses with the reason when it can't find every use (VS Code then offers TypeScript's rename). Edits in test files need confirmation in the refactor preview.
- A workspace `sygnal-check` 0.4.0 still runs (findings, hover, quick fixes); the new features need 0.5.0 or later.

## 0.1.0

First release.

- Runs `sygnal-check lsp`: Sygnal's static checker as a language server. Findings for the whole project as you type, a hover with each code's explanation, quick fixes, "Suppress SYGnnn on this line" and `source.fixAll.sygnal`.
- Uses the workspace's own `sygnal-check` (0.4.0 or later), or the bundled copy, shown in the status bar. An older workspace copy gets a one-time upgrade note. Restricted Mode runs only the bundled copy.
- Starts only in workspaces that use Sygnal (a `sygnal-check.config.json`, or a `package.json` that depends on `sygnal` / `sygnal-check`).
- Commands: Restart Server, Show Output, Explain Code…, Fix All in File.
- Settings `sygnal.strict`, `sygnal.a11y`, `sygnal.ignore`, `sygnal.paths`, `sygnal.verbose`, `sygnal.trace.server`, all per folder and unset by default (the config file decides).
- Snippets for `.jsx` and `.tsx`: a component (`sygcomp`), an `EFFECT` model entry (`sygeffect`), an `event()` model entry (`sygevent`).
