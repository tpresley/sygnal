---
title: Widgets
description: defineWidget wraps a third-party widget (a date picker, a chart, an editor) as a JSX tag with events, commands, tests and server rendering
---

Most UI libraries that aren't tied to a framework work the same way: you hand them an element, they build their content inside it, call you back when something happens, and give you an object with methods. `defineWidget()` turns such a library into a JSX tag. The view renders it like an element, the intent selects it by class like any element, and the widget keeps its instance across renders.

```jsx live-file=./DatePicker.js
// DatePicker.js
import { defineWidget } from 'sygnal'
import flatpickr from 'flatpickr'
import 'flatpickr/dist/flatpickr.css'

export const DatePicker = defineWidget({
  tag: 'input',
  mount: (el, props, dispatch) => flatpickr(el, { defaultDate: props.value, onChange: ([date]) => dispatch('pick', date) }),
  update: (picker, props) => picker.setDate(props.value, false),
  unmount: (picker) => picker.destroy(),
  events: ['pick'],
  commands: { open: (picker) => picker.open() },
})
```

```jsx live
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
| `mount(el, props, dispatch, error)` | Called once, when the host enters the page. Build the widget in `el` and return its instance. `dispatch(name, detail)` sends the widget's [events](#events); `error(e)` reports a [later failure](#errors) the widget caught itself. |
| `update(instance, props, el)` | Called with the newest props whenever they change (a shallow compare). Without `update`, a change unmounts and mounts again. |
| `unmount(instance, el)` | Called when the host leaves the page: destroy the widget, remove its listeners. |
| `events` | The event names `dispatch` sends. |
| `commands` | Element commands, called with the instance: `open: (picker, options) => picker.open()`. |
| `fallback` | What [server rendering](#server-rendering) puts inside the host. |
| `hostProps` | More prop names to put on the host element. |
| `ownProps` | Prop names that stay off the host although they would go there (the widget applies them itself, e.g. `aria-label` on its own control). |
| `name` | A name for diagnostics (`'DatePicker'`). |
| `children`, `sync`, `focus`, `tags` | Declarative [children](#children-islands): the tag's JSX children (a scene's objects, a map's markers, a chart's series), rendered as elements the widget reads in `sync`. |
| `value` | Experimental: a [controlled value](#controlled-values-experimental) both the app and the user change (an editor's text). |

**The host is the widget's.** Sygnal renders the host element and never its content: the widget can add, move and remove elements inside it, and a re-render doesn't touch them. Children passed to the tag are ignored, unless the widget declares [`children`](#children-islands).

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

Some libraries also draw on their own, after `mount` returned: on a resize, a timer or their own state change. Sygnal doesn't see a failure there, so catch it and pass it to `error`, the fourth parameter of `mount`. It is handled like an `update` that throws: [SYG661](/reference/errors/#syg661), the app's `onError` with the phase `'widget'`, and the owner's `onError` fallback in that widget's place (its host leaves the page, so `unmount` runs):

```jsx
// Sparkline.js
import { defineWidget } from 'sygnal'
import { drawSparkline } from './drawSparkline.js'

export const Sparkline = defineWidget({
  name: 'Sparkline',
  tag: 'canvas',
  mount: (el, props, dispatch, error) => {
    const chart = { points: props.points }
    chart.observer = new ResizeObserver(() => {
      try { drawSparkline(el, chart.points) } catch (e) { error(e) }
    })
    chart.observer.observe(el)
    drawSparkline(el, chart.points)
    return chart
  },
  update: (chart, props, el) => { chart.points = props.points; drawSparkline(el, chart.points) },
  unmount: (chart) => chart.observer.disconnect(),
})
```

A failure during `mount` itself is thrown, not passed to `error` (it is [SYG660](/reference/errors/#syg660)); an `error` call after the widget unmounted does nothing.

## Children (islands)

Some widgets are made of parts the app thinks of as a list: the objects of a 3D scene, the markers of a map, the series of a chart, the shapes on a canvas. With `children: true`, the tag's JSX children are rendered by Sygnal, as ordinary elements, into a container inside the host. The widget reads them in `sync` and draws them its own way. Because they are elements of the app's own tree, everything works inside: components with their own intent and model, `<Collection>`, isolation, context, and `DOM.click('.marker')` in an intent.

<!-- docs-check: skip -->
```jsx
// the view: the stops are a Collection of components, each with its own intent
<RouteMap className="map" center={state.center}>
  <Collection of={Stop} from="stops" />
</RouteMap>

