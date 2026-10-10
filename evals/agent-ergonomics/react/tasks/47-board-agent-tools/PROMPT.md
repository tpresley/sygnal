The team board in `src/` works for people. Make it operable by AI agents in the browser, through WebMCP.

A browser agent finds a page's tools on `document.modelContext` (some browsers only have `navigator.modelContext`; where neither exists, the app does nothing extra). A page registers a tool with `modelContext.registerTool(tool, { signal })`, where `tool` is `{ name, description, inputSchema, execute, annotations }` (`annotations` is optional): `inputSchema` is a JSON Schema object (`{ "type": "object", "properties": { … }, "required": [ … ] }`), `execute(input)` runs the tool and returns an object (or a promise of one), and aborting `signal` unregisters the tool. `annotations: { readOnlyHint: true }` marks a tool that changes nothing.

Register these tools when the app starts:

| Tool | Input | What it does |
|---|---|---|
| `board_read` | none | returns the board: every card's id, title and column |
| `board_add_card` | `title` (string, not blank), `column` (`"todo"`, `"doing"` or `"done"`) | adds a card to that column |
| `card_move` | `id` (a card's id), `column` | moves the card to that column |
| `card_remove` | `id` | removes the card, once the user agrees |

- Each tool's description tells an agent what it does, and its input schema lists its parameters: their types, the allowed columns, and which ones are required.
- A call has the same effect as doing it on the board by hand, and the board shows it at once. `execute` never throws: it resolves to `{ "ok": true, … }` when the call did what was asked. A call that can't be done (input that doesn't fit the schema, a card id that isn't on the board) changes nothing and resolves to `{ "ok": false, "error": "<what was wrong>" }`.
- `card_remove` asks the user first: it opens a modal `<dialog>` (with `showModal()`) that names the card, with "Allow" and "Deny" buttons. "Allow" removes the card and resolves to `{ "ok": true, … }`; "Deny" keeps it and resolves to `{ "ok": false, … }`. Either way the dialog closes. (jsdom has no `showModal()` or `close()`; where the app is tested in jsdom they are stubbed as a browser behaves.)
- Everything people can do on the board still works.
