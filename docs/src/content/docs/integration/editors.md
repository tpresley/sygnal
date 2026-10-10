---
title: Editor Setup
description: sygnal-check's findings, explanations and quick fixes in VS Code, Claude Code, Neovim, Helix, JetBrains IDEs and any LSP editor, and how they share one config with the CLI, the Vite plugin and CI
---

:::note[Upcoming]
Everything on this page needs **sygnal-check 0.4.0**, the first version with the language server. sygnal-check 0.4.0, the VS Code extension and the Claude Code plugin are not released yet at the time of writing. Until they are, the CLI and the [Vite plugin](/integration/bundler-config/#plugin-options) check your code as before.
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

## VS Code

Install **Sygnal** (`sygnal.sygnal`) from the Visual Studio Marketplace or Open VSX, or from a terminal:

```bash
code --install-extension sygnal.sygnal
```

Projects made with `create-sygnal-app` recommend it in `.vscode/extensions.json`, so VS Code offers to install it when you open one. It needs VS Code 1.91 or later.

The extension starts the server only in a workspace folder that uses Sygnal: one with a `sygnal-check.config.json`, or a `package.json` that depends on `sygnal` or `sygnal-check`. In any other workspace it stays idle. Each workspace folder is checked as its own project.

### Which sygnal-check it runs

1. **The project's own** `node_modules/sygnal-check`, when it is 0.4.0 or later. The editor then reports exactly what your CLI and CI report.
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
| `sygnal.paths` | string[] | Files, directories or globs to check, relative to the folder (e.g. `["pages"]` for Vike). Replaces the config file's list |
| `sygnal.verbose` | boolean | Also show info findings |
| `sygnal.trace.server` | `"off"` \| `"messages"` \| `"verbose"` | What the server logs to the Sygnal output |

To fix everything auto-fixable when you save:

```json
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

```lua
vim.lsp.config('sygnal', {
  cmd = { 'npx', '--no-install', 'sygnal-check', 'lsp' },
  filetypes = { 'javascript', 'javascriptreact', 'typescript', 'typescriptreact' },
  root_markers = { 'sygnal-check.config.json', 'package.json', '.git' },
})
vim.lsp.enable('sygnal')
```

It runs alongside your TypeScript server (`ts_ls`, `vtsls`, …), and Neovim merges the diagnostics. To override the [config file](#the-config-file) in the editor, add `settings`:

```lua
vim.lsp.config('sygnal', {
  -- …as above
  settings = { sygnal = { strict = true } },
})
```

- **Diagnostics** show in the sign column and as virtual text. `vim.diagnostic.open_float()` (`<C-w>d`) also lists the related location of a paired finding, such as the component that selects a misspelled event.
- **Hover:** `K` shows the explanation of the finding under the cursor.
- **Quick fixes:** `gra` (or `:lua vim.lsp.buf.code_action()`) on a finding offers the fix and "Suppress SYGnnn on this line".
- **Fix all** in the buffer:

  ```lua
  vim.lsp.buf.code_action({ context = { only = { 'source.fixAll.sygnal' } }, apply = true })
  ```

  Map it to a key, or run it on save:

  ```lua
  vim.api.nvim_create_autocmd('BufWritePre', {
    pattern = { '*.js', '*.jsx', '*.ts', '*.tsx' },
    callback = function()
      vim.lsp.buf.code_action({ context = { only = { 'source.fixAll.sygnal' } }, apply = true })
    end,
  })
  ```
- **More than one project:** `:lua vim.lsp.buf.add_workspace_folder('/path/to/other')` adds a folder to the running server.

On Linux, Neovim doesn't tell the server about files changed outside the editor (a `git checkout`, for example); on macOS and Windows it does. The server re-reads files at every check, so findings catch up at your next edit or save.

**Neovim 0.10 with nvim-lspconfig** (untested): register a custom server.

```lua
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

```toml
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

```toml
[language-server.sygnal]
command = "npx"
args = ["--no-install", "sygnal-check", "lsp"]
config = { sygnal = { strict = true } }
```

- **Diagnostics:** a gutter marker and a count in the statusline; the finding under the cursor shows inline. `space d` lists the file's findings, `space D` the whole project's, including files you haven't opened.
- **Hover:** `space k` shows the explanation and the docs link.
- **Quick fixes and fix all:** `space a` on a finding offers its fix, "Suppress SYGnnn on this line" and, when the file has auto-fixable findings, "Fix all auto-fixable Sygnal problems".
- **Monorepos:** to give each package its own project, add `roots = ["package.json"]` to the four `[[language]]` entries. Helix then adds each package as a workspace folder when you open one of its files.

Helix doesn't display related locations. Helix also tells the server only about files it saves itself, so after changes made outside the editor (a branch switch, a formatter), findings update at your next edit or save.

## JetBrains IDEs (LSP4IJ)

:::caution[Not fully tested]
This setup was tested only up to the server definition: the steps follow LSP4IJ's documented flow, but haven't run end to end in an IDE yet. Please [report problems](https://github.com/tpresley/sygnal/issues).
:::

Use the free **LSP4IJ** plugin by Red Hat. It works in every JetBrains IDE (IntelliJ IDEA, WebStorm, …), Community editions included.

1. Install it: Settings → Plugins → Marketplace → "LSP4IJ".
2. Settings → Languages & Frameworks → **Language Servers** → `+` (New Language Server).
3. **Server** tab:
   - Name: `Sygnal`;
   - Command: `sh -c "npx --no-install sygnal-check lsp"`. On Windows use `cmd /C npx --no-install sygnal-check lsp`, or point at the project's binary, `$PROJECT_DIR$/node_modules/.bin/sygnal-check lsp`.
4. **Mappings** tab → File name patterns:

   | Pattern | Language ID |
   |---|---|
   | `*.js` | `javascript` |
   | `*.jsx` | `javascriptreact` |
   | `*.ts` | `typescript` |
   | `*.tsx` | `typescriptreact` |
5. **Configuration** tab: `{ "sygnal": {} }` follows the [config file](#the-config-file). To override a setting, add it there, e.g. `{ "sygnal": { "strict": true } }`.
6. Open a component file. View → Tool Windows → Language Servers shows the server's status and an LSP console.

Findings appear as warnings in the editor and the Problems view. Alt+Enter on one should offer the quick fix and "Suppress SYGnnn on this line".

**Sharing the setup.** Save this directory in your repository and import it with New Language Server → Template → "Import from custom template…":

```text
sygnal-lsp4ij/
  template.json
  settings.json              { "sygnal": {} }
  initializationOptions.json {}
```

`template.json`:

```json
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
- **Root:** the project folder, the one with `package.json` or `sygnal-check.config.json`. The server checks one project per workspace folder.
- **Fix all** is the code action kind `source.fixAll.sygnal`. It is also offered in the code-action menu when the cursor is on a finding and the file has auto-fixable ones, for editors that can't ask for an action kind.
- **Settings**, under the `sygnal` section, answered on `workspace/configuration` or passed as `initializationOptions` (`workspace/configuration` wins):

  | Setting | Type | |
  |---|---|---|
  | `strict` | boolean | also run the strict-mode rules |
  | `a11y` | `"warn"` \| `"error"` | severity of the accessibility findings |
  | `ignore` | string[] | codes to drop |
  | `paths` | string[] | what to check, relative to the folder |
  | `verbose` | boolean | also show info findings |
  | `trace.server` | `"off"` \| `"messages"` \| `"verbose"` | what the server logs |

  A setting you leave out falls back to the [config file](#the-config-file).

If `npx` isn't on your editor's `PATH` (GUI apps on macOS often get a minimal one), run the project's binary instead: `./node_modules/.bin/sygnal-check lsp`, or `node node_modules/sygnal-check/bin/sygnal-check.js lsp`.

The [sygnal-check README](https://github.com/tpresley/sygnal/tree/main/sygnal-check#language-server) lists the server's capabilities and protocol details.

## The config file

Put the project's settings in `sygnal-check.config.json` at the project root:

```json
{
  "strict": true,
  "a11y": "error",
  "ignore": ["SYG105"],
  "paths": ["src", "pages"],
  "includeTests": false
}
```

Or under the `"sygnal-check"` key of `package.json`:

```json
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

An explicit option replaces the config's value (an `ignore` list is not merged). The project root is the first directory, from the working directory (the workspace folder, for an editor) upwards, with a `sygnal-check.config.json` or a `package.json`. If it has both, the file wins. A mistake in the config file is a SYG900 finding on that file, never a crash. The [sygnal-check README](https://github.com/tpresley/sygnal/tree/main/sygnal-check#configuration) has the details.

Suppression comments (`// sygnal-ignore SYG110`) work the same everywhere too.

## Troubleshooting

**Read the server's log.**
- VS Code: `Sygnal: Show Output`, or click **Sygnal** in the status bar. Set `sygnal.trace.server` to `"messages"` to log each check.
- Claude Code: the plugin's server writes to Claude Code's debug log (`claude --debug`).
- Neovim: `:checkhealth vim.lsp` shows whether the server attached to the buffer.
- Helix: `hx --health jsx`, then `:log-open` (start Helix with `-v` for more).
- JetBrains: View → Tool Windows → Language Servers, then the server's LSP console.

**sygnal-check is too old.** The language server needs sygnal-check 0.4.0 or later. Check with `npm ls sygnal-check`, and upgrade with `npm i -D sygnal-check@latest`. VS Code falls back to its bundled copy and says so once; the Claude Code plugin stays idle; other editors fail to start the server.

**`npx` isn't found.** GUI editors often start with a minimal `PATH`. Use `./node_modules/.bin/sygnal-check lsp` as the command instead.

**No findings in a file.** The server only checks the files in `paths` (default `src`). A Vike app keeps its components in `pages/`, so set `"paths": ["pages"]` (or `["src", "pages"]`) in the config file. Test files are skipped unless `includeTests` is `true`. A file outside every workspace folder gets no findings, and neither does a folder with no Sygnal components.

**Different findings than the CLI.** Check for editor settings that override the config file, and run the CLI from the same folder the editor opened, since that is where the config is looked up.
