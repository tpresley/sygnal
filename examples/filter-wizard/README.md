# Filter wizard: a multi-step flow on the router

A small console of saved log and metric filters: a list, a filter's page, and a **New filter** wizard whose current step is in the URL. It uses `wizard()` and `<Outlet>`, which are experimental in 7.2 (outside semver).

```bash
npm install
npm run dev
npm test
```

```
/                              the filters
/filters/3                     one filter
/filters/new                   the wizard's first step (Describe)
/filters/new/keywords          Configure, for a logs filter
/filters/new/threshold         Configure, for a metrics filter
/filters/new/review            Review, with Create
/filters/new/created?filter=3  Created: the outcome, with the new filter's id as the flow key
```

## What it shows

- **The step in the URL** ([src/new-filter/NewFilter.jsx](src/new-filter/NewFilter.jsx)), with `url: { route, param, key, from }`:
  - Next, Back and the stepper navigate;
  - the browser's Back and Forward move between steps;
  - `from` makes `/filters/new` the first step's URL.
- **A deep link to a step you can't reach yet** goes to the first step that's incomplete. `/filters/new/review` with no name lands on Describe.
- **A shared `draft`:** every step reads and writes `state.draft`. Review has its own slice too: `creating`, `error`, reset on each visit by `visit`.
- **A step skipped by `when`, in a step group:** Keywords and Threshold are alternatives for one place in the flow. The draft's source picks one, and the stepper shows them as one entry, Configure.
- **The leave guard:** while the name isn't empty, the header link, any other link and the back button out of the flow open a `<dialog>` (`dirty`, `confirm`, `leave`, `stay`). Its copy is `state.wizard.dialog`; Review has its own. Moves inside the flow are never held.
- **Start over** (`reset`, `resetTo`), and **Create a similar filter** on Created (a step's `{ wizard: 'RESET', draft }`).
- **A GOTO with a `key`:** Review's create reply sends `{ wizard: 'GOTO', step: 'created', key }`. The flow had no key, so it adopts the new filter's id, and the URL gets `?filter=3`.
- **The outcome's work in the outcome step:** Review leaves `{ id, countMatches: true }` in the draft. [Created](src/new-filter/Created.jsx) sends the count from its `BOOTSTRAP` and clears the flag, so a reload doesn't count twice. A request sent from Review would be aborted as Review is left.
- **A reload keeps the flow:** the root persists it for the tab (`persist({ storage: 'session' })`), so a reload lands on the same step with the draft. Entering the wizard from another page starts a new flow ([src/App.jsx](src/App.jsx), the `ROUTE` reducer).
- **One outlet for the pages:** `<Outlet of={PAGES} current identity state={{ newFilter: 'flow' }} />`. Both wizard routes are one page, so the wizard host stays the same instance while its steps change.

The API is a fake with latency ([src/api.js](src/api.js)) behind `makeFetchDriver({ fetch })`. It lives in memory, so a reload forgets the filters you created.

## Tests

[src/app.test.js](src/app.test.js) renders the app with `renderComponent(App, { dom: 'real', router, url })`:
- the steps, the stepper, the browser's Back and Forward, and the `when` alternative;
- a deep link, a reload (the same `storage`), and a new flow from another page;
- the leave guard: Keep editing, Discard, the dialog's copy;
- creating: the HTTP fake's `t.requests` / `t.respond`, Created's count, a failed create, and one run end to end against the fake API;
- a step alone, its wizard messages in `t.sent('PARENT')`.

Guide: [Wizards](https://sygnal.js.org/guide/wizards/).
