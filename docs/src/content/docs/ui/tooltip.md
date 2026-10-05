---
title: Tooltip
description: Tooltips on a manual popover, placed by CSS anchor positioning, with show and hide delays from timers
---

`tooltip()` is a [behavior](/guide/behaviors/) that shows a short description of a control when the pointer rests on it or it gets the keyboard focus. The tip is a `popover="manual"` element, so it is drawn in the top layer, above dialogs and scrolling containers. CSS anchor positioning places it next to its trigger; there is no JavaScript positioning. The show and hide delays are [timers](/guide/timers/), so they are cancelled when the pointer leaves early and they run on fake timers in tests.

```jsx
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

- Hovering or focusing the trigger shows the tip after `showDelay`; leaving before that never shows it.
- Leaving hides it after `hideDelay`. Moving the pointer from the trigger onto the tip keeps it open, so the tip can be read and selected ([WCAG 1.4.13](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus)).
- Escape hides it at once, without moving the focus.

`state.saveTip` is `{ open, pending }`: `pending` is `'show'` or `'hide'` while a delay runs. The actions are `saveTip.ENTER`, `saveTip.LEAVE`, `saveTip.SHOW`, `saveTip.HIDE` (the timers), `saveTip.ESCAPE` and `saveTip.TOGGLED`. The timers are declared under the names `saveTip.show` and `saveTip.hide`, next to the component's own [`timers`](/guide/timers/).

## Positioning

The trigger gets an anchor name and the tip refers to it. The anchor name must be unique on the page, so build it from `uid()` in the view, as above. The rest is CSS:

```css
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

## Accessibility

- `aria-describedby` on the trigger points at the tip, so screen readers read the tip as the trigger's description. The trigger still needs its own name (its text or `aria-label`).
- Keep the tip short and plain text; it can't take the focus. For anything interactive, use a [popover](/ui/popover/).
- Don't rely on a tooltip for touch users: there is no hover, and a tap focuses the trigger only briefly.

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
