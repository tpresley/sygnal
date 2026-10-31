---
title: Tooltip
description: Tooltips on a manual popover, placed by CSS anchor positioning, with show and hide delays from timers; tooltips() for many triggers
---

`tooltip()` is a [behavior](/guide/behaviors/) that shows a short description of a control when the pointer rests on it or it gets the keyboard focus. The tip is a `popover="manual"` element, so it is drawn in the top layer, above dialogs and scrolling containers. CSS anchor positioning places it next to its trigger; there is no JavaScript positioning. The show and hide delays are [timers](/guide/timers/), so they are cancelled when the pointer leaves early and they run on fake timers in tests.

```jsx live
import { tooltip } from 'sygnal/ui'

function Toolbar({ uid }) {
  const anchor = '--' + uid('save')
  return (
    <div className="toolbar">
      <button className="save" aria-describedby={uid('save-tip')} style={{ anchorName: anchor }}>Save</button>
      <div className="tip" id={uid('save-tip')} role="tooltip" popover="manual" style={{ positionAnchor: anchor }}>
        Save the draft (Ctrl+S)
      </div>
    </div>
  )
}

Toolbar.uses = { saveTip: tooltip({ trigger: '.save', tip: '.tip' }) }
```

```js
import { run, makeTimerDriver } from 'sygnal'
import Toolbar from './Toolbar.jsx'

run(Toolbar, { TIMER: makeTimerDriver() })
```

The delays need the timer driver in `run()`. Tests don't: [fake timers](/guide/timers/#testing) drive them.

## Options

| Option | Default | |
|---|---|---|
| `trigger` | (required) | The element it describes |
| `tip` | (required) | The tooltip element: `role="tooltip"`, `popover="manual"` |
| `showDelay` | `500` | ms the pointer or focus must stay before it shows |
| `hideDelay` | `100` | ms before it hides after the pointer or focus leaves |

## Behavior

- Hovering the trigger or giving it the keyboard focus shows the tip after `showDelay`; leaving before that never shows it.
- Only a focus the browser draws a focus ring for (`:focus-visible`) shows it. A mouse click focuses a button in Chromium and Firefox, so a tip that showed it would stay after the pointer left; a clicked trigger's tip goes with the pointer instead. When a dialog closes and the focus returns to its trigger, the browser decides: after a keyboard close the tip usually shows, after a mouse close it doesn't.
- Leaving hides it after `hideDelay`. Moving the pointer from the trigger onto the tip keeps it open, so the tip can be read and selected ([WCAG 1.4.13](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus)).
- The pointer and the focus count apart: it hides once both have left, so the mouse moving away doesn't hide a tip the keyboard focus still shows.
- Touch is left out: touch pointer events are ignored, and the focus a tap gives isn't `:focus-visible`, so a tap shows no tip.
- Escape hides it at once, without moving the focus. (The behavior listens for it on the document only while the tip is shown or about to be.)

`state.saveTip` is `{ open, pending, hover, focus }`: `pending` is `'show'` or `'hide'` while a delay runs; `hover` and `focus` say where the pointer and the focus are. The actions are `saveTip.ENTER` and `saveTip.LEAVE` (data: `'hover'` or `'focus'`), `saveTip.SHOW`, `saveTip.HIDE` (the timers), `saveTip.ESCAPE` and `saveTip.TOGGLED`. The timers are declared under the names `saveTip.show` and `saveTip.hide`, next to the component's own [`timers`](/guide/timers/).

## Many tooltips: `tooltips()`

`tooltip()` keeps a state slice and two timers for each trigger, which is a lot for a paragraph of glossary terms or a toolbar of icon buttons. `tooltips()` serves every trigger of the component with one slice and one pair of timers. Each trigger names its tip with `aria-describedby`, and one tip shows at a time:

```jsx live
import { tooltips } from 'sygnal/ui'

const TERMS = { MVI: 'Model-View-Intent: the pattern every component follows', driver: 'The code that talks to the outside world', sink: 'What a component sends to a driver' }

function Glossary({ uid }) {
  const term = (name, text) => (
    <>
      <button className="term" aria-describedby={uid('tip-' + name)} style={{ anchorName: '--' + uid(name) }}>{text}</button>
      <span className="tip" id={uid('tip-' + name)} role="tooltip" popover="manual" style={{ positionAnchor: '--' + uid(name) }}>{TERMS[name]}</span>
    </>
  )
  return <p>Every component is {term('MVI', 'MVI')}: its intent reads events, a {term('driver', 'driver')} performs the effects, and each {term('sink', 'sink')} carries a request.</p>
}

Glossary.uses = { tips: tooltips({ trigger: '.term', tip: '.tip' }) }
```

The options are those of `tooltip()`, with `trigger` and `tip` matching every trigger and every tip. Moving from one term to another while a tip is shown switches at once, without a second delay. `state.tips` is `{ id, open, pending, hover, focus }`: `id` is the tip of the trigger last entered and `open` the id of the tip shown. The actions carry the tip's id: `tips.ENTER` and `tips.LEAVE` (`{ via: 'hover' | 'focus', id }`), `tips.TOGGLED` (`{ id, open }`), plus `tips.SHOW`, `tips.HIDE` and `tips.ESCAPE`.

## Positioning

The trigger gets an anchor name and the tip refers to it. The anchor name must be unique on the page, so build it from `uid()` in the view, as above. The rest is CSS:

```css live
.tip {
  position-area: top;      /* above the trigger, centred */
  position-try: flip-block; /* below it when there is no room above */
  inset: auto;
  margin: 0 0 6px;
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: #222;
  color: #fff;
  font-size: 0.875rem;
}
```

`inset: auto` and `margin` replace the popover's default centring. Browsers without CSS anchor positioning need JavaScript positioning: see [Floating UI for older browsers](/ui/overview/#floating-ui-for-older-browsers).

Safari 26 places the tip wrongly when the trigger is inside a `position: fixed` element (a fixed toolbar or header) and the page is scrolled: the tip moves up by the scroll distance. Triggers in the normal flow of the page are placed correctly. For triggers in a fixed bar, the Floating UI recipe works in every browser.

## Accessibility

- `aria-describedby` on the trigger points at the tip, so screen readers read the tip as the trigger's description. The trigger still needs its own name (its text or `aria-label`).
- Keep the tip short and plain text; it can't take the focus. For anything interactive, use a [popover](/ui/popover/).
- Don't rely on a tooltip for touch users: there is no hover, and a tap shows no tip.

## Testing

```jsx
import { it, expect, vi } from 'vitest'
import { renderComponent } from 'sygnal'
import Toolbar from './Toolbar.jsx'

it('shows the tip after the delay', async () => {
  vi.useFakeTimers()
  const t = renderComponent(Toolbar)
  await t.ready()
  t.simulateEvent('.save', 'pointerenter')
  await t.next((s) => s.saveTip.pending === 'show')
  expect(t.timers()).toEqual([{ name: 'saveTip.show', after: 500, action: 'saveTip.SHOW', component: 'Toolbar' }])

  await vi.advanceTimersByTimeAsync(500)
  await t.settle()
  expect(t.commands('ELEMENT')).toEqual([{ showPopover: '.tip' }])
  expect(t.actions.map((a) => a.type)).toEqual(['INITIALIZE', 'saveTip.ENTER', 'saveTip.SHOW'])
  t.dispose()
  vi.useRealTimers()
})
```
