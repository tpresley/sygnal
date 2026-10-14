---
title: Editor Setup
description: sygnal-check's findings, explanations, quick fixes, completions, go to definition, code lenses, wiring highlights and rename in VS Code, Claude Code, Neovim, Helix, JetBrains IDEs and any LSP editor, and how they share one config with the CLI, the Vite plugin and CI
---

:::note
The language server needs **sygnal-check 0.4.0** or later, the first version with it (`npm install -D sygnal-check@latest`). Projects created with `create-sygnal-app` 2.2.0 or later have it. Completions, go to definition and references, code lenses and rename need **sygnal-check 0.5.0** or later; with 0.4.0 you get the findings, hovers and quick fixes. Highlights need **sygnal-check 0.7.0** or later.
:::

`sygnal-check` runs as a language server, `sygnal-check lsp`. Your editor then shows its findings while you type, with the same rules and the same settings as the CLI, the Vite dev server and CI.

## What you get

Sygnal wires components together with strings: intent selectors, action names, EVENTS types, child components. TypeScript checks none of them. This component type-checks and runs, but the button does nothing, because the selector has a typo:

<!-- The selector typo below is deliberate: it is the SYG110 the page shows. -->
<!-- docs-check: skip -->
```jsx
function Counter({ state }) {
  return (
    <div className="counter">
      <button className="inc">+</button>
      <span>{state.count}</span>
    </div>
  )
}

Counter.initialState = { count: 0 }

Counter.intent = ({ DOM }) => ({
  INCREMENT: DOM.click('.incc'),
})

Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
}

export default Counter
```

The editor underlines `'.incc'` as soon as you write it:

```text
SYG110 Counter: selector '.incc' targets .incc, but Counter's view never renders that class, so this action never fires (did you mean '.inc'? The view renders className="inc")
```

- **Findings as you type**, for the whole project. A change in one file can create or clear a finding in another (EVENTS, child components, Collections), and those files are updated too, also when they aren't open.
- **Hover** on a finding: what the code means, why it fails silently, the fix, and the link to its entry in the [Error Reference](/reference/errors/).
- **Quick fixes**: the checker's suggestions, such as "Change '.incc' to '.inc'" or "Add a model entry for 'SAVE'". A fix can edit another file.
- **Fix all**: every mechanical fix in the file at once, the same edits as `sygnal-check --fix`.
- **Suppress**: "Suppress SYGnnn on this line" inserts a `// sygnal-ignore-next-line SYGnnn` comment above the finding (`{/* … */}` inside JSX children).

The server runs next to your TypeScript server, not instead of it.

The rest works on the names Sygnal wires by string, which TypeScript can't follow. The examples use the `Counter` above with the typo fixed (`'.inc'`); `|` marks the cursor.

### Completions

In a selector, the view's classes and ids:

```text
INCREMENT: DOM.click('.|')      →  .inc      class in Counter's view
```

After a `.` only classes are offered, after a `#` only ids. In a model key, the actions the intent triggers that have no model entry yet, with a snippet for the entry. With a `RESET` action added to the intent:

```text
Counter.model = {
  |                             →  RESET     intent action · Counter (no model entry)
}                                  inserts   RESET: (state, data) => ({ ...state })
```

`EVENTS.select('|')` offers the EVENTS types emitted anywhere in the project, `event('|')` the ones selected, `next('|')` the model's actions, and `<Collection from="|">` the state keys. Anywhere else (a plain string, a `title` attribute) the server adds nothing, so TypeScript's completions stand alone.

### Go to definition and references

Go to definition on `'.inc'` in `DOM.click('.inc')` jumps to `<button className="inc">` in the view. On the intent key `INCREMENT` it jumps to the model entry, and on the model key back to the intent. On `EVENTS.select('SAVED')` it lists every component that emits `SAVED`, in any file.

Find references on an action lists every place it is wired in the component (intent, model, `next()`, reply names); on an EVENTS type, every emitter and select in the project; on a class, the elements that render it and the selectors that use it. State keys, context entries and child components work the same way.

### Code lens

A line of text above each intent key, model key and EVENTS select or emit says what it connects to:

```text
handled by model.INCREMENT · STATE        above the intent key INCREMENT
triggered by intent                       above the model key INCREMENT
2 emitters                                above EVENTS.select('SAVED')
```

