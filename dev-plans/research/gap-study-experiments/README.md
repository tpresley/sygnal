# 6.0 gap study: throwaway experiments

These experiments back two reports:
- [`../sygnal-6-gap-study.html`](../sygnal-6-gap-study.html), published at https://claude.ai/artifact/MxVtAh3FVeJtmnVCbd5zXL
- [`../view-intent-linking.html`](../view-intent-linking.html), published at https://claude.ai/artifact/ELiw7MwhZDoNL1LrchMT3U

They were written against main `6b7144e`. To run them, build the library at the repo root first (`npm run build`), then:

```bash
npm install --prefix dev-plans/research/gap-study-experiments
```

```bash
npm --prefix dev-plans/research/gap-study-experiments test
```

| File | What it shows | Expected result on `6b7144e` |
|---|---|---|
| `x1-immer.test.jsx` | Immer `produce` used as reducers (G-4) | **fails**: a no-op `produce` emits one extra state |
| `x2-rtl.test.jsx` | Testing Library + user-event under `dom: 'real'` (G-14) | **fails**: B-0, dropped keystrokes |
| `x2b-typing.test.jsx` | Keystroke timing at 0, 1, 5 and 20 ms (B-0) | **fails** at 0 and 1 ms |
| `x3-behaviors.test.jsx` | Reusable behavior merged at definition time (G-1) | passes |
| `x4-undo.test.jsx` | `undoable()` model wrapper (G-8) | passes |
| `x5-controls.test.jsx` + `controls.js` | "Controls": element tokens used as JSX tags | passes; it uses `Control.sel`, because `DOM.select` only accepts strings |
| `x6-semantic.test.jsx` | Native `name` attribute and role/label selection | passes |
| `x7-wrap.test.jsx` | A parent wrapper hearing clicks bubbling from inside children | **fails in the real DOM**: mock and real disagree (the test asserts the recommended mock semantics) |
| `x8-frag-iso.test.jsx` | DOM isolation of fragment-root components (B-1) | **fails in the real DOM**: the child loses its own events and the parent sees them |

The two corpus scripts need the eval trial outputs in `/private/tmp/sygnal-evals/trials`:
- `analyze.mjs` counts intent selector targets by element tag and checks whether the classes are also used in CSS.
- `names.mjs` compares action names with selector class names.
