> **Renamed 2026-10-02:** these experiments belong to the ecosystem plan, drafted as PLAN-4 and now **[PLAN-5](../../PLAN-5.md)**.

# Ecosystem experiments (throwaway)

These are the experiments behind the ecosystem research report ([`../ecosystem-survey.html`](../ecosystem-survey.html); private artifact https://claude.ai/artifact/3BYaNEUmLK5Z9w25cEHiXD) and [PLAN-5](../../PLAN-5.md). Each one is a Vitest + jsdom test against the built `sygnal` package (`file:../../..`), using `renderComponent(App, { dom: 'real' })`. All six passed on sygnal 5.4.0 (main `6b7144e`) on 2026-10-02.

```bash
npm --prefix dev-plans/research/ecosystem-experiments install
npm --prefix dev-plans/research/ecosystem-experiments test
```

Build the library first (`npm run build`): the experiments import `dist/`.

| # | Test | Shows | Glue code |
|---|---|---|---|
| E1 | `e1-webcomponents.test.jsx` | A custom element with shadow DOM: JSX props become element properties, `attrs={{}}` sets attributes, and composed `CustomEvent`s reach `intent` | none |
| E2 | `e2-react-island.test.jsx` | A React 19 component on a host vnode (`island.js` + `reactAdapter.js`); callbacks become bubbling DOM events on the host | ≈ 25 + 10 lines |
| E3 | `e3-zag.test.jsx` | A Zag.js dialog machine rendered with Sygnal JSX through a private snabbdom patch (`zag.js`, `zp()` prop normaliser); `open` controlled from state | ≈ 45 lines |
| E4 | `e4-table.test.jsx` | `@tanstack/table-core` v8 as a pure function of state in the view: sorting, filtering and pagination | none |
| E5 | `e5-query.test.jsx` | `@tanstack/query-core` as a driver (`queryDriver.js`): cache hit, key switching, invalidation. A reference for PLAN-3's cache (H-2…H-4) | ≈ 25 lines |
| E6 | `e6-preact-compat.test.jsx` | The E2 component running on `preact/compat` through the same `island()` | ≈ 6 lines |

**Notes:**
- `island()` returns a hand-built vnode, which must carry `children`, `text` and `elm` keys; otherwise Sygnal drops it.
- The first `zag.js` had a stale-props bug: props captured at mount overrode later ones.
- TanStack Table is on v9 now, with a new API. E4 pins v8.
- PLAN-5 W-1 replaces `island()` with `defineWidget` as a kind of PLAN-4 control (S-1).