A missing link shows as `no model entry` or `not triggered`, exactly where SYG101 and SYG102 report one. Clicking a lens shows its targets.

### Highlights

The server marks Sygnal's wiring so you can see it at a glance: action names wherever they are wired, EVENTS types, intent selectors, the view classes, ids and controls an intent selects, and the child components a parent selects with `CHILD.select`. Classes no intent selects stay plain, so the elements that do something stand out.

A selector gets its own look when nothing renders it (the typo above: `'.incc'`), or when no static class does but a dynamic class name in the view might. Only names the checker resolved are marked, never a guess.

### Rename

Rename on `INCREMENT` (in the intent, the model or a `next('INCREMENT')`) renames every place it is wired: here the intent key and the model key. An EVENTS type is renamed in every emitter and select of the project, a class in the view and in the selectors.

Rename only edits when it can find every use, because a missed one is an action that silently never runs. It refuses, and says why, for a built-in such as `BOOTSTRAP`, a model built with a spread, a name built at run time, or the same string somewhere else in the code. Your editor's TypeScript rename can still take over for an identifier. Mentions of the name in test files (`simulateAction('INCREMENT')`, a test title) are a separate group that needs your confirmation; an editor that can't ask for one gets the code edits only, with a warning naming the test files it left out.

## VS Code

Install **Sygnal** (`sygnal.sygnal`) from the Visual Studio Marketplace or Open VSX, or from a terminal:

```bash
code --install-extension sygnal.sygnal
```

Projects made with `create-sygnal-app` recommend it in `.vscode/extensions.json`, so VS Code offers to install it when you open one. It needs VS Code 1.91 or later.

