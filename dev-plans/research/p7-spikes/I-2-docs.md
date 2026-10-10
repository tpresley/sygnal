# Proposed text for `integration/editors.md` (I-2 → D-1)

Sections for Neovim, Helix, JetBrains and "any LSP editor", written for the docs site. The VS Code section (V-1) and the page intro belong to D-1. Status of each snippet:
- **Neovim** and **Helix** snippets: verified in I-2 (Neovim 0.12.6, Helix 25.07.1);
- **nvim-lspconfig on Neovim 0.10**: written from its docs, untested;
- **JetBrains**: the GUI steps are LSP4IJ's documented flow, and the template follows LSP4IJ 0.21.0's bundled templates. Neither ran end to end (I-2 §6). Re-check before publishing.

---

## Any editor with LSP support

Sygnal's checker runs as a language server: `sygnal-check lsp`, over stdio. Install `sygnal-check` in the project (`npm install -D sygnal-check`), then point your editor at this command:

```bash
npx --no-install sygnal-check lsp
```

- **Languages:** `javascript`, `javascriptreact`, `typescript`, `typescriptreact`. Add it next to your TypeScript server, not instead of it.
- **Root:** the project folder, the one with `package.json` or `sygnal-check.config.json`. The server checks one project per workspace folder, and a file outside every folder gets no findings.
- **What you get:**
  - findings as you type, including in files you haven't opened;
  - a hover with the explanation of each code;
  - quick fixes, plus "Suppress SYGnnn on this line";
  - "Fix all auto-fixable Sygnal problems" as the code action kind `source.fixAll.sygnal`.
- **Settings:** under the `sygnal` section, answered on `workspace/configuration` or passed as `initializationOptions`.

  | Setting | Type | Meaning |
  |---|---|---|
  | `strict` | boolean | also run the strict-mode rules |
  | `a11y` | `"warn"` \| `"error"` | severity of the accessibility findings |
  | `ignore` | string[] | codes to drop |
  | `paths` | string[] | what to check, relative to the folder |
  | `verbose` | boolean | also show info findings |
  | `trace.server` | `"off"` \| `"messages"` \| `"verbose"` | server logging |

  A setting you leave out falls back to `sygnal-check.config.json`. So the editor, the CLI and CI check the same way unless you override a setting in the editor.

If `npx` isn't on your editor's `PATH` (GUI apps on macOS often get a minimal one), use the project's binary instead: `./node_modules/.bin/sygnal-check lsp`, or `node node_modules/sygnal-check/bin/sygnal-check.js lsp`.

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

It runs alongside your TypeScript server (`ts_ls`, `vtsls`, …); Neovim merges the diagnostics.

**Settings.** Leave them out to follow `sygnal-check.config.json`, or override them per editor:

```lua
vim.lsp.config('sygnal', {
  -- …as above
  settings = { sygnal = { strict = true } },
})
```

**Using it:**
- **Diagnostics:** shown in the sign column and as virtual text. `vim.diagnostic.open_float()` (`<C-w>d`) also lists the related location of a paired finding, such as the component that selects a misspelled event.
- **Hover:** `K` shows the explanation of the finding under the cursor.
- **Quick fixes:** `gra` (or `:lua vim.lsp.buf.code_action()`) on a finding offers the fix and "Suppress SYGnnn on this line".
- **Fix all:** fixes everything auto-fixable in the buffer.

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
- **More than one project:** `:lua vim.lsp.buf.add_workspace_folder('/path/to/other')` adds a folder to the running server, and its findings appear too.

On macOS and Windows, Neovim reports files changed outside the editor to the server, for example after a `git checkout`. On Linux it doesn't. The server re-reads files at the next check either way, so findings catch up as soon as you edit or save.

**nvim-lspconfig.** On Neovim 0.11+, the snippet above works with or without nvim-lspconfig installed. On 0.10, register a custom server:

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

Add Sygnal to the JavaScript and TypeScript languages in `languages.toml`: either the project's `.helix/languages.toml` (commit it to share it) or `~/.config/helix/languages.toml`.

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

**Settings.** Leave them out to follow `sygnal-check.config.json`, or set them under a `sygnal` key:

```toml
[language-server.sygnal]
command = "npx"
args = ["--no-install", "sygnal-check", "lsp"]
config = { sygnal = { strict = true } }
```

**Using it:**
- **Diagnostics:** a gutter marker and a count in the statusline; the finding under the cursor shows inline. `space d` lists the file's findings, `space D` the whole project's, including files you haven't opened.
- **Hover:** `space k` shows the explanation.
- **Quick fixes:** `space a` on a finding offers the fix and "Suppress SYGnnn on this line".
- **Fix all:** Helix can't request a "fix all" action, so use the CLI on the current file, then reload it:

  ```
  :sh npx sygnal-check --fix %
  :reload
  ```
- **Monorepos:** to give each package its own project, add `roots = ["package.json"]` to the four `[[language]]` entries. Helix then adds each package as a workspace folder when you open one of its files.

Helix doesn't display related locations or the docs link of a finding. The hover has the full explanation, and `npx sygnal-check explain SYGnnn` prints it in a terminal. Helix also tells the server only about files it saves itself. After changes made outside the editor (a branch switch, a formatter), findings update at your next edit or save.

## JetBrains IDEs (IntelliJ IDEA, WebStorm, …)

Use the free **LSP4IJ** plugin by Red Hat. It works in every JetBrains IDE, Community editions included.

1. Install it: Settings → Plugins → Marketplace → "LSP4IJ".
2. Settings → Languages & Frameworks → **Language Servers** → `+` (New Language Server).
3. **Server** tab:
   - Name: `Sygnal`;
   - Command: `sh -c "npx --no-install sygnal-check lsp"`. On Windows use `cmd /C npx --no-install sygnal-check lsp`; or point at the project's binary, `$PROJECT_DIR$/node_modules/.bin/sygnal-check lsp`.
4. **Mappings** tab → File name patterns:

   | Pattern | Language ID |
   |---|---|
   | `*.js` | `javascript` |
   | `*.jsx` | `javascriptreact` |
   | `*.ts` | `typescript` |
   | `*.tsx` | `typescriptreact` |
5. **Configuration** tab: `{ "sygnal": {} }` follows `sygnal-check.config.json`. To override a setting, add it there, e.g. `{ "sygnal": { "strict": true } }`.
6. Open a component file. View → Tool Windows → Language Servers shows the server's status and an LSP console for troubleshooting.

Findings appear as warnings in the editor and the Problems view. Alt+Enter on one offers the quick fix and "Suppress SYGnnn on this line".

**Sharing the setup.** Save this directory in your repository and import it with New Language Server → Template → "Import from custom template…":

```
sygnal-lsp4ij/
  template.json
  settings.json              { "sygnal": {} }
  initializationOptions.json {}
```

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

*(D-1: confirm after the I-2 §6 manual run whether fix-all, related locations and the docs link work in LSP4IJ, and add a sentence for each.)*

---

## Notes for D-1

- The Helix fix-all workaround depends on `sygnal-check --fix <file>` accepting a single file path; it does (`--fix` takes the same inputs as the check).
- If the coordinator takes I-2 §5.1 (the docs URL as the hover link's text), the "Helix doesn't display … the docs link" sentence can drop "the docs link".
- If fix-all is ever offered without `context.only` (I-2 §5.3), drop the Helix `:sh` workaround.
