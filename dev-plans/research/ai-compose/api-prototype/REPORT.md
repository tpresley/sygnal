# Sygnal API prototypes (worker C)

Saved from the worker's hand-backs. Originally `examples/ai-compose-api/` in worktree
`agent-af0bf759fd25cbeb4` (uncommitted); copied here. To run, put it back under `examples/` (its
`sygnal` dependency is `file:../..`) and `npx vitest run`: 5 files, 26 tests, no network, both backends.

Files (`src/`): `lib/catalog.jsx` (defineCatalog, render, fromTree, byId, answer), `lib/backends.js`
(decisions(), llm(): `{ sink, start, reply, delta? }`), `lib/compose.js` (candidate A),
`lib/Composer.jsx` (candidate C), `lib/askUser.jsx` (in-chat cards), `lib/testing.js` (composeWith);
`app/` (AppA/B/C, ChatApp, catalog); tests `core.test.jsx`, `a-behavior.test.jsx`,
`bc-candidates.test.jsx`, `extras.test.jsx`, `chat-ui.test.jsx`.

## Core findings (core.test.jsx; no core change needed)

1. A component chosen at run time from a registry renders, and `CHILD.select(Comp)` hears it.
2. Several instances of one component with different `{ get, set }` lenses work.
3. Identity is `${sel}::${props.id ?? path}` per parent (`idOf` in src/core/instance.ts). With
   `id={nodeKey}` an instance (including `isolatedState`) survives moves between plain-element
   containers and sibling reorders; without it, a move re-creates it.
4. A container that is a *component* owns its slot children: a move re-creates the part and the
   part's PARENT stops at the container (host CHILD.select never fires). So containers are view
   functions.
5. Collection inside a part, host context, a part's own HTTP replies: all work.
6. Changing the component behind a node key disposes the old instance.

Optional core changes: identity from the vnode `key` (today `id` is both key and prop); "creator-owned
children" only if stateful container components are ever needed (large).

## Candidates

- **A (recommended): `compose` behavior.** `App.uses = { page: compose(catalog, { backend, form, prompt }) }`,
  `{catalog.render(state.page, state)}` in the view. Slice `{ prompt, status, layout, preview, pending,
  decisions, error, ui, local, composed }`; actions COMPOSE (a follow-up edit when a layout exists;
  `{ prompt, fresh: true }` starts over), SET_LAYOUT, REMOVE, CONTROL, DONE. Only `[backend.sink]` is
  declared. Same tests run per backend.
- **B: builders in the app's own model** (`backend.start/reply`, `catalog.render`): the layer A is
  built on; ~25 lines of model per app; the sink name in the model.
- **C: `<Composed commands={cmd} />` component**: parts become its children (relay needed for
  CHILD.select). Not worth shipping.

## In-chat agent UI (follow-up)

An agent action `'cards.ASK'` (tool `ui_cards_ask`) waits with `until` for the user's answer; a part
declared `result: true` answers through `PARENT: answer(props, value)`; the `askUser` behavior holds
`state.cards.byId` (each the composition shape), `renderCard` renders inline in the tool part, the
answered card is frozen (`<fieldset disabled>`, `frozen`/`answer` props) and persists. LLM backend: tool
input is the layout schema; decision backend: tool input `{ request }`, decisions() composes from
prepared parts (generated-text parts dropped). `catalog.render(slice, state, { at, scope, frozen, answer })`
generalizes rendering to many layouts.

Suggested elsewhere: agent `timeout: false` for human waits (prototype uses 2**31-1); chat "client
tools" (`addToolResult`-style: calls left `input-available`, answered by an action), keyed by toolCallId;
close the open card on STOP / SEND (gap found).
