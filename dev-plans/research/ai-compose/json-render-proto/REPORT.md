# json-render and Sygnal (worker B)

Saved from the worker's hand-back. The prototype here is `src/` (a Sygnal renderer for json-render
Specs, `specView.jsx`, 160 lines, 15 tests) and `scripts/` (`compose.mjs`: json-render's
`experimental_composeSpec` with a custom evaluator for TypeSafe / Ollama; `llm.mjs`,
`llm-structured.mjs`: its LLM paths on Ollama). To run it, clone vercel-labs/json-render, build
`vendor/json-render-core.mjs` from it (`npm run build:core` in the original scratch setup), then
`npm install --ignore-scripts && npm test`. Nothing was sent to the json-render project.

## Recommendation: stay independent

`sygnal/ai` gets its own schema-first format (parts with params schemas and slots; a node map).
No dependency on `@json-render/core`, no `@json-render/sygnal`, no wrapping `experimental_composeSpec`.
If users ask for interop: a separate package (hardened SpecView + Spec/catalog adapters, `@json-render/core`
as a peer), about a week. Borrow the good ideas: two-call select/layout batch, maxUses and exclusive
variants, step snapshots, autoFix-style repair.

## Evidence

- **Renderer**: easy for the core contract ($state/$bindState into a Sygnal slice, built-in actions as
  reducers, app actions to the host via PARENT, visibility, repeat, slots, streaming JSONL patches,
  real Sygnal components as parts through lenses). Full parity is ~3,000 source lines + 1,300–3,200 test
  lines per existing renderer, no shared conformance suite, and json-render component code (shadcn) is
  React-only. Friction: `slots` is a reserved Sygnal prop (SYG106), imperative emit/useBoundProp,
  repeat scope in events, onSuccess/onError/confirm chains, mutating path setters.
- **Size**: render-only helpers 3.0 KB gzip without zod, 95 KB with (module-level zod schemas defeat
  tree-shaking); `experimental_composeSpec` 110 KB. Sygnal's size gate is 42.7 KB; D209 would allow it
  only as an optional peer behind a subpath.
- **Stability**: 0.21 (21 minors), composer is `experimental_`.
- **Security**: `catalog.validate()` / `validateSpec()` accepted `on: { press: { action: 'deleteEverything' } }`
  (the schema has no `on`); the model writes state pointers and action names.
- **Decision models** through its composer (custom evaluator): Jev correct on "Sales overview"
  (0.58 s, 2 calls), a stray empty row on "My morning"; nimble correct then wrong root (the card became
  root). Its question builders are internal and its async-generator composer calls the evaluator itself
  (no Sygnal fetch driver, no `t.respond` in tests).
- **LLMs**: its contract is a 12 K-character prompt, not a schema. qwen3:8b JSONL: a malformed line
  silently dropped (no send button); llama3.1: `on` inside props, an invented action; qwen3:8b with
  `catalog.jsonSchema()` structured output: no `on`/`state` in the schema, strict mode degenerates.

| Option | Effort |
|---|---|
| (a) full `@json-render/sygnal` renderer | 3–5 weeks + 1–2 weeks for shadcn parts |
| (b) json-render composer in a driver | 2–3 days |
| (b) Spec/catalog import and export adapters | 2–4 days |
| (c) Sygnal-owned compose API | 1.5–3 weeks |