// Stop.jsx
function Stop({ state }) {
  return <mapMarker className="stop" position={[state.lat, state.lng]} role="button" tabIndex={0} aria-label={state.name} />
}
Stop.intent = ({ DOM }) => ({ OPEN: DOM.click('.stop') })
```

| Field | Meaning |
|-------|---------|
| `children` | `true`: the children's container is visually hidden but in the accessibility tree; `'hidden'`: hidden from everything. |
| `sync(instance, children, el)` | Called after `mount`, and after each patch in which the children changed. `children` is the container's vnode: each child's `sel` (its tag), its props as the view wrote them (`data.props`, and `data.attrs` for ARIA and SVG tags; arrays and functions stay as they are), its own `children`, and its element in `.elm`. Keep a `Map` from element to the library's object, as you would from a key. |
| `focus(instance, child, el)` | A child got keyboard focus (`null`: none has it). Draw a focus ring where the child is drawn. |
| `tags` | Tag names of your children's vocabulary that the JSX pragma takes for SVG (`marker`, `line`, `text`, `filter`, `mask`): they become plain elements app-wide, so their props stay props. Children of a literal `<svg>` stay SVG. |

**Events.** The widget turns its own input into DOM events on the child elements: a click on a map marker, a raycast hit in a 3D scene, a hit test on a canvas. `el.dispatchEvent(new MouseEvent('click', { bubbles: true }))` on the child's element reaches `DOM.click('.stop')` in that item's own intent, and bubbles to its ancestors, as a click on a button does. Put what the event knows on it (`Object.defineProperty(event, 'point', { value })`) so the model can read it.

**Accessibility.** The children are in the accessibility tree by default. A child with a `role`, an accessible name and `tabIndex={0}` is a control a screen reader announces and Tab reaches, though it is drawn on a canvas. Enter and Space on a focused child click it (a keyboard click carries no position), and `focus` tells the widget where to draw the ring. `children: 'hidden'` opts out, for decoration.

**When `sync` runs.** It runs when the children's vnodes changed: a patch elsewhere in the app doesn't call it. A child's component that didn't render again keeps its vnode, so `sync` can skip unchanged subtrees by comparing vnodes.

[Imperative islands](/guide/islands/) builds three widgets this way: a three.js scene with raycast events, a canvas 2D painter with hit testing, and a CodeMirror editor.

## Controlled values (experimental)

An editor's text, a camera, a map's viewport: the user changes it in the widget, the app keeps it in state and sometimes sets it (a reset, a loaded document, a clamp). Writing the prop into the widget on every change makes echo loops (the write fires the widget's change event) and loses keystrokes when the state is a step behind the user. With `value`, Sygnal decides when to write:

<!-- docs-check: skip -->
```jsx
export const Editor = defineWidget({
  events: ['change'],
  mount: (el, props, dispatch) => makeEditor(el, props.value, (text) => dispatch('change', text)),
  value: {
    write: (editor, text) => editor.replaceText(text),   // only the app's own changes get here
    read: (editor) => editor.text,                      // the host's value: .value() in intents
  },
})

// <Editor className="notes" value={state.text} />      EDIT: DOM.select('.notes').events('change').value()
```

- The widget reports the user's changes with `dispatch('change', value)` (or `value.event`). Sygnal remembers them, so when the same value comes back as the `value` prop, it is not written: no loop, and a late echo while the user types on doesn't reset the field.
- `write` runs only when the app changed `value` to something the widget didn't report: a reset, a loaded document, a value the model clamped or transformed. A render for any other reason never writes.
- `strict` (in `value`, or the `strict` prop) also writes back an edit the model didn't take: when its `value` prop never moved (the reducer returned `ABORT`), the widget shows the state again after the app's turn.
- `equals(a, b)` compares values (default `Object.is`); give one for objects (a camera's position).
- `update` isn't called for a change of `value` alone.

`write` must not report back: apply it the way the library marks a programmatic change (CodeMirror: a transaction annotation the update listener skips; Leaflet: a flag around `setView`). This API may change before it is stable.

## Form fields

A widget that edits one value (a date picker, a color picker, a rich select) can be a form field: declare `field`, and give the tag a `name`. The [`form` behavior](/guide/forms/) then reads its value and its touched state from it, as it does for a native input, and [`processForm`](/guide/forms-reference/#processform) entries get its value:

<!-- docs-check: skip -->
```jsx
export const DatePicker = defineWidget({
  tag: 'div',
  events: ['pick'],
  field: { event: 'pick', read: (fp) => fp.selectedDates[0] ?? null },
  mount: (el, props, dispatch) => flatpickr(el, { inline: true, defaultDate: props.value, onChange: ([d]) => dispatch('pick', d ?? null) }),
  update: (fp, props) => fp.setDate(props.value ?? null, false),
  unmount: (fp) => fp.destroy(),
})

// <form><DatePicker className="due" name="due" value={state.form.values.due} /></form>
```

- When the widget dispatches the field's event (`field.event`; default: `value.event`, else `'change'`), its host also fires a bubbling `input` event: the form behavior's change of the field `name`, with the event's detail as the value. An intent listening for the widget's own event still gets it.
- The library's own controls inside the host (flatpickr's text input) don't count: their `input` events are not changes of the form's fields, unless they have a `name` of their own.
- The field is touched when the focus leaves the host; moving between the widget's own parts doesn't count.
- `read(instance, host)` is the field's value between events: what processForm entries get (default: the last value dispatched, else the `value` prop). FormData has what the widget's own named elements hold (a hidden `<input name>` it renders for native submission).
- A widget with a `disabled` prop of `true` has no entry.
- `field: true` takes the defaults.
- In tests, `t.widget('.due').dispatch('pick', date)` reaches the form behavior in the mock DOM too.

The [Select](/ui/select/) and [Combobox](/ui/combobox/) parts are fields this way.

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
| [SYG660](/reference/errors/#syg660)–[662](/reference/errors/#syg662) | `mount`, `update` or `unmount` threw, or the widget called `error(e)` (SYG661) |

## Widgets, web components and React components

- A **web component** (`<wa-rating>`, `<sl-dialog>`) is already an element: render its tag directly, no `defineWidget` needed ([Web components](/guide/web-components/)).
- A **framework-agnostic library** (flatpickr, Chart.js, Tiptap, CodeMirror) is what `defineWidget` is for. The [Recipes](/recipes/overview/) show tested widgets for Chart.js and ECharts, Tiptap, CodeMirror, Embla Carousel and AG Grid.
- A **Zag.js machine** or a **React / Preact component** goes through an [adapter](/guide/adapters/) (`fromZag`, `fromReact`), which returns a widget tag. Adapters are an escape hatch for the one component you can't replace.
- To publish a Sygnal component for other pages and frameworks, use `defineElement` from `sygnal/element` ([Publishing](/guide/web-components/#publishing-a-component-as-a-custom-element)).
