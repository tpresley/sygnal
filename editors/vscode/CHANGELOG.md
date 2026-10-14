# Changelog

## 0.4.0

Bundles sygnal-check 0.7.0. A project with its own sygnal-check runs that copy, as before; the highlights need 0.7.0 or later there (`npm i -D sygnal-check@latest`), and an older one keeps working without them.

- **Highlights** of Sygnal's wiring, drawn over your theme's colors: action names wherever they're wired, EVENTS types, intent selectors (marked when nothing renders them, or when only a dynamic class name might), the view classes / ids / controls an intent selects, and child components selected with `CHILD.select`. They're editor decorations rather than semantic tokens, so TypeScript's semantic highlighting stays. New setting `sygnal.highlights` (unset: on) and theme colors `sygnal.highlight.*`.

## 0.3.0

Bundles sygnal-check 0.6.0 (Sygnal 6.3.0). The extension's own code doesn't change.

- **Catalog findings** for `defineCatalog({...})` (composing UI with a model, `sygnal/ai`): a misspelled declaration key (SYG253, with a rename quick fix), a description lint (SYG254: two parts sharing a phrase, a description naming its own param's value, overlapping options), and the static cases of SYG161, SYG162, SYG250, SYG450 and SYG680.
- **SYG426** for the deprecated lowercase marker tags (`<collection>`, `<switchable>`, ...), with a quick fix that renames the tag and adds the import.
- The `chat` and `compose` behaviors' keys and actions are known, so `ask` and `clientTools` give no false SYG127.

## 0.2.1

- Bundles sygnal-check 0.5.1: **nested projects are found**. Opening a repository or monorepo root, each file is checked as part of its nearest Sygnal project (the closest folder with a `sygnal-check.config.json` or a `package.json` that depends on sygnal), with that project's config, instead of the whole workspace folder being one project. And when an open Sygnal file isn't checked (outside its project's `paths`, or `paths` match no files), a one-time message says why and how to fix it.
- The extension starts in larger monorepos: it now looks through up to 500 `package.json` files (was 50) for one that uses Sygnal.

## 0.2.0

The language server's new features (sygnal-check 0.5.0, also bundled):

- **Completions** for the names Sygnal wires by string: view classes and ids in a `DOM` selector, unhandled actions in a model key (as a snippet), EVENTS types in `EVENTS.select()` / `event()`, the model's actions in `next()` and reply names, state keys in `<Collection from>`.
- **Go to definition / Find All References** on actions, EVENTS types, class and id names, controls, state keys, context entries and child components.
- **Code lenses** on intent keys (what handles the action), model keys (what triggers it) and EVENTS selects / emits (how many emitters / listeners). Clicking one opens the targets in a peek view (the client command `sygnal.showReferences`, advertised to the server in `experimental.commands.commands`). New setting `sygnal.codeLens` (unset: on).
- **Rename** of actions, EVENTS types, class / id names, state keys and context entries, which refuses with the reason when it can't find every use (VS Code then offers TypeScript's rename). Edits in test files need confirmation in the refactor preview.
- A workspace `sygnal-check` 0.4.0 still runs (findings, hover, quick fixes); the new features need 0.5.0 or later.
- A one-time notice when the workspace's own sygnal-check is older than 0.5.0: it still runs for its findings, and the notice says completions, go to definition, code lenses and rename need 0.5.0.

## 0.1.0

First release.

- Runs `sygnal-check lsp`: Sygnal's static checker as a language server. Findings for the whole project as you type, a hover with each code's explanation, quick fixes, "Suppress SYGnnn on this line" and `source.fixAll.sygnal`.
- Uses the workspace's own `sygnal-check` (0.4.0 or later), or the bundled copy, shown in the status bar. An older workspace copy gets a one-time upgrade note. Restricted Mode runs only the bundled copy.
- Starts only in workspaces that use Sygnal (a `sygnal-check.config.json`, or a `package.json` that depends on `sygnal` / `sygnal-check`).
- Commands: Restart Server, Show Output, Explain Code…, Fix All in File.
- Settings `sygnal.strict`, `sygnal.a11y`, `sygnal.ignore`, `sygnal.paths`, `sygnal.verbose`, `sygnal.trace.server`, all per folder and unset by default (the config file decides).
- Snippets for `.jsx` and `.tsx`: a component (`sygcomp`), an `EFFECT` model entry (`sygeffect`), an `event()` model entry (`sygevent`).
