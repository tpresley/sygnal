# Sygnal plugin for Claude Code

One install gives Claude Code two things for [Sygnal](https://sygnal.js.org) apps:

- **The `sygnal-dev` skill.** The workflow for building, testing and debugging Sygnal apps, with the canonical forms. Claude Code loads it when it works on Sygnal code. It is the repository's [`skills/sygnal-dev`](../../skills/sygnal-dev/), so you no longer copy that folder into `.claude/skills/` by hand.
- **sygnal-check's findings after edits.** The plugin runs the project's own [`sygnal-check lsp`](../../sygnal-check/README.md#language-server) language server. When Claude edits a `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs` or `.cjs` file, the server checks the whole project, and Claude Code passes new findings to the model with its next request, for example:

  ```text
  C.jsx: SYG110 Counter: selector '.incc' targets .incc, but Counter's view never renders that class, so this action never fires (did you mean '.inc'? The view renders className="inc")
  ```

## Install

In Claude Code:

```text
/plugin marketplace add tpresley/sygnal
/plugin install sygnal@sygnal
```

Or from a shell: `claude plugin marketplace add tpresley/sygnal`, then `claude plugin install sygnal@sygnal`. Restart Claude Code (or run `/reload-plugins`) to load it.

To try a local checkout instead: `claude --plugin-dir <sygnal checkout>/editors/claude-code`.

## Requirements

- **sygnal-check 0.11.0 or later in the project** (`npm install -D sygnal-check@^0.11.0`). Projects made with `create-sygnal-app` already have it. The plugin never downloads a checker: it runs the copy installed in the project, the one `npx --no-install sygnal-check lsp` runs.
- **Node.js 18 or later** on the `PATH`.

Without a compatible sygnal-check (none installed, or older than 0.11.0), the plugin's server writes one line to its stderr (Claude Code keeps it in its debug log) and stays idle for the session. Claude gets no findings and no errors, and the skill works as usual. Install sygnal-check 0.11 or later and start a new session to turn the findings on. Older servers cannot distinguish Sygnal 6 snapshot and binding contracts from the Sygnal 7 defaults. The current checker reads the installed library version per source package; the skill covers both versions.

## What to expect

- The server starts on Claude's first edit of a matching file, not at session start, so the first edit's own findings arrive with a later request.
- Claude Code delivers findings after a tool call, as a `<new-diagnostics>` reminder on the next request, not inside the edit's result. Each identical finding is delivered once per session, at most 10 per file and 30 at a time.
- It delivers findings for every file the server reports, including files Claude didn't touch. A project with existing findings shows up to 30 of them after the first edit. `npx --no-install sygnal-check` lists the same ones.
- A finding that Claude's last edit of a turn leaves behind can arrive only with your next message: Claude Code builds the attachment a few milliseconds after the tool result and doesn't wait for the server.
- The server reads `sygnal-check.config.json` (or the `sygnal-check` key in `package.json`), so it checks with the same settings as the CLI and CI.

## Settings

The plugin sends no settings of its own, so the project's config file decides (`strict`, `ignore`, `paths`, `a11y`, `verbose`). See [Configuration](../../sygnal-check/README.md#configuration).

## Turn the findings off

Each Claude Code LSP server has a `diagnostics` option. With `"diagnostics": false`, the server still runs (for the `LSP` tool's hover and navigation) but its findings aren't added to the model's context. The plugin's manifest is read-only once installed, so to turn the findings off:

- disable the whole plugin in a project: `"enabledPlugins": { "sygnal@sygnal": false }` in `.claude/settings.local.json` (or `/plugin` → Installed → disable), and copy the skill folder by hand if you still want it;
- or run a local copy of this folder with `"diagnostics": false` added to `lspServers.sygnal` in `.claude-plugin/plugin.json`, through `claude --plugin-dir <copy>`.

## Add the MCP server

The plugin doesn't start sygnal-check's MCP server (`check`, `graph` and `explain` as tools); agents use the CLI for the same things. To add it to a project, run this in the project:

```bash
claude mcp add --scope project sygnal-check -- npx --no-install sygnal-check mcp
```

It writes the server to the project's `.mcp.json`. Use `--scope user` for every project.

## Versions

The plugin's `version` in `.claude-plugin/plugin.json` decides updates: Claude Code keeps an installed copy until that string changes. Turn on auto-update for the `sygnal` marketplace under `/plugin` → Marketplaces, or run `claude plugin update sygnal@sygnal`.

## Layout

```text
.claude-plugin/marketplace.json     (repository root) the marketplace "sygnal", one entry: ./editors/claude-code
editors/claude-code/
  .claude-plugin/plugin.json         manifest; lspServers inline
  scripts/sygnal-lsp.mjs             starts the project's sygnal-check language server, or an idle stand-in
  skills/sygnal-dev -> ../../../skills/sygnal-dev
```

The skill is a symbolic link, so there is one copy of it in the repository. When Claude Code installs the plugin from the marketplace, it copies the link's target into its plugin cache. On Windows, a checkout without symbolic links (Git's default there) turns the link into a small text file, and the plugin then installs without the skill: copy `skills/sygnal-dev` into `.claude/skills/` by hand.
