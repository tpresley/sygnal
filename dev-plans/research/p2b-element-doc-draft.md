# Draft: "Publishing a component as a custom element"

For PLAN-5's shared "Web components" guide, "Publishing" section (D104, S-11). Written by PLAN-4 P-2b (`p4-p2b-element`, `bf36b39`). The snippets mirror the tested scratch package in `dev-plans/research/p2-elements/`; run them verbatim before publishing.

```js
import { defineElement } from 'sygnal/element'
import Board from './Board.jsx'

defineElement('task-board', Board, {
  props: { heading: String, tasks: Array, readonly: Boolean },  // or ['a', 'b'] (all String)
  events: { PARENT: 'task-picked' },
  shadow: true,                                                 // true | 'open' | 'closed'
  styles: '.title { color: green }',                            // string | CSSStyleSheet | array
})
```

```html
<task-board heading="Today" readonly tasks='[{"id":"a","name":"Alpha"}]'></task-board>
<script type="module">
  document.querySelector('task-board').addEventListener('task-picked', (e) => console.log(e.detail))
</script>
```

- **Props → state.** Each declared prop is a property and a kebab-case attribute (`dueDate` ↔ `due-date`). Attributes are parsed: Number, Boolean (by presence), and Object/Array as JSON. Bad JSON is ignored. Props are in state from the first render (`initialState` overlaid with the props), and later changes are merged into state. There is no reflection from state back to attributes.
- **Sinks → events.** `events` maps sink names to `CustomEvent` names (`bubbles`, `composed`, `detail` = the value). For `PARENT`, `detail` is the value the model returned. Several sinks can be mapped. `DOM`, `STATE` and `EVENTS` can't be mapped.
- **Avoid prop names that are `HTMLElement` members** (`title`, `hidden`, `id`, `lang` …): they replace the native behaviour, and dev mode warns.
- **Lifecycle.** Each connected element is its own app. Removing it disposes the app; moving it keeps it running; re-adding it starts fresh. Elements don't share the host app's `EVENTS` bus.
- **Shadow DOM.** DOM events work inside it. Events leave it retargeted to the host. `styles` are adopted once per definition; without `shadow`, style the element from the page.
- **React 19.** Define the element before the first render (import the module before `createRoot().render`), so arrays and objects arrive as properties. Listen with the exact, lowercase name: `ontask-picked={…}` (not `onTaskPicked`). Ship the element prebuilt (or scope the Sygnal JSX transform), since one Vite project can't easily run both JSX transforms.
- **HMR.** With `sygnal/vite`, a module that calls `defineElement` at the top level hot-reloads: every live element swaps to the new component and keeps its state. Without the plugin, add `if (import.meta.hot) import.meta.hot.accept()`. Changing `props` needs a reload.
- **Limits.** Plain function components only (not `component()` results). Client-only (no SSR or Declarative Shadow DOM hydration). No slots or children, and no form association.
