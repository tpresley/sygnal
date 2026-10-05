# PLAN-5: agent-context drafts (not yet in `llms.txt` / SKILL.md)

Phase 4 syncs agent context within the budgets (`llms.txt` 24 lines left at 0-A, SKILL.md 39 B; P5-Q6). These are drafts only: nothing here is in `llms.txt` or `skills/sygnal-dev/SKILL.md` yet. Each block is written in `llms.txt`'s style (canonical forms only: tag + class selector; controls are the alternative form and are not shown).

## 1-W: widgets (W-1) and web components (W-3)

**Widgets, about 4 lines** (a `###` section, or appended to "Commands (parent → child), element commands, timers, persistence"):

```md
### Third-party widgets (date pickers, charts, editors)
- `defineWidget({ tag, mount(el, props, dispatch), update(instance, props), unmount(instance), events, commands })` makes a JSX tag: `const DatePicker = defineWidget({ tag: 'input', mount: (el, props, dispatch) => flatpickr(el, { defaultDate: props.value, onChange: ([d]) => dispatch('pick', d) }), update: (fp, props) => fp.setDate(props.value, false), unmount: (fp) => fp.destroy(), events: ['pick'], commands: { open: (fp) => fp.open() } })`.
- View: `<label>Due <DatePicker className="due" value={state.due} /></label>` (the host element; the widget owns its content and keeps its instance across renders). Intent: `DUE: DOM.select('.due').events('pick').detail()` (`.detail(fn?)` = e.detail). Model: `OPEN: { ELEMENT: { open: '.due' } }` runs the widget's command (it wins over a native method of the same name).
- List every dispatched name in `events` and name them yourself (`'pick'`, not `'change'`: SYG140/144); `update` gets the newest props when they change (without it, a change remounts); a throwing `mount`/`update` renders the component's `onError` fallback in its place. Never `DOM.select(DatePicker)`: select its class (SYG143).
- Tests: `t.widget('.due').emit('pick', date)`, `t.widget('.due').props.value`; `dom: 'real'` mounts it (`.instance`). Guide: https://sygnal.js.org/guide/widgets/
```

**Web components, 1 fact line** (in "More (guides)" or next to the enriched streams):

```md
- Web components (Web Awesome, Shoelace) are elements: render the tag (`<wa-rating className="food" label="Food" value={state.food} />`, props set properties: `withClear`, not `with-clear`; attributes via `attrs={{ name: 'stars' }}`) and select it by class: `DOM.select('.food').events('change').value(Number)`, library events with any name: `DOM.select('.food').events('wa-hover').detail()`. Guide: https://sygnal.js.org/guide/web-components/
```

Line count: 5 (widgets block, with its heading) + 1 = 6 `llms.txt` lines; 5 without the heading if appended to an existing section. PLAN-5's docs rules estimated "≈ 4 lines + 1 fact line".

**SKILL.md:** with 39 B left, nothing fits. Candidate (≈ 160 B), if Phase 4 raises the cap or trims elsewhere: "Third-party widget → `defineWidget` tag + class selector + `.detail()`; web component → render its tag, select its class (guides: widgets, web-components)."

## 1-F1: forms (F-1, D193)

**Forms, 6 lines** (a `###` section after "Behaviors (`uses`)", which it builds on; canonical: the `form` behavior; the helpers stay in the guide as the escape hatch):

```md
### Forms with validation
- `Signup.uses = { form: form(schema, { values: { email: '', addresses: [{ id: 1, city: '' }] }, submit: 'SIGN_UP' }) }`, any Standard Schema (zod, valibot, or `{ '~standard': { version: 1, vendor, validate } }`). Fields inside the `<form>` are matched by `name`, a path in `values` (array rows by id: `addresses.7.city`): no intent per field.
- View: `const f = state.form.fields`; `<input id={uid('email')} name="email" value={f.email.value} aria-invalid={f.email.invalid} aria-describedby={uid('email-error')} />`, `<p id={uid('email-error')}>{f.email.error}</p>`, a `<label for={uid('email')}>`. `f.x.error` is what to show (after blur or a submit); also `state.form.submitting`, `state.form.error` (form-level).
- An invalid submit shows every error and focuses the first invalid field; a valid one dispatches `SIGN_UP` with the schema's output: `SIGN_UP: { HTTP: (state, values) => ({ url, method: 'POST', json: values, ok: 'form.DONE', error: 'form.ERRORS' }) }`; `form.ERRORS` puts the server's `{ errors: { field: msg } }` on the fields.
- Rows: `<Collection of={Row} from={{ get: (s) => s.form.values.addresses }} fields={f} />`, `'form.ADD': DOM.click('.add').mapTo({ field: 'addresses', value: { city: '' } })`, Row `REMOVE: { PARENT: (s) => ({ field: 'addresses', id: s.id }) }` + host `'form.REMOVE': CHILD.select(Row)`.
- Async check: `check: { email: { request: (email) => ({ url: '/api/email-free', query: { email } }), error: (body) => !body.free && 'Taken' } }` (on blur; a submit waits for it; `f.email.pending`). Tests: `t.simulateEvent('[name="email"]', 'input', { value })`, `'focusout'`, `'submit'` on the form; `t.state.form.fields.email.error`. Guide: https://sygnal.js.org/guide/forms/
```

Line count: 6 with the heading (5 bullets). It relies on the Behaviors section (`uses`, namespaced actions, host entries run after the behavior's) and the reply-action facts (`ok`/`error`), so it doesn't repeat them.

**SKILL.md** (≈ 150 B, if Phase 4 makes room): "Form with validation → `uses = { form: form(schema, { values, submit }) }`, inputs by `name`, `state.form.fields.x.error` (guide: forms); helpers only when the behavior doesn't fit."

## 2-B: browser sources (B-3) and deferred lazy loading (B-4)

**One guide-pointer line** (in "More (guides)", next to timers):

```md
- Browser sources: `Card.browser = (state) => ({ seen: !state.seen && { intersection: '.cover', action: 'SEEN' }, dark: { media: '(prefers-color-scheme: dark)', action: 'DARK' } })` + `run(App, { BROWSER: makeBrowserDriver() })` (also `resize`, `storage`, `visibility`, `online`, `geolocation`; clipboard: `{ BROWSER: { copy: text, ok } }`; tests: `t.browser.intersect('.cover', true)`); `lazy(() => import('./Chart'), { when: 'visible' })` defers the import. Guide: https://sygnal.js.org/guide/browser-sources/
```

Line count: 1. **SKILL.md** (≈ 120 B, if Phase 4 makes room): "Watch visibility/size/media/storage/network → `browser` static + `makeBrowserDriver()` (guide: browser-sources)."

## 2-A: Collection move transitions (A-1)

**No new line**: extend the existing View Transitions entry in "More (guides)":

```md
View Transitions (`viewTransitions = ['MOVE']` + `makeViewTransitionDOMDriver`; `<Collection viewTransitionName="card" />` names each item `card-<id>` so moves and reorders animate, across Collections with the same prefix) https://sygnal.js.org/guide/view-transitions/
```

Line count: 0 (the existing line grows by ≈ 120 B). SKILL.md: nothing.
