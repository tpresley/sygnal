# The docs lookup, not shipped

`sygnal-check docs <symbol>` (with its MCP `docs` tool) and the greppable `dist/reference.{json,md}` were built in this spike (README section 10) and failed their pre-registered rule on Haiku. They were taken out of what ships when the compact core went into 7.5, and their files moved here unchanged:

| File | Was |
|---|---|
| `build-reference.mjs` | `scripts/build-reference.mjs`, run by `npm run build` (its repo path now points four levels up) |
| `reference.test.js` | `test/reference.test.js` |
| `docs.js` | `sygnal-check/src/docs.js` (`sygnal-check docs`, the MCP tool's handler) |
| `docs.vtest.js` | `sygnal-check/test/docs.vtest.js` |

`build-reference.mjs` still runs from here (`tools/build-lookup-candidates.mjs` imports it to rebuild the eval candidates). The other three import paths relative to where they used to live, so they do not run from this folder; restoring them means moving them back and re-adding the `docs` branch in `sygnal-check/src/cli.js` and the tool in `src/mcp.js` (see this branch's history before the 7.5 merge).
