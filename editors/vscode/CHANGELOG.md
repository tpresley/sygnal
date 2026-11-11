# Changelog

## 0.14.0

Bundles sygnal-check 0.17.0 (Sygnal 7.5.0). The extension's own code doesn't change.

- New findings: SYG265 (a network request outside a declared output), SYG266 (another side effect there), SYG646 (`drivers` on a component that is not the root), and in strict mode SYG511 (a network request in an `EFFECT` handler) and SYG512 (a module-level variable written outside a declared output).

## 0.13.0

Bundles sygnal-check 0.16.0 (Sygnal 7.4.0). The extension's own code doesn't change.

- New finding: SYG637 (`{ refresh }` on a read another mounted component also declares, which keeps its old answer).

## 0.12.0

Bundles sygnal-check 0.15.0 (Sygnal 7.3.1). The extension's own code doesn't change.

- New findings: SYG108 (an intent selector that isn't valid CSS, such as `.hover:bg-red-500`) and SYG109 (a number for a style property that needs a unit, with a quick fix).
- SYG110 is now a warning when a CSS Module class is used as an event hook.

## 0.11.0

Bundles sygnal-check 0.14.0 (Sygnal 7.3.0). The extension's own code doesn't change.

- New finding: SYG259 (an output of an action reads a field the same action's STATE sets to an empty literal, such as `''` or `null`; read `previousState` instead).

## 0.10.0

Bundles sygnal-check 0.13.0 (Sygnal 7.2.0). The extension's own code doesn't change.

- New findings: SYG107 (a DOM property in the wrong case, such as `novalidate`, with a quick fix), SYG118 (a host intent action that replaces a behavior's trigger), SYG258 and SYG509 (`Date.now()` / `Math.random()` read in a reducer or handler instead of the handler's `now()` / `random()`), SYG260 (`undo()` on a key `shared()` syncs), SYG303 (`STATE.stream` with `dropRepeats()` in an intent), SYG455–SYG457 (an `<Outlet>` whose `from`, `of` or step doesn't match its wizard), SYG458 and SYG459 (a declaration or behavior option reading a context or state field off its bag, with quick fixes) and SYG691 (an unknown endpoint on an `orpcClient` contract).
- Fewer false findings: SYG102, SYG110 and SYG702 follow helper functions.

## 0.9.0

Bundles sygnal-check 0.12.0 (Sygnal 7.1.0). The extension's own code doesn't change.

- New findings: SYG117 (`next('X')` where the component has no entry `X`, naming the parent that handles it), SYG302 (`import xs from 'xstream'`, with a quick fix to `import { xs } from 'sygnal'`) and SYG429 (a Switchable state map key that names no page).
- Fewer false findings: reply action names in request helpers (`req('/a', { ok })`), returned consts and `connections` consts; `next` passed into a helper, imported ones included (a helper edit re-checks its callers); SYG256 past helper calls in other fields; context reads in the declaration statics for SYG170.
- `replyKeys` in `sygnal-check.config.json` names a custom driver's reply keys.

## 0.8.0

Bundles sygnal-check 0.11.0 for Sygnal 7.0.0 and existing Sygnal 6 apps.

- Checks reducer timing and known state-binding changes against the installed Sygnal version in each source package. In Sygnal 7 every non-STATE sink gets the committed state and known changed binding targets remount; Sygnal 6 keeps its original contracts. Adds the SYG257 explanation (the opt-in 7.0 timing audit).
- Workspace checkers now need 0.11.0 or later. Earlier copies fall back to the bundled checker with an upgrade message, including copies that already have a language server.

## 0.7.0

Bundles sygnal-check 0.10.0 (Sygnal 6.6.0).

- **Sygnal: Show App Graph**: the app graph page (`sygnal-check --graph=html`) in a webview panel, one per project root, from the editor's context menu, its `…` menu or the command palette. It updates as you type through the language server's new `sygnal/graph` request and `sygnal/graphChanged` notification, keeps its view and selection across updates and when the panel is hidden, selects the component under the cursor, opens file links in the editor, and takes its colors from the VS Code theme. The page runs under a strict CSP (a per-page script nonce, no remote content, no local resources). Needs the bundled sygnal-check or a project's own 0.10.0 or later.

## 0.6.0

Bundles sygnal-check 0.9.0 (Sygnal 6.5.0). The extension's own code doesn't change.

- **State paths** (`<Collection from="board.cards">`, `state="settings.rules"`): SYG401 follows a `from` path through the literal `initialState` and names the keys where it breaks, and rename / go to definition / references treat a path's first segment as a use of that state key (renaming `board` edits `from="board.cards"`).

## 0.5.1

Bundles sygnal-check 0.8.1. The extension's own code doesn't change.

- **SYG427** is filed under the component that has the mistake (the one whose view or intent uses the import), not the imported name, and its fix says how the module does export the component: `import X from '…'` for a default export, `import { X } from '…'` for a named one.

## 0.5.0

Bundles sygnal-check 0.8.0 (Sygnal 6.4.0). The extension's own code doesn't change.

- **SYG427**: a component imported from a module that doesn't export it, used as a JSX tag, in `CHILD.select()` or as a Collection's `of` (the import is `undefined`; Vitest runs on, the browser fails to load the module).
- No false **SYG223** for a `uses` slice in `persist({ pick })`; **SYG609**'s fix names `makeServiceWorkerDriver` for an `SW` sink and `makeSocketDriver()` for a `WS` one.

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
