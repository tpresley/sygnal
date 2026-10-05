---
title: UI Parts
description: Headless dialogs, popovers, tooltips, tabs, accordions, disclosures and toasts from sygnal/ui, built on native HTML; menus, selects and comboboxes from sygnal/ui/zag, built on Zag.js
---

`sygnal/ui` is a set of headless UI parts. Each part wires up what the browser already does well (`<dialog>`, the Popover API, CSS anchor positioning) and adds the state, keyboard handling and ARIA attributes it leaves out. The parts are unstyled: you write the markup and the CSS, and they give you class hooks and data attributes to style.

```jsx
import { dialog, tabs, tabsAttrs, Toaster } from 'sygnal/ui'
```

| Part | What it is | Built on |
|---|---|---|
| [Dialog](/ui/dialog/) | A behavior for `uses` | `<dialog>`, `showModal()` |
| [Popover](/ui/popover/) | A behavior for `uses` | The Popover API (`popover`, `popovertarget`) |
| [Tooltip](/ui/tooltip/) | A behavior for `uses` | A manual popover placed by CSS anchor positioning, with show and hide delays |
| [Tabs](/ui/tabs/) | A behavior + `tabsAttrs` | Your buttons and panels; roving focus |
| [Accordion](/ui/accordion/) | A behavior + `accordionAttrs` | Your buttons and panels |
| [Disclosure](/ui/disclosure/) | A behavior + `disclosureAttrs` | Your button and panel |
| [Toaster](/ui/toaster/) | A component | `popover="manual"`, Collection, Transition, timers |
| [Menu](/ui/menu/) | A widget tag, from `sygnal/ui/zag` | Zag.js's menu machine ([`fromZag`](/guide/adapters/#zag-machines-fromzag)) |
| [Select](/ui/select/) | A widget tag, from `sygnal/ui/zag` | Zag.js's select machine |
| [Combobox](/ui/combobox/) | A widget tag, from `sygnal/ui/zag` | Zag.js's combobox machine |

Menu, Select and Combobox need keyboard and focus handling that the browser doesn't give: they run [Zag.js](https://zagjs.com) state machines, in `sygnal/ui/zag`, a subpath of their own. Zag is an optional peer dependency (`npm install @zag-js/vanilla@~1.45.0 @zag-js/menu@~1.45.0 @zag-js/select@~1.45.0 @zag-js/combobox@~1.45.0`), and `sygnal/ui` never needs it. They are [widget](/guide/widgets/) tags: `<Menu className="actions" label="Actions" items={ITEMS} />`, read with `DOM.select('.actions').events('select').detail()`.

## How the parts work

Six parts are [behaviors](/guide/behaviors/): you list them in a component's `uses` under a state key, and they add a slice of state and namespaced actions to it. The component renders its own markup with the classes the behavior's options name:

```jsx
import { dialog } from 'sygnal/ui'

function Settings({ state, uid }) {
  return (
    <div>
      <button className="open-settings">Settings</button>
      <dialog className="settings" aria-labelledby={uid('title')}>
        <h2 id={uid('title')}>Settings</h2>
        <button className="close-settings">Close</button>
      </dialog>
      <p>{state.settings.open ? 'Editing settings' : ''}</p>
    </div>
  )
}

Settings.uses = { settings: dialog({ dialog: '.settings', trigger: '.open-settings', close: '.close-settings' }) }
```

`state.settings` is `{ open, returnValue }`, and the actions are `settings.OPEN`, `settings.CLOSE` and so on. Your own intent and model can trigger them and react to them, as with any behavior: an intent action `'settings.OPEN': DOM.click('.edit')` adds a trigger, and a model entry `'settings.CLOSED': (state) => …` runs after the behavior's.

Tabs, Accordion and Disclosure have no markup of their own either. A helper gives you the attributes to spread on your elements, computed from the slice: roles, ARIA states, ids that link the buttons and panels, and the roving `tabindex`. It takes the view's `uid`, so each instance of the component gets its own ids:

```jsx
const a = tabsAttrs(state.tabs, uid)
// <div {...a.list} aria-label="Settings"> <button className="tab" {...a.tab('general')}>General</button> …
```

The Toaster renders its own markup, so it is a component: render `<Toaster />` once and send `event('TOAST', { text })` from any component.

## Styling

Style the parts with your own classes, the ones you pass in the options. The parts add these data attributes:

| Attribute | On | Values |
|---|---|---|
| `data-state` | tabs and tab panels | `active`, `inactive` |
| `data-state` | accordion and disclosure buttons and panels | `open`, `closed` |
| `data-value` | tabs, accordion buttons | the value you passed |
| `data-kind` | each toast | `info`, `success`, `warning`, `error` |
| `data-paused` | the toast region | present while paused |