The extension starts the server only in a workspace folder that uses Sygnal: one with a `sygnal-check.config.json`, or a `package.json` that depends on `sygnal` or `sygnal-check`. In any other workspace it stays idle. Each Sygnal project in the workspace is checked on its own, including the apps of a monorepo ([how projects are found](#nothing-is-underlined)).

### Which sygnal-check it runs

1. **The project's own** `node_modules/sygnal-check`, when it is 0.4.0 or later. The editor then reports exactly what your CLI and CI report. Completions, go to definition, code lenses and rename need 0.5.0 or later.
2. Otherwise, **the copy bundled with the extension**. If the project has an older `sygnal-check`, the extension says so once and suggests `npm i -D sygnal-check@latest`.

Hover over **Sygnal** in the status bar to see the version in use and where it comes from. The server runs on VS Code's own Node.js, so the bundled copy needs no Node install.

In a workspace you haven't trusted (Restricted Mode), the extension runs only its bundled copy, never code from the workspace.

### Settings

Every setting is unset (`null`) by default, so the [config file](#the-config-file) decides. A setting you set overrides it. All of them can be set per workspace folder in `.vscode/settings.json`.

| Setting | Type | |
|---|---|---|
| `sygnal.strict` | boolean | Also run the [strict-mode](/guide/strict-mode/) rules, like `--strict` |
| `sygnal.a11y` | `"warn"` \| `"error"` | Severity of the [accessibility](/guide/accessibility/) findings (SYG7xx) |
| `sygnal.ignore` | string[] | Codes to drop, e.g. `["SYG105"]`. Replaces the config file's list |
| `sygnal.paths` | string[] | Files, directories or globs to check, relative to each project (e.g. `["pages"]` for Vike). Replaces the config file's list |
| `sygnal.verbose` | boolean | Also show info findings |
| `sygnal.codeLens` | boolean | Show the [code lenses](#navigation-code-lenses-and-rename) (unset: on). An editor setting only; the config file has no such key |
| `sygnal.highlights` | boolean | Show the [highlights](#highlights-in-vs-code) (unset: on). An editor setting only; the config file has no such key |
| `sygnal.trace.server` | `"off"` \| `"messages"` \| `"verbose"` | What the server logs to the Sygnal output |

To fix everything auto-fixable when you save:

```json title=".vscode/settings.json"
{
  "editor.codeActionsOnSave": { "source.fixAll.sygnal": "explicit" }
}
```

### Commands

| Command | |
|---|---|
| `Sygnal: Restart Server` | Restarts the server and picks the `sygnal-check` again, e.g. after you install it |
| `Sygnal: Show Output` | The server's log. Clicking **Sygnal** in the status bar does the same |
| `Sygnal: Explain Code…` | Pick any SYG code to read its explanation |
| `Sygnal: Fix All in File` | Applies every auto-fixable Sygnal fix in the active file |

Quick fixes are on `Ctrl+.` (`Cmd+.` on macOS), as usual.

### Navigation, code lenses and rename

With the extension 0.2.0 or later, and sygnal-check 0.5.0 or later (the bundled copy has it):

- **Completions** appear as you type in a selector, a model key, `EVENTS.select('`, `next('` and the other Sygnal strings, next to TypeScript's.
- **Go to Definition** (`F12`), **Peek Definition** (`Alt+F12`) and **Find All References** (`Shift+F12`) work on actions, EVENTS types, selectors, state keys and context entries.
- **Code lenses** show above intent keys, model keys and EVENTS selects / emits. Clicking one opens its targets in a peek view, so you can read each one without leaving the file. Turn them off with `"sygnal.codeLens": false`, or every extension's lenses with VS Code's `editor.codeLens`.
- **Rename Symbol** (`F2`) renames a Sygnal name everywhere it is wired. When Sygnal refuses, VS Code shows the reason and falls back to TypeScript's rename where TypeScript has one. When the rename also edits test files, VS Code opens the refactor preview so you can check those edits before applying them.

### Highlights in VS Code

With the extension 0.4.0 or later, drawn over your theme's colors:

| What | Look |
|---|---|
| Action names (intent keys, model keys, `next()`, reply names, ...) | bold, with a tint behind them; a wavy underline when no model entry handles the action |
| EVENTS types | italic |
| Intent selectors | dotted underline; dashed amber when only a dynamic class name might render it; struck through in red when nothing renders it |
| The view classes, ids and controls an intent selects | tinted |
| Child components selected with `CHILD.select` | underlined |

The colors are theme colors. Change them in your settings:

```json title=".vscode/settings.json"
{
  "workbench.colorCustomizations": {
    "sygnal.highlight.action": "#4FC1FF",
    "sygnal.highlight.actionBackground": "#4FC1FF26"
  }
}
```

The others are `sygnal.highlight.event`, `.target`, `.targetBackground`, `.unverified`, `.missing` and `.child`. VS Code uses only one semantic-token provider per file, so the extension draws these as decorations, and TypeScript's semantic highlighting stays as it is.

### Snippets

In `.jsx` and `.tsx` files, in the [canonical forms](/guide/strict-mode/):

| Prefix | Inserts |
|---|---|
| `sygcomp` | A component: destructured view, `intent`, object-form `model`, `initialState` (typed in `.tsx`) |
| `sygeffect` | A model entry with an `EFFECT` sink |
| `sygevent` | A model entry that updates state and emits a global event with `event()` |

## Claude Code

The Sygnal plugin gives Claude Code two things:

- **The `sygnal-dev` skill**: the workflow for building, testing and debugging Sygnal apps, in the canonical forms. Claude Code loads it when it works on Sygnal code. See [Building with AI Agents](/integration/agents/#the-sygnal-dev-skill).
- **sygnal-check's findings after edits.** The plugin runs the project's `sygnal-check lsp`. When Claude edits a file, Claude Code passes the new findings to Claude with its next request, so Claude sees a wiring bug without running the checker itself.

Install it in Claude Code:

```text
/plugin marketplace add tpresley/sygnal
/plugin install sygnal@sygnal
```

From a shell, the same is `claude plugin marketplace add tpresley/sygnal`, then `claude plugin install sygnal@sygnal`. Restart Claude Code (or run `/reload-plugins`) to load it.

### Requirements

- **sygnal-check 0.4.0 or later in the project** (`npm install -D sygnal-check`). The plugin never downloads a checker: it runs the copy installed in the project, as `npx --no-install sygnal-check lsp` would.
- **Node.js 18 or later** on the `PATH`.

Without a capable sygnal-check (none installed, or 0.3.x), the plugin's server stays idle for the session. Claude gets no findings and no errors, and the skill works as usual. Install sygnal-check and start a new session to turn the findings on.

On Windows, a checkout without symbolic links (Git's default there) installs the plugin without the skill. Copy `skills/sygnal-dev` into `.claude/skills/` by hand.

### How the findings arrive

- The server starts on Claude's first edit of a `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs` or `.cjs` file and checks the whole project.
- Claude Code adds new findings to Claude's next request after a tool call, at most 10 per file and 30 at a time, each identical finding once per session. They are the CLI's messages (`Component: problem (fix)`), so they make sense without the docs link.
- Findings in files Claude didn't touch are included, so a project that already has findings shows them after the first edit. `npx --no-install sygnal-check` lists the same ones.
- A finding left by Claude's last edit in a turn can arrive only after your next message.

The plugin sends no settings: the project's [config file](#the-config-file) decides, as for the CLI and CI.

### Turning the findings off

The installed plugin's manifest is read-only, so:

- disable the plugin for a project with `"enabledPlugins": { "sygnal@sygnal": false }` in `.claude/settings.local.json` (or `/plugin` → Installed), and copy the skill folder by hand if you still want it;
- or run a local copy of the repository's `editors/claude-code` folder with `"diagnostics": false` added to `lspServers.sygnal` in its `.claude-plugin/plugin.json`, through `claude --plugin-dir <copy>`. The server still runs, but its findings don't reach Claude.

### Adding the MCP server

The plugin doesn't start sygnal-check's [MCP server](/integration/agents/#mcp-server). To add it to a project, run this in the project:

```bash
claude mcp add --scope project sygnal-check -- npx --no-install sygnal-check mcp
```

It writes the server to the project's `.mcp.json`. Use `--scope user` for every project.

## Neovim

Neovim 0.11 and later configure language servers natively. Add this to your `init.lua`:

```lua title="init.lua"
vim.lsp.config('sygnal', {
  cmd = { 'npx', '--no-install', 'sygnal-check', 'lsp' },
  filetypes = { 'javascript', 'javascriptreact', 'typescript', 'typescriptreact' },
  root_markers = { 'sygnal-check.config.json', 'package.json', '.git' },
})
vim.lsp.enable('sygnal')
```

It runs alongside your TypeScript server (`ts_ls`, `vtsls`, …), and Neovim merges the diagnostics. To override the [config file](#the-config-file) in the editor, add `settings`:

```lua title="init.lua"
vim.lsp.config('sygnal', {
  -- …as above
  settings = { sygnal = { strict = true } },
})
```

- **Diagnostics** show in the sign column and as virtual text. `vim.diagnostic.open_float()` (`<C-w>d`) also lists the related location of a paired finding, such as the component that selects a misspelled event.
- **Hover:** `K` shows the explanation of the finding under the cursor.
- **Quick fixes:** `gra` (or `:lua vim.lsp.buf.code_action()`) on a finding offers the fix and "Suppress SYGnnn on this line".
- **Fix all** in the buffer:

  ```lua title="init.lua"
  vim.lsp.buf.code_action({ context = { only = { 'source.fixAll.sygnal' } }, apply = true })
  ```

  Map it to a key, or run it on save:

  ```lua title="init.lua"
  vim.api.nvim_create_autocmd('BufWritePre', {
    pattern = { '*.js', '*.jsx', '*.ts', '*.tsx' },
    callback = function()
      vim.lsp.buf.code_action({ context = { only = { 'source.fixAll.sygnal' } }, apply = true })
    end,
  })
  ```
- **More than one project:** `:lua vim.lsp.buf.add_workspace_folder('/path/to/other')` adds a folder to the running server.
- **Go to definition and references** (sygnal-check 0.5.0): `CTRL-]` (or `:lua vim.lsp.buf.definition()`) and `grr`. With your TypeScript server attached too, Neovim lists both servers' answers.
- **Rename:** `grn`. A refusal shows as an error message with the reason. Test files are left out, with a warning naming them.
- **Completions:** turn on Neovim's built-in LSP completion for the server when it attaches (a completion plugin such as nvim-cmp or blink.cmp picks up every attached server instead):

  ```lua title="init.lua"
  vim.api.nvim_create_autocmd('LspAttach', {
    callback = function(args)
      local client = vim.lsp.get_client_by_id(args.data.client_id)
      if client and client.name == 'sygnal' then
        vim.lsp.completion.enable(true, client.id, args.buf, { autotrigger = true })
      end
    end,
  })
  ```
- **Code lenses** show only after `vim.lsp.codelens.refresh()`, so refresh them on a few events:

  ```lua title="init.lua"
  vim.api.nvim_create_autocmd({ 'BufEnter', 'CursorHold', 'InsertLeave' }, {
    pattern = { '*.js', '*.jsx', '*.ts', '*.tsx' },
    callback = function() vim.lsp.codelens.refresh({ bufnr = 0 }) end,
  })
  ```

  `:lua vim.lsp.codelens.run()` runs the lens on the current line, which opens its first target.

- **Highlights** arrive as semantic tokens, and Neovim layers them over your TypeScript server's. Their highlight groups are `@lsp.type.<type>` and `@lsp.typemod.<type>.<modifier>`, which most color schemes leave unset, so give them colors:

  ```lua title="init.lua"
  vim.api.nvim_set_hl(0, '@lsp.type.sygnalAction', { fg = '#4FC1FF', bold = true })
  vim.api.nvim_set_hl(0, '@lsp.type.sygnalEvent', { fg = '#C586C0', italic = true })
  vim.api.nvim_set_hl(0, '@lsp.type.sygnalSelector', { fg = '#4EC9B0', underdotted = true })
  vim.api.nvim_set_hl(0, '@lsp.type.sygnalTarget', { fg = '#4EC9B0', bg = '#1F3A36' })
  vim.api.nvim_set_hl(0, '@lsp.type.sygnalChild', { fg = '#DCDCAA', underline = true })
  vim.api.nvim_set_hl(0, '@lsp.typemod.sygnalSelector.unverified', { fg = '#CCA700', underdashed = true })
  vim.api.nvim_set_hl(0, '@lsp.typemod.sygnalSelector.untargeted', { fg = '#F48771', strikethrough = true })
  vim.api.nvim_set_hl(0, '@lsp.typemod.sygnalAction.unhandled', { fg = '#4FC1FF', undercurl = true })
  ```

  `:Inspect` on a name shows its tokens.

On Linux, Neovim doesn't tell the server about files changed outside the editor (a `git checkout`, for example); on macOS and Windows it does. The server re-reads files at every check, so findings catch up at your next edit or save.

**Neovim 0.10 with nvim-lspconfig** (untested): register a custom server.

```lua title="init.lua"
local configs = require('lspconfig.configs')
if not configs.sygnal then
  configs.sygnal = {
    default_config = {
      cmd = { 'npx', '--no-install', 'sygnal-check', 'lsp' },
      filetypes = { 'javascript', 'javascriptreact', 'typescript', 'typescriptreact' },
      root_dir = require('lspconfig.util').root_pattern('sygnal-check.config.json', 'package.json', '.git'),
    },
  }
end
require('lspconfig').sygnal.setup({})
```

## Helix

Add Sygnal to the JavaScript and TypeScript languages in `languages.toml`: the project's `.helix/languages.toml` (commit it to share it) or `~/.config/helix/languages.toml`.

```toml title="languages.toml"
[language-server.sygnal]
command = "npx"
args = ["--no-install", "sygnal-check", "lsp"]

[[language]]
name = "javascript"
language-servers = ["typescript-language-server", "sygnal"]

[[language]]
name = "jsx"
language-servers = ["typescript-language-server", "sygnal"]

[[language]]
name = "typescript"
language-servers = ["typescript-language-server", "sygnal"]

[[language]]
name = "tsx"
language-servers = ["typescript-language-server", "sygnal"]
```

`language-servers` replaces Helix's default list, so keep `typescript-language-server` in it, first. Run `hx --health jsx` to check that both servers are found.

To override the [config file](#the-config-file) in the editor, add `config`:

```toml title="languages.toml"
[language-server.sygnal]
command = "npx"
args = ["--no-install", "sygnal-check", "lsp"]
config = { sygnal = { strict = true } }
```

- **Diagnostics:** a gutter marker and a count in the statusline; the finding under the cursor shows inline. `space d` lists the file's findings, `space D` the whole project's, including files you haven't opened.
- **Hover:** `space k` shows the explanation and the docs link.
- **Quick fixes and fix all:** `space a` on a finding offers its fix, "Suppress SYGnnn on this line" and, when the file has auto-fixable findings, "Fix all auto-fixable Sygnal problems".
- **Completions** (sygnal-check 0.5.0) appear in the menu next to TypeScript's.
- **Go to definition and references:** `gd` and `gr`.
- **Rename:** `space r`. A refusal shows its reason in the statusline. Test files are left out, with a warning naming them.
- **Code lenses:** Helix doesn't show code lenses, so there are none in Helix.
- **Highlights:** Helix doesn't support semantic tokens, so there are none in Helix.
- **Monorepos:** the server checks each Sygnal package as its own project by itself. To also give each package its own workspace folder, add `roots = ["package.json"]` to the four `[[language]]` entries. Helix then adds the package as a workspace folder when you open one of its files.

Helix doesn't display related locations. Helix also tells the server only about files it saves itself, so after changes made outside the editor (a branch switch, a formatter), findings update at your next edit or save.

## JetBrains IDEs (LSP4IJ)

Tested with IntelliJ IDEA Community 2025.2 and LSP4IJ 0.21: findings, hover and quick fixes.

Use the free **LSP4IJ** plugin by Red Hat. It works in every JetBrains IDE (IntelliJ IDEA, WebStorm, …), Community editions included.

1. Install it: Settings → Plugins → Marketplace → "LSP4IJ".
2. Settings → Languages & Frameworks → **Language Servers** → `+` (New Language Server).
3. **Server** tab:
   - Name: `Sygnal`;
   - Command: `sh -c "npx --no-install sygnal-check lsp"`. On Windows use `cmd /C npx --no-install sygnal-check lsp`, or point at the project's binary, `$PROJECT_DIR$/node_modules/.bin/sygnal-check lsp`.
4. **Mappings** tab → **File name patterns** (not Language or File type: IntelliJ IDEA Community has no JavaScript or TypeScript file types, so only patterns match there):

   | Pattern | Language ID |
   |---|---|
   | `*.js` | `javascript` |
   | `*.jsx` | `javascriptreact` |
   | `*.ts` | `typescript` |
   | `*.tsx` | `typescriptreact` |
5. **Configuration** tab: `{ "sygnal": {} }` follows the [config file](#the-config-file). To override a setting, add it there, e.g. `{ "sygnal": { "strict": true } }`.
6. Open a component file. View → Tool Windows → Language Servers shows the server's status and an LSP console.

Findings appear as warnings in the editor and the Problems view. Alt+Enter on one should offer the quick fix and "Suppress SYGnnn on this line".

LSP4IJ also supports completion, go to declaration, find usages, code lenses and rename, which the server offers from sygnal-check 0.5.0, and semantic tokens, which carry the [highlights](#highlights) from sygnal-check 0.7.0. These haven't been tested in a JetBrains IDE yet.

**Sharing the setup.** Save this directory in your repository and import it with New Language Server → Template → "Import from custom template…":

```text
sygnal-lsp4ij/
  template.json
  settings.json              { "sygnal": {} }
  initializationOptions.json {}
```

`template.json`:

```json title="sygnal-lsp4ij/template.json"
{
  "id": "sygnal-check",
  "name": "Sygnal",
  "programArgs": {
    "windows": "cmd /C npx --no-install sygnal-check lsp",
    "default": "sh -c \"npx --no-install sygnal-check lsp\""
  },
  "fileTypeMappings": [
    { "fileType": { "patterns": ["*.js", "*.mjs", "*.cjs"] }, "languageId": "javascript" },
    { "fileType": { "patterns": ["*.jsx"] }, "languageId": "javascriptreact" },
    { "fileType": { "patterns": ["*.ts", "*.mts", "*.cts"] }, "languageId": "typescript" },
    { "fileType": { "patterns": ["*.tsx"] }, "languageId": "typescriptreact" }
  ]
}
```

## Any other LSP editor

Any editor that starts a language server over stdio can run it. Install `sygnal-check` in the project (`npm install -D sygnal-check`), then point the editor at this command, with the project as its working directory:

```bash
npx --no-install sygnal-check lsp
```

- **Languages:** `javascript`, `javascriptreact`, `typescript`, `typescriptreact`. Add the server next to your TypeScript server.
- **Root:** the project folder, the one with `package.json` or `sygnal-check.config.json`. Inside a workspace folder, the server checks each Sygnal project on its own ([how projects are found](#nothing-is-underlined)), so a monorepo's root works too.
- **Fix all** is the code action kind `source.fixAll.sygnal`. It is also offered in the code-action menu when the cursor is on a finding and the file has auto-fixable ones, for editors that can't ask for an action kind.
- **Completions, definition, references and rename** (sygnal-check 0.5.0) are the standard requests. The completion trigger characters are `'` `"` `` ` `` `.` `#`. Rename supports `prepareRename` and refuses with error code `-32803`, the reason as its message. Test-file edits come as a separate annotated group with `needsConfirmation` for a client that supports change annotations; a client that doesn't gets the code edits only and a `window/showMessage` warning.
- **Code lens clicks:** the LSP has no standard "show these locations" command, so the server picks one. A client that lists `editor.action.showReferences` (or a `sygnal.showReferences` of its own) in `capabilities.experimental.commands.commands` gets that command with `[uri, position, locations]`. Otherwise a client with `window/showDocument` support gets the server command `sygnal.goTo`, which opens the first target. Otherwise the lenses are text only.
- **Highlights** are semantic tokens (`textDocument/semanticTokens/full`) with custom types: `sygnalAction`, `sygnalEvent`, `sygnalSelector`, `sygnalTarget` and `sygnalChild`, and the modifiers `declaration`, `handler`, `trigger`, `unhandled`, `untargeted` and `unverified`. Map them to colors in your editor. An editor that keeps only one semantic-token provider per file, as VS Code does, would lose TypeScript's: pass `initializationOptions: { semanticTokens: false }` and draw the decoded tokens of the `sygnal/highlights` request yourself ([protocol details](https://github.com/tpresley/sygnal/tree/main/sygnal-check#highlights)).
- **Settings**, under the `sygnal` section, answered on `workspace/configuration` or passed as `initializationOptions` (`workspace/configuration` wins):

  | Setting | Type | |
  |---|---|---|
  | `strict` | boolean | also run the strict-mode rules |
  | `a11y` | `"warn"` \| `"error"` | severity of the accessibility findings |
  | `ignore` | string[] | codes to drop |
  | `paths` | string[] | what to check, relative to each project |
  | `verbose` | boolean | also show info findings |
  | `codeLens` | boolean | show code lenses (default on) |
  | `highlights` | boolean | send highlights (default on) |
  | `trace.server` | `"off"` \| `"messages"` \| `"verbose"` | what the server logs |

  A setting you leave out falls back to the [config file](#the-config-file).

If `npx` isn't on your editor's `PATH` (GUI apps on macOS often get a minimal one), run the project's binary instead: `./node_modules/.bin/sygnal-check lsp`, or `node node_modules/sygnal-check/bin/sygnal-check.js lsp`.

The [sygnal-check README](https://github.com/tpresley/sygnal/tree/main/sygnal-check#language-server) lists the server's capabilities and protocol details.

## The config file

Put the project's settings in `sygnal-check.config.json` at the project root:

```json title="sygnal-check.config.json"
{
  "strict": true,
  "a11y": "error",
  "ignore": ["SYG105"],
  "paths": ["src", "pages"],
  "includeTests": false
}
```

Or under the `"sygnal-check"` key of `package.json`:

```json title="package.json"
{
  "name": "my-app",
  "sygnal-check": { "strict": true }
}
```

| Key | Type | Default | |
|---|---|---|---|
| `strict` | boolean | `false` | Also run the [strict-mode](/guide/strict-mode/) rules |
| `a11y` | `"warn"` \| `"error"` | `"warn"` | Severity of the [accessibility](/guide/accessibility/) findings |
| `ignore` | string[] | `[]` | Codes to drop entirely |
| `paths` | string[] | `["src"]` | Files, directories or globs to check, relative to the config file |
| `includeTests` | boolean | `false` | Also check `*.test.*` / `*.spec.*` files |

Projects made with `create-sygnal-app` have one with `{ "strict": true }`.

### One config for every tool

The editor, the CLI, CI, the MCP server and the Vite plugin run the same rules and read the same file:

| Where | How it checks |
|---|---|
| Editor | `sygnal-check lsp`, as you type, on unsaved text |
| Command line | `npx --no-install sygnal-check` |
| CI | the same command; it exits with code 1 on a warning or error |
| Vite dev server | the [`check` option](/integration/bundler-config/#the-sygnal-check-config-file): terminal, browser console, error overlay for errors |
| Agents | the [Claude Code plugin](#claude-code), the CLI, or the [MCP server](/integration/agents/#mcp-server) |

With no editor settings and no unsaved changes, the editor shows exactly what `sygnal-check` prints for the project. A CI step needs nothing but the command:

```bash
npx --no-install sygnal-check
```

Settings are taken from, highest first:

1. explicit options: editor settings, command-line flags, the Vite plugin's `check` options, the MCP tools' arguments;
2. `sygnal-check.config.json`;
3. the `"sygnal-check"` key in `package.json`;
4. the defaults.

An explicit option replaces the config's value (an `ignore` list is not merged). The project root is the first directory, from the working directory (for an editor, the file's project) upwards, with a `sygnal-check.config.json` or a `package.json`. If it has both, the file wins. A mistake in the config file is a SYG900 finding on that file, never a crash. The [sygnal-check README](https://github.com/tpresley/sygnal/tree/main/sygnal-check#configuration) has the details.

Suppression comments (`// sygnal-ignore SYG110`) work the same everywhere too.

## Troubleshooting

**Read the server's log.**
- VS Code: `Sygnal: Show Output`, or click **Sygnal** in the status bar. Set `sygnal.trace.server` to `"messages"` to log each check.
- Claude Code: the plugin's server writes to Claude Code's debug log (`claude --debug`).
- Neovim: `:checkhealth vim.lsp` shows whether the server attached to the buffer.
- Helix: `hx --health jsx`, then `:log-open` (start Helix with `-v` for more).
- JetBrains: View → Tool Windows → Language Servers, then the server's LSP console.

**sygnal-check is too old.** The language server needs sygnal-check 0.4.0 or later. Check with `npm ls sygnal-check`, and upgrade with `npm i -D sygnal-check@latest`. VS Code falls back to its bundled copy and says so once; the Claude Code plugin stays idle; other editors fail to start the server.

**No completions, code lenses or rename.** These need sygnal-check 0.5.0 or later; with 0.4.0 the server gives findings, hovers and quick fixes only. In VS Code, hover over **Sygnal** in the status bar to see the version in use.

**`npx` isn't found.** GUI editors often start with a minimal `PATH`. Use `./node_modules/.bin/sygnal-check lsp` as the command instead.

**Different findings than the CLI.** Check for editor settings that override the config file. Run the CLI from the file's project folder (the one with its `sygnal-check.config.json` or `package.json`), since that is where the config is looked up.

### Nothing is underlined

**The file is outside `paths`.** The server only checks the files in `paths`, which is `src` by default. When you open a Sygnal file outside them, the server says so once, for example:

> examples/foo/app.tsx isn't checked: it's outside sygnal-check's paths (src) for examples/foo. Add its folder to "paths" in sygnal-check.config.json.

When a project's `paths` match no file at all, it says *sygnal-check found no source files in src for …* instead. Claude Code doesn't show these messages; they are in the server's log.

Fix it in the project's `sygnal-check.config.json`. An app with its files at the top level needs `"paths": ["."]`. A Vike app keeps its components in `pages/`, so it needs `"paths": ["pages"]` (or `["src", "pages"]`):

```json title="sygnal-check.config.json"
{
  "paths": ["src", "pages"]
}
```

**Nested projects.** A workspace can hold several apps: a monorepo, or a repository with example apps. The server checks each file with its own project, the nearest folder above it, up to the workspace folder, that has either:

- a `sygnal-check.config.json`; or
- a `package.json` that depends on `sygnal` or `sygnal-check`, or has a `"sygnal-check"` key.

That project's config and `paths` apply, and `paths` are relative to it. A project is checked from the first time you open one of its files. If no folder qualifies, the workspace folder is the project. If an app isn't picked up, give it a `sygnal-check.config.json`; `{}` is enough.

**Other causes.** Test files are skipped unless `includeTests` is `true`. A file outside every workspace folder gets no findings, and neither does a project with no Sygnal components.
