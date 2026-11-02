# Adaptive UI lab

A stress test of `sygnal/ai`'s composed UI beyond "place finished components on a page". Two labs:

- **Form from pieces** ([`src/intake/`](src/intake)): you describe a task ("I left my work laptop on
  the train"); a model assembles an intake form from field pieces, writes their labels and
  questions, and the app grows the form while you fill it in (a "critical" urgency adds an
  approver, an amount of 500 or more adds a receipts upload, details mentioning a laptop add the
  device field). You can change it in words ("also ask who attended") or remove a piece.
- **Self-arranging board** ([`src/board/`](src/board)): a simulated morning on call. As incidents
  open, the queue backs up and a deploy rolls back, the board is arranged again around what needs
  you, either by deterministic rules or by the model from a brief the app writes. You can pin a
  card to the top or snooze it; the model is told, and the app enforces it on the model's layout.
  Cards keep their instances (and the note you are typing) while the board moves.

What each one exercises, and what broke or chafed on the way, is in [FINDINGS.md](FINDINGS.md).

## Run it

```bash
npm install
npm run dev     # Ollama on http://localhost:11434 with a chat model: ollama pull qwen3:8b
npm test        # no model needed: composeWith answers with compose.llm()'s own replies
```

Another model or host: `VITE_MODEL=llama3.1 VITE_OLLAMA_URL=http://host:11434 npm run dev`. Both
labs need a chat model (`compose.llm()`): their catalogs use free-text params (labels, questions,
a "why" on every card), which a decision model can't fill. The board's rules mode needs no model.

## How it works

**The form** is one `form()` behavior in the host, whatever the model placed. The field pieces
are catalog parts declared with `render` (view functions), not `component`: they render inline in
the host's `<form className="intake">`, so the form behavior hears them by `name`. Which fields
are required depends on the composed form, so the app checks that itself on submit
(`missingNames` in [`catalog.jsx`](src/intake/catalog.jsx)). The rules that grow the form
([`adapt.js`](src/intake/adapt.js)) are watched with `STATE.watch(nextRule)` and sent to the model
as follow-up edits, which keep the other pieces' node keys and so what was typed.

**The board** scores every part ([`attention.js`](src/board/attention.js)): a band (`act`, `watch`,
`calm`) and a one-line reason. `STATE.watch` on the bands (not the scores) plus the pins and
snoozes decides when to arrange again. The rules turn the scores into a tree (`fromTree` →
`page.SET_LAYOUT`); the model gets a written brief and composes fresh. Incident cards are
components bound to their record with `byId`, the rest are view functions. While the model
writes, its preview merges over the current board (compose's default `preview: 'merge'`), so the
cards it hasn't placed yet stay mounted.