The browser also exposes the open state: `dialog[open]`, `:modal`, `:popover-open`, `dialog::backdrop` and `[popover]::backdrop`.

## Browser support

The parts target current evergreen browsers: Chromium (Chrome, Edge), Firefox and Safari. They rely on `<dialog>`, the Popover API (including `popovertarget` and `toggle` events), the `:modal` pseudo-class and, for the Tooltip, CSS anchor positioning (`anchor-name`, `position-anchor`, `position-area`). Sygnal's browser suite runs every part in Chromium, Firefox and WebKit.

The package has no JavaScript positioning fallback. To support a browser without CSS anchor positioning, position the tooltip with [Floating UI](#floating-ui-for-older-browsers) instead.

### Floating UI for older browsers

[Floating UI](https://floating-ui.com/) computes a position in JavaScript. Give the tip a [ref](/advanced/refs/) and run its `autoUpdate` while the tooltip is open, from an `EFFECT` on the behavior's `TOGGLED` action:

```jsx
import { createRef } from 'sygnal'
import { tooltip } from 'sygnal/ui'
import { computePosition, autoUpdate, offset, flip, shift } from '@floating-ui/dom'

const trigger = createRef()
const tip = createRef()
let stop = null

function Toolbar({ uid }) {
  return (
    <div>
      <button className="save" ref={trigger} aria-describedby={uid('tip')}>Save</button>
      <div className="tip" ref={tip} id={uid('tip')} role="tooltip" popover="manual">Save the draft</div>
    </div>
  )
}

Toolbar.uses = { tip: tooltip({ trigger: '.save', tip: '.tip' }) }
Toolbar.model = {
  'tip.TOGGLED': {
    EFFECT: (state, open) => {
      stop?.()
      stop = open ? autoUpdate(trigger.current, tip.current, () =>
        computePosition(trigger.current, tip.current, { placement: 'top', middleware: [offset(6), flip(), shift()] })
          .then(({ x, y }) => Object.assign(tip.current.style, { left: `${x}px`, top: `${y}px` }))) : null
    },
  },
}
```

```css
.tip { position: fixed; margin: 0; inset: auto; }
```

A module-level ref is shared by every instance; for a component rendered more than once, keep the refs in a `Map` keyed by an id.

## Size

`sygnal/ui` is a separate entry. An app that doesn't import it ships none of it, and each part is tree-shaken on its own. The first behavior an app uses also brings in `defineBehavior` (about 1 KB gzipped). Measured in a small app, gzipped:

| Part | Adds |
|---|---|
| Dialog | 0.4 KB + `defineBehavior` |
| Popover | 0.2 KB + `defineBehavior` |
| Tooltip | 0.3 KB + `defineBehavior` + `makeTimerDriver` (0.6 KB) |
| Tabs, Accordion | about 1 KB each + `defineBehavior` |
| Disclosure | 0.3 KB + `defineBehavior` |
| Toaster | 1.1 KB + `makeTimerDriver` |
| Menu (`sygnal/ui/zag`) | 33 KB, Zag included |
| Select (`sygnal/ui/zag`) | 33 KB, Zag included |
| Combobox (`sygnal/ui/zag`) | 34 KB, Zag included |
| Menu + Select + Combobox | 47 KB (they share Zag's runtime and positioning) |

## Testing

`renderComponent()` tests the parts like any component. The default mock DOM records `ELEMENT` commands (`showModal`, `focus`) without running them, so a test simulates the browser's events (`close`, `toggle`) itself. The tooltip delays and toast timeouts run on [fake timers](/integration/testing/). Keyboard navigation in Tabs and Accordion reads the order of the elements on the page, so test it with `dom: 'real'`.

```jsx
// @vitest-environment jsdom
import { it, expect } from 'vitest'
import { within } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { renderComponent } from 'sygnal'
import Settings from './Settings.jsx'

it('moves between the tabs with the arrow keys', async () => {
  const t = renderComponent(Settings, { dom: 'real' })
  await t.ready()
  const screen = within(t.container)
  const user = userEvent.setup()

  await user.click(screen.getByRole('tab', { name: 'General' }))
  await user.keyboard('{ArrowRight}')
  await t.waitForState((s) => s.tabs.selected === 'privacy')

  expect(screen.getByRole('tab', { name: 'Privacy', selected: true })).toBeTruthy()
  expect(screen.getByRole('tabpanel', { name: 'Privacy' })).toBeTruthy()
  expect(t.actions.map((a) => a.type)).toContain('tabs.MOVE')
  t.dispose()
})
```

The [browser suite](https://github.com/tpresley/sygnal/tree/main/browser-tests) runs the parts in real engines, for what a DOM emulation doesn't have: the top layer, focus trapping, light dismiss and anchor positioning.
