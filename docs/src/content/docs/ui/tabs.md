---
title: Tabs
description: Accessible tabs over your own markup, with roving focus and ARIA attributes from tabsAttrs
---

`tabs()` is a [behavior](/guide/behaviors/) that turns your own buttons and panels into tabs, following the [WAI-ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/). `tabsAttrs()` computes the attributes to spread on them: roles, ids that link each tab to its panel, `aria-selected`, the roving `tabindex` and `hidden` on the other panels.

```jsx live
import { tabs, tabsAttrs } from 'sygnal/ui'

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'billing', label: 'Billing' },
]

function Settings({ state, uid }) {
  const a = tabsAttrs(state.tabs, uid)
  return (
    <div className="settings">
      <div className="tab-list" {...a.list} aria-label="Settings">
        {SECTIONS.map((s) => <button className="tab" {...a.tab(s.id)}>{s.label}</button>)}
      </div>
      {SECTIONS.map((s) => (
        <section className="tab-panel" {...a.panel(s.id)}>
          <h2>{s.label}</h2>
        </section>
      ))}
    </div>
  )
}

Settings.uses = { tabs: tabs({ tab: '.tab', selected: 'general' }) }
```

`state.tabs.selected` is the selected tab's value. Render every panel: the ones not selected get `hidden`, and each tab's `aria-controls` points at its panel.

## Options

| Option | Default | |
|---|---|---|
| `tab` | (required) | The tabs: a selector or a [control](/guide/controls/) |
| `selected` | | The tab selected at the start. Without it, the first tab rendered is selected |
| `orientation` | `'horizontal'` | `'vertical'`: Up and Down move between the tabs instead of Left and Right |
| `activation` | `'automatic'` | `'manual'`: the arrow keys only move the focus; Enter or Space selects |
| `loop` | `true` | The arrow keys wrap from the last tab to the first |
| `id` | the key in `uses` | The prefix of the ids |

## Keyboard

| Key | |
|---|---|
| Tab | Into the tab list, onto the selected tab; Tab again goes to its panel |
| Right / Left (Down / Up when vertical) | The next or previous tab, wrapping; it is selected too, unless `activation: 'manual'` |
| Home / End | The first or last tab |
| Enter / Space | Selects the focused tab (a button click) |

Disabled tabs (`disabled`) are skipped.

## State, actions and attributes

`state.tabs` is `{ id, selected, orientation }`. Actions: `tabs.SELECT` (a value; a click on a tab sends its own) and `tabs.MOVE` (a value: focus that tab, and select it unless manual). Select a tab from the model with `next('tabs.SELECT', 'billing')`, or from your intent with `'tabs.SELECT': DOM.click('.go-billing').mapTo('billing')`.

`tabsAttrs(state.tabs, uid)` returns:

| | Attributes |
|---|---|
| `list` | `role="tablist"`, `aria-orientation` |
| `tab(value)` | `id`, `role="tab"`, `aria-selected`, `aria-controls`, `tabindex` (`0` on the selected tab, `-1` on the others), `type="button"`, `data-value`, `data-state` (`active` / `inactive`) |
| `panel(value)` | `id`, `role="tabpanel"`, `aria-labelledby`, `tabindex="0"`, `hidden` unless selected, `data-state` |

Values are compared as strings.

`tabsAttrs(state.tabs, uid, values)` takes the tabs' values, in order, as an optional third argument (leave disabled tabs out). Pass it when the tabs can change: a `selected` value that isn't among them (its tab was removed) then shows the first tab selected, so there is always a tab to Tab into and a panel shown. Without it, the first tab rendered is selected only while nothing is.

## Closable tabs

When the user closes the selected tab, select a neighbour in the same reducer and move the focus to it (the close button that had the focus is gone):

```jsx live
import { ABORT } from 'sygnal'
import { tabs, tabsAttrs } from 'sygnal/ui'

function Editor({ state, uid }) {
  const a = tabsAttrs(state.tabs, uid, state.files.map((f) => f.id))
  return (
    <div>
      <div className="tab-list" {...a.list} aria-label="Open files">
        {state.files.map((f) => (
          <span className="tab-wrap">
            <button className="tab" {...a.tab(f.id)}>{f.name}</button>
            <button className="close" data-value={f.id} aria-label={'Close ' + f.name}>×</button>
          </span>
        ))}
      </div>
      {state.files.map((f) => <section className="tab-panel" {...a.panel(f.id)}>{f.text}</section>)}
    </div>
  )
}

Editor.uses = { tabs: tabs({ tab: '.tab' }) }
Editor.initialState = {
  files: [
    { id: 'readme', name: 'README.md', text: 'About this project' },
    { id: 'main', name: 'main.js', text: 'run(App)' },
    { id: 'styles', name: 'styles.css', text: 'body { margin: 0 }' },
  ],
}

Editor.intent = ({ DOM }) => ({ CLOSE: DOM.click('.close').data('value') })

// the file after the closed one, or the one before it when it was the last
const neighbour = (files, id) => {
  const i = files.findIndex((f) => f.id === id), rest = files.filter((f) => f.id !== id)
  return rest[Math.min(i, rest.length - 1)]
}

Editor.model = {
  CLOSE: {
    STATE: (state, id) => ({
      ...state,
      files: state.files.filter((f) => f.id !== id),
      tabs: { ...state.tabs, selected: state.tabs.selected === id ? (neighbour(state.files, id)?.id ?? null) : state.tabs.selected },
    }),
    ELEMENT: (state, id) => {
      const next = neighbour(state.files, id)
      return next ? { focus: `.tab[data-value="${next.id}"]` } : ABORT
    },
  },
}
```

(`ELEMENT` gets the state before the action, as every non-`STATE` entry does.)

## Styling

```css live
.tab-list { display: flex; gap: 4px; border-bottom: 1px solid #ddd; }
.tab[data-state='active'] { border-bottom: 2px solid currentColor; font-weight: 600; }
.tab-panel:focus-visible { outline: 2px solid #2563eb; }
```

## Testing

The arrow keys read the order of the tabs on the page, so test them with `dom: 'real'`. Clicks and `simulateAction` work on the mock DOM:

```jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import Settings from './Settings.jsx'

it('selects a tab and shows its panel', async () => {
  const t = renderComponent(Settings)
  await t.ready()
  t.simulateEvent('.tab', 'click', { data: { value: 'privacy' } })
  await t.next((s) => s.tabs.selected === 'privacy')
  expect(t.query('.tab[data-value="privacy"]').getAttribute('aria-selected')).toBe('true')
  expect(t.actions.map((a) => a.type)).toEqual(['INITIALIZE', 'tabs.SELECT'])
  t.dispose()
})
```

The [UI parts overview](/ui/overview/#testing) shows a keyboard test with Testing Library.
