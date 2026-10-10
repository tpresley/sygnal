# Changelog

## 0.1.0

First release.

- Runs `sygnal-check lsp`: Sygnal's static checker as a language server. Findings for the whole project as you type, a hover with each code's explanation, quick fixes, "Suppress SYGnnn on this line" and `source.fixAll.sygnal`.
- Uses the workspace's own `sygnal-check` (0.4.0 or later), or the bundled copy, shown in the status bar. An older workspace copy gets a one-time upgrade note. Restricted Mode runs only the bundled copy.
- Starts only in workspaces that use Sygnal (a `sygnal-check.config.json`, or a `package.json` that depends on `sygnal` / `sygnal-check`).
- Commands: Restart Server, Show Output, Explain Code…, Fix All in File.
- Settings `sygnal.strict`, `sygnal.a11y`, `sygnal.ignore`, `sygnal.paths`, `sygnal.verbose`, `sygnal.trace.server`, all per folder and unset by default (the config file decides).
- Snippets for `.jsx` and `.tsx`: a component (`sygcomp`), an `EFFECT` model entry (`sygeffect`), an `event()` model entry (`sygevent`).
