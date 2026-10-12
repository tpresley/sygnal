# Compose a workspace

A decision model builds the page from parts the app prepared. You describe what you want ("open
tickets first, then recent orders"); the model only **picks and arranges** working Sygnal components.
It writes no text, props or markup, so every label, number and action on the page is the app's own.

This is the idea of [json-render](https://json-render.dev)'s experimental
[Jev composition](https://json-render.dev/docs/jev) (`experimental_composeSpec`) done with
`decide()` from `sygnal/ai`, on a local [Ollama](https://ollama.com) decision model such as
`nimble`, or on TypeSafe's Jev.

## Run it

```bash
npm install
npm run dev        # Ollama on http://localhost:11434 with a decision model (e.g. nimble)
npm test           # no Ollama needed: the replies are answers() fixtures
npm run try        # the labelled prompts against the local model, scored
```

Another Ollama host: `VITE_OLLAMA_URL=http://host:11434 npm run dev` (and `OLLAMA_URL=` for `npm run try`).

## How a composition works

Two `decide()` requests, both on the `HTTP` driver (`makeFetchDriver`), both in one `key: 'compose'`
lane so a new prompt aborts whatever is in flight:

1. **Select.** One `choice` per part (`omit` / `use`, the part's description as the criterion) and
   one `noul`: *does the request ask for things side by side?* The canvas shows the chosen parts at
   once, in catalog order (`SELECTED`). Nothing chosen means "nothing in the catalog fits".
2. **Layout** (2+ parts). One `choice` per pair: *which of these two comes higher on the page?*, and
   with the row on, *does this part go in the row or on the page?* (`ARRANGED`).

The rest is plain code in [`src/compose.js`](src/compose.js): the order is the summed pairwise
probabilities, and a row of one part is unwrapped. The decision panel shows every probability, so you
can see why the page looks the way it does.

The parts ([`src/parts.js`](src/parts.js)) are real components: tick a task or start typing feedback,
recompose, and the state is still there (it lives in the root state, `state="tasks"`,
`state="feedback"`).

## What the spike taught (nimble, 9B)

`npm run try` scores 11 labelled prompts. With the encoding here, nimble gets 9/11 exact layouts
and 0 wrong or missing parts, at about 3–4 s per composition on a laptop. Encodings that did worse:

| Tried | What happened | Now |
| --- | --- | --- |
| A `root` choice with one generic page vs `unavailable` | picked `unavailable` for valid requests | the page is fixed; nothing selected = unavailable |
| A list of every part in the select `state` | dropped parts the request named | the request alone is the state |
| *"Which position is this part in?"* (`Position N`) | answers collapsed to 1 | pairwise *"which comes higher?"* |
| *"Which part is k-th?"* per position | every position named the same part | pairwise |
| Counting rows (`0 / 1 / 2`) | rows added at ~45% when nobody asked | a `noul` gate: 1.0 vs ≤ 0.35 |

Descriptions matter as much as questions: "monthly revenue" on both the KPI and the chart pulled in
the KPI whenever the chart was asked for.

## TypeSafe Jev

`decide()` sends the same dictionary form TypeSafe's `/v1/systemone` takes. In the browser, point
`DECIDE_URL` at your own server route that adds the key (the browser never holds a provider key; see
the [decisions guide](https://sygnal.js.org/guide/ai-decisions/#keys-stay-on-the-server)). For the
script, keep the key in a file outside the repo and pass it with `--env-file`:

```bash
node --env-file=$HOME/.config/typesafe/env scripts/try-prompts.mjs   # TYPESAFE_API_KEY=...; MODEL=jev-latest
```

The same questions, unchanged, on both models (11 labelled prompts, 2026-10-11):

| Model | Exact layouts | Wrong or missing parts | Median per composition |
| --- | --- | --- | --- |
| `nimble` (Ollama 0.40.2, local, 9B) | 9/11 | 0 | ~3 s |
| `jev-latest` (TypeSafe API) | 9/11 | 1 | ~0.34 s |
