---
title: Accordion
description: Accessible accordions over your own markup, with ARIA attributes from accordionAttrs
---

`accordion()` is a [behavior](/guide/behaviors/) for a list of headers that each show and hide a panel, following the [WAI-ARIA accordion pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/). You render the header buttons and the panels; `accordionAttrs()` gives them `aria-expanded`, the ids that link each button to its panel, and `hidden` on the closed panels.

```jsx live
import { accordion, accordionAttrs } from 'sygnal/ui'

const FAQ = [
  { id: 'shipping', question: 'How long does shipping take?', answer: 'Two to four working days.' },
  { id: 'returns', question: 'Can I return an item?', answer: 'Within 30 days, unused.' },
]

function Faq({ state, uid }) {
  const a = accordionAttrs(state.faq, uid)
  return (
    <div className="faq">
      {FAQ.map((item) => (
        <div className="faq-item">
          <h3><button className="faq-question" {...a.trigger(item.id)}>{item.question}</button></h3>
          <div className="faq-answer" {...a.panel(item.id)}><p>{item.answer}</p></div>
        </div>
      ))}
    </div>
  )
}

Faq.uses = { faq: accordion({ trigger: '.faq-question' }) }
```

Wrap each button in a heading of the level that fits the page, so the headers are in the page outline.

## Options

| Option | Default | |
|---|---|---|
| `trigger` | (required) | The header buttons: a selector or a [control](/guide/controls/) |
| `multiple` | `false` | Several panels open at once; without it, opening one closes the others |
| `collapsible` | `true` | `false`: the last open panel can't be closed (its button gets `aria-disabled`) |
| `expanded` | `[]` | The panels open at the start: a value or an array |
| `loop` | `true` | Down on the last header goes to the first |
| `id` | the key in `uses` | The prefix of the ids |

## Keyboard

| Key | |
|---|---|
| Enter / Space | Opens or closes the focused header's panel |
| Down / Up | The next or previous header |
| Home / End | The first or last header |
| Tab | The next focusable element, through the open panels |

## State, actions and attributes

`state.faq` is `{ id, expanded, collapsible }`: `expanded` lists the open panels' values. Actions: `faq.TOGGLE`, `faq.EXPAND` and `faq.COLLAPSE` take a value (a click on a header toggles its own), `faq.MOVE` focuses a header. Open a panel from your model with `next('faq.EXPAND', 'returns')`.

`accordionAttrs(state.faq, uid)` returns:

| | Attributes |
|---|---|
| `trigger(value)` | `id`, `aria-expanded`, `aria-controls`, `aria-disabled` (only on the open panel that can't close), `type="button"`, `data-value`, `data-state` (`open` / `closed`) |
| `panel(value)` | `id`, `role="region"`, `aria-labelledby`, `hidden` unless open, `data-state` |

## Styling

```css live
.faq-question { width: 100%; text-align: start; }
.faq-question[data-state='open']::after { content: '−'; }
.faq-question[data-state='closed']::after { content: '+'; }
```

## Testing

```jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import Faq from './Faq.jsx'

it('opens one answer at a time', async () => {
  const t = renderComponent(Faq)
  await t.ready()
  t.simulateEvent('.faq-question', 'click', { data: { value: 'shipping' } })
  await t.next((s) => s.faq.expanded.includes('shipping'))
  t.simulateAction('faq.TOGGLE', 'returns')
  await t.next((s) => s.faq.expanded.includes('returns'))
  expect(t.state.faq.expanded).toEqual(['returns'])
  expect(t.query('.faq-question[data-value="returns"]').getAttribute('aria-expanded')).toBe('true')
  expect(t.actions.map((a) => a.type)).toEqual(['INITIALIZE', 'faq.TOGGLE', 'faq.TOGGLE'])
  t.dispose()
})
```

The arrow keys read the order of the headers on the page: test them with `dom: 'real'`.
