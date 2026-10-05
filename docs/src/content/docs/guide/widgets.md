---
title: Widgets
description: defineWidget wraps a third-party widget (a date picker, a chart, an editor) as a JSX tag with events, commands, tests and server rendering
---

Most UI libraries that aren't tied to a framework work the same way: you hand them an element, they build their content inside it, call you back when something happens, and give you an object with methods. `defineWidget()` turns such a library into a JSX tag. The view renders it like an element, the intent selects it by class like any element, and the widget keeps its instance across renders.

```jsx
// DatePicker.js
import { defineWidget } from 'sygnal'
import flatpickr from 'flatpickr'

export const DatePicker = defineWidget({
  tag: 'input',
  mount: (el, props, dispatch) => flatpickr(el, { defaultDate: props.value, onChange: ([date]) => dispatch('pick', date) }),
  update: (picker, props) => picker.setDate(props.value, false),
  unmount: (picker) => picker.destroy(),
  events: ['pick'],
  commands: { open: (picker) => picker.open() },
})
```

```jsx
// Task.jsx
import { DatePicker } from './DatePicker.js'

export function Task({ state }) {
  return (
    <form>
      <label>Due <DatePicker className="due" value={state.due} /></label>
      <button type="button" className="pick-date">Pick a date</button>
      <p>{state.due ? state.due.toDateString() : 'No due date'}</p>
    </form>
  )
}

Task.initialState = { due: null }

Task.intent = ({ DOM }) => ({
  DUE: DOM.select('.due').events('pick').detail(),
  OPEN: DOM.click('.pick-date'),
})

Task.model = {
  DUE: (state, due) => ({ ...state, due }),
  OPEN: { ELEMENT: { open: '.due' } },
}
```

