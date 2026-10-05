# PLAN-5: agent-context drafts (not yet in `llms.txt` / SKILL.md)

Phase 4 syncs agent context within the budgets (`llms.txt` 24 lines left at 0-A, SKILL.md 39 B; P5-Q6). These are drafts only: nothing here is in `llms.txt` or `skills/sygnal-dev/SKILL.md` yet. Each block is written in `llms.txt`'s style (canonical forms only: tag + class selector; controls are the alternative form and are not shown).

## 1-W: widgets (W-1) and web components (W-3)

**Widgets, about 4 lines** (a `###` section, or appended to "Commands (parent → child), element commands, timers, persistence"):

```md
### Third-party widgets (date pickers, charts, editors)
- `defineWidget({ tag, mount(el, props, emit), update(instance, props), unmount(instance), events, commands })` makes a JSX tag: `const DatePicker = defineWidget({ tag: 'input', mount: (el, props, emit) => flatpickr(el, { defaultDate: props.value, onChange: ([d]) => emit('pick', d) }), update: (fp, props) => fp.setDate(props.value, false), unmount: (fp) => fp.destroy(), events: ['pick'], commands: { open: (fp) => fp.open() } })`.
- View: `<label>Due <DatePicker className="due" value={state.due} /></label>` (the host element; the widget owns its content and keeps its instance across renders). Intent: `DUE: DOM.select('.due').events('pick').detail()` (`.detail(fn?)` = e.detail). Model: `OPEN: { ELEMENT: { open: '.due' } }` runs the widget's command (it wins over a native method of the same name).
- List every emitted name in `events` and name them yourself (`'pick'`, not `'change'`: SYG140/144); `update` gets the newest props when they change (without it, a change remounts); a throwing `mount`/`update` renders the component's `onError` fallback in its place. Never `DOM.select(DatePicker)`: select its class (SYG143).
- Tests: `t.widget('.due').emit('pick', date)`, `t.widget('.due').props.value`; `dom: 'real'` mounts it (`.instance`). Guide: https://sygnal.js.org/guide/widgets/
```

**Web components, 1 fact line** (in "More (guides)" or next to the enriched streams):

```md
- Web components (Web Awesome, Shoelace) are elements: render the tag (`<wa-rating className="food" label="Food" value={state.food} />`, props set properties: `withClear`, not `with-clear`; attributes via `attrs={{ name: 'stars' }}`) and select it by class: `DOM.select('.food').events('change').value(Number)`, library events with any name: `DOM.select('.food').events('wa-hover').detail()`. Guide: https://sygnal.js.org/guide/web-components/
```

Line count: 5 (widgets block, with its heading) + 1 = 6 `llms.txt` lines; 5 without the heading if appended to an existing section. PLAN-5's docs rules estimated "≈ 4 lines + 1 fact line".

**SKILL.md:** with 39 B left, nothing fits. Candidate (≈ 160 B), if Phase 4 raises the cap or trims elsewhere: "Third-party widget → `defineWidget` tag + class selector + `.detail()`; web component → render its tag, select its class (guides: widgets, web-components)."