`<DatePicker className="due" value={state.due} />` renders an `<input class="due">` (the host). Once it is in the page, Sygnal calls `mount` with the element and the props, and keeps what `mount` returns (the instance, here flatpickr's object). When the user picks a date, flatpickr calls `onChange`, the widget calls `dispatch('pick', date)`, and the intent reads the date with `.detail()`. `OPEN` sends the widget's `open` command to the same element.

## The definition

| Field | Meaning |
|-------|---------|
| `tag` | The host element: `'div'` by default, `'input'` for a widget that enhances a field, `'canvas'`... |
| `mount(el, props, dispatch)` | Called once, when the host enters the page. Build the widget in `el` and return its instance. `dispatch(name, detail)` sends the widget's [events](#events). |
| `update(instance, props, el)` | Called with the newest props whenever they change (a shallow compare). Without `update`, a change unmounts and mounts again. |
| `unmount(instance, el)` | Called when the host leaves the page: destroy the widget, remove its listeners. |
| `events` | The event names `dispatch` sends. |
| `commands` | Element commands, called with the instance: `open: (picker, options) => picker.open()`. |
| `fallback` | What [server rendering](#server-rendering) puts inside the host. |
| `hostProps` | More prop names to put on the host element. |
| `ownProps` | Prop names that stay off the host although they would go there (the widget applies them itself, e.g. `aria-label` on its own control). |
| `name` | A name for diagnostics (`'DatePicker'`). |

**The host is the widget's.** Sygnal renders the host element and never its content: the widget can add, move and remove elements inside it, and a re-render doesn't touch them. Children passed to the tag are ignored.

**Props.** Every prop the view passes reaches `mount` and `update` (except `key` and `ref`). The ones that describe the element also go on the host: `id`, `className`/`class`, `style`, `title`, `name`, `placeholder`, `role`, `tabindex`, `hidden`, `lang`, `dir`, `attrs`, `aria-*` and `data-*`, plus the names in `hostProps`. Other props (`value` above) are the widget's alone, so the widget, not Sygnal, decides what the input shows. Sygnal toggles only its own `className` tokens on the host, so the classes a library adds to it (flatpickr's `flatpickr-input`) stay when the `className` changes. A `ref` gets the host element.

**Updates.** `update` gets the props of the render being patched, every time they change, so it never works from stale values. A render that passes the same values (the same Date object, the same array) doesn't call it; a `style` or `attrs` object counts as the same when its entries are. Pass a new value to make it run.

**Identity.** The instance lives on the host element, so it survives re-renders, and a keyed host keeps its instance when a list is reordered. A widget in each [Collection](/guide/collections/) item is selected only in its own item, as any element is. When something else takes the widget's place (a plain element, another widget, the error fallback), its host leaves the page and `unmount` runs, even when the new element has the same tag and class.

## Events

`dispatch(name, detail)`, the third parameter of `mount`, dispatches a bubbling `CustomEvent` named `name` on the host, with `detail` as its payload. Read it in the intent as any DOM event, and take the payload with `.detail()` (or `.detail(fn)` to map it):

```jsx
Chart.intent = ({ DOM }) => ({
  SELECT: DOM.select('.sales').events('point-select').detail((point) => point.index),
})
```

List every name in `events`. Sygnal checks them: a `dispatch` of a name that isn't listed is [SYG140](/reference/errors/#syg140), and sygnal-check reports an intent listening for a near-typo of a declared name ([SYG141](/reference/errors/#syg141)).

Prefer names of your own (`'pick'`, `'rate'`, `'point-select'`) to the browser's (`'change'`, `'input'`). The host and the library's own elements fire native events too, and they bubble the same way: flatpickr's input fires a native `change` when a date is picked, so a widget event named `'change'` would reach the listener twice, once without a `detail`. Declaring such a name is reported as information ([SYG144](/reference/errors/#syg144)).

## Commands

`commands` makes the widget's methods available to [element commands](/guide/element-commands/). A model entry sends them to the host's selector, with the options as the other keys:

```jsx
Editor.model = {
  CLEAR: { ELEMENT: { setContent: '.body', html: '' } },
  FOCUS_BODY: { ELEMENT: { focus: '.body' } },
}
```

`setContent: (editor, { html }) => editor.commands.setContent(html)` gets the instance and the options. A declared command wins over the host element's own method of the same name: a widget whose host is a `<div>` can declare `focus` to focus the editable area inside it, and `{ focus: '.body' }` runs it. Without one, the host's own method runs (`focus` on an `input` host). This holds for `close` and `togglePopover` too: a declared one gets the options object (`{ close: '.panel', returnValue: 'ok' }` calls it with `{ returnValue: 'ok' }`). A command the widget doesn't declare and the host doesn't have is [SYG142](/reference/errors/#syg142).

In TypeScript, add the command names and their options to `ElementCommandRegistry` (see [element commands](/guide/element-commands/)).

## Errors

A `mount` or `update` that throws doesn't take the page down. The error goes to the app's `onError` hook with the phase `'widget'`, and the component that renders the widget shows its [`onError` fallback](/advanced/error-boundaries/) in that widget's place; the rest of its view keeps working, other widgets included ([SYG660](/reference/errors/#syg660), [SYG661](/reference/errors/#syg661)). The widget is tried again when the view passes it other props, or when it renders again after its fallback left the page (a panel closed and reopened). An `unmount` that throws is reported the same way ([SYG662](/reference/errors/#syg662)).

## Accessibility

The host is a real element in your markup, so the usual rules apply to it. An `input`-hosted widget needs a label, like any input: wrap it in a `<label>`, or give it an `aria-label` (sygnal-check reports an unlabelled one, [SYG702](/reference/errors/#syg702)). For a `div`-hosted widget, give the host a `role` and an accessible name when the library doesn't: `<Chart className="sales" role="img" aria-label="Sales by month" />`.

## Server rendering

`renderToString` renders the host with its host props, and the widget's `fallback` inside it, since there is no widget on the server:

```jsx
// Chart.js
import { defineWidget } from 'sygnal'

export const Chart = defineWidget({
  fallback: (props, h) => h('p', { className: 'chart-loading' }, `Loading ${props.title}`),
  mount: (el, props) => drawChart(el, props.points),
  update: (chart, props) => chart.setPoints(props.points),
  unmount: (chart) => chart.destroy(),
})
```

On the client, the first render replaces the fallback and mounts the widget. A void host (`input`) has no room for a fallback.

## Portals

A widget works inside a [`<Portal>`](/advanced/portals/), and unmounts when the portal is removed. Its events are dispatched in the portal's target, outside the component's own element, so listen through the document, as for any content of a portal: `DOM.select('document').select('.due').events('pick').detail()`.

## Transitions

A widget inside a [`<Transition>`](/advanced/transitions/) gets the enter and leave classes on its host. `unmount` runs when the leave starts, while the host fades out: leave the content in place there and stop only what runs (the adapters do: `fromZag` stops its machine and keeps the rendered parts, `fromReact` unmounts its React root once the host is gone).

## Testing

`renderComponent` doesn't run widgets in its default mock DOM, which has no real elements: the view renders the host, and `t.widget(selector)` gives what a test needs instead.

```jsx
import { renderComponent } from 'sygnal'
import { Task } from './Task.jsx'

test('a picked date becomes the due date', async () => {
  const t = renderComponent(Task)
  await t.ready()
  const date = new Date(2026, 9, 5)
  t.widget('.due').dispatch('pick', date)
  await t.next((state) => state.due === date)
  expect(t.widget('.due').props.value).toBe(date)
  t.simulateEvent('.pick-date', 'click')
  await t.settle()
  expect(t.commands()).toEqual([{ open: '.due' }])
})
```

- **`props`**: the props the view passed the widget in the latest render.
- **`dispatch(name, detail)`**: sends the event the widget's `dispatch` would, in order with other simulated input (`emit` is an alias).
- **`instance`**: with `renderComponent(Task, { dom: 'real' })` the widget really mounts (in jsdom or a browser), and `instance` is what `mount` returned.

## As a control

A widget is also a [control](/guide/controls/) spec, the alternative form that names an element by identifier instead of by class:

<!-- docs-check: skip -->
```jsx
const { Due } = controls({ Due: DatePicker })
// <label>Due <Due value={state.due} /></label>
// DUE: DOM.select(Due).events('pick').detail()      OPEN: { ELEMENT: { open: Due } }
```

The widget tag itself is not a selector: `DOM.select(DatePicker)` matches nothing ([SYG143](/reference/errors/#syg143)). Select its class, or make it a control.

## Diagnostics

| Code | When |
|------|------|
| [SYG140](/reference/errors/#syg140) | `dispatch` of a name not listed in `events` |
| [SYG141](/reference/errors/#syg141) | The intent listens for a near-typo of a declared event (sygnal-check) |
| [SYG142](/reference/errors/#syg142) | A command the widget doesn't declare and its host doesn't have |
| [SYG143](/reference/errors/#syg143) | The widget tag used as a selector |
| [SYG144](/reference/errors/#syg144) | A declared event name the browser also fires (information) |
| [SYG660](/reference/errors/#syg660)–[662](/reference/errors/#syg662) | `mount`, `update` or `unmount` threw |

## Widgets, web components and React components

- A **web component** (`<wa-rating>`, `<sl-dialog>`) is already an element: render its tag directly, no `defineWidget` needed ([Web components](/guide/web-components/)).
- A **framework-agnostic library** (flatpickr, Chart.js, Tiptap, CodeMirror) is what `defineWidget` is for. The [Recipes](/recipes/overview/) show tested widgets for Chart.js and ECharts, Tiptap, CodeMirror, Embla Carousel and AG Grid.
- A **Zag.js machine** or a **React / Preact component** goes through an [adapter](/guide/adapters/) (`fromZag`, `fromReact`), which returns a widget tag. Adapters are an escape hatch for the one component you can't replace.
- To publish a Sygnal component for other pages and frameworks, use `defineElement` from `sygnal/element` ([Publishing](/guide/web-components/#publishing-a-component-as-a-custom-element)).
