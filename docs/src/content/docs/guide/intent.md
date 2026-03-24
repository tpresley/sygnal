---
title: Intent
description: Capturing user interactions and events
---

The `.intent` property defines **when** actions should happen. It's a function that receives all available driver sources and returns an object mapping action names to Observable streams.

```jsx
MyComponent.intent = ({ DOM, STATE, EVENTS }) => {
  return {
    // Fire INCREMENT when the button is clicked
    INCREMENT: DOM.select('.increment-btn').events('click'),

    // Fire CHANGE_NAME when the input value changes, passing the new value
    CHANGE_NAME: DOM.input('.name-input').value(),

    // Fire SAVE on form submission
    SAVE: DOM.select('.save-form').events('submit')
  }
}
```

## Available Sources

By default, every Sygnal component's intent function receives these sources:

| Source | Description |
|--------|-------------|
| `DOM` | Observe DOM events. Use `.select(cssSelector).events(eventName)` or shorthand `DOM.click(sel)` |
| `STATE` | Access the state stream via `STATE.stream` |
| `EVENTS` | Custom event bus. Use `.select(eventType)` to listen |
| `CHILD` | Access child component events. Use `.select(ComponentFn)` — see [Parent-Child Communication](/guide/parent-child/) |
| `props$` | Stream of props from the parent component |
| `children$` | Stream of children from the parent component |
| `context$` | Stream of context values from ancestors |
| `dispose$` | Emits `true` once when the component is about to unmount (advanced — prefer the `DISPOSE` model action). See [Disposal Hooks](/advanced/disposal/) |

Additionally, any custom drivers registered via `run()` are available as sources by their key name.

## Key Points

- Action names can be any valid JavaScript property name. Convention is `ALL_CAPS`.
- Each action maps to exactly one Observable stream.
- If multiple events should trigger the same action, merge them with `xs.merge()`.
- **Never** attach event handlers in the view. All event handling goes through intent.
- The DOM source is isolated to the current component — selectors won't match elements in parent or sibling components.

## Event Shorthands

The DOM source provides shorthand methods for every event type. Instead of chaining `.select(selector).events(eventName)`, you can call `DOM.eventName(selector)` directly:

```jsx
MyComponent.intent = ({ DOM }) => ({
  // These are equivalent:
  CLICK:    DOM.select('.btn').events('click'),
  CLICK:    DOM.click('.btn'),

  // Works with any DOM event
  BLUR:     DOM.blur('.input'),
  DBLCLICK: DOM.dblclick('.title'),
  KEYDOWN:  DOM.keydown('.input'),
  INPUT:    DOM.input('.field'),
  SUBMIT:   DOM.submit('.form'),
})
```

The shorthand is powered by a JavaScript Proxy, so any valid DOM event name works — `DOM.mouseenter(sel)`, `DOM.touchstart(sel)`, `DOM.animationend(sel)`, etc.

The longhand `.select().events()` syntax is still fully supported and is needed when you want to chain additional stream operators directly off the DOM source selection.

## Event Value Extraction

DOM event streams have chainable convenience methods for extracting common values, eliminating verbose `.map(e => e.target.value)` patterns:

```jsx
MyComponent.intent = ({ DOM }) => ({
  // Instead of: DOM.input('.field').map(e => e.target.value)
  CHANGE_NAME: DOM.input('.field').value(),

  // Instead of: DOM.change('.checkbox').map(e => e.target.checked)
  TOGGLE: DOM.change('.checkbox').checked(),

  // Instead of: DOM.click('.item').map(e => e.target.dataset.id)
  SELECT: DOM.click('.item').data('id'),

  // Instead of: DOM.keydown('.input').map(e => e.key)
  KEY: DOM.keydown('.input').key(),

  // Instead of: DOM.click('.btn').map(e => e.target)
  ELEMENT: DOM.click('.btn').target(),
})
```

Each method optionally accepts a transform function:

```jsx
MyComponent.intent = ({ DOM }) => ({
  // Parse the value as a number
  SET_COUNT: DOM.input('.count-field').value(Number),

  // Parse data attribute
  SELECT_ITEM: DOM.click('.item').data('item', JSON.parse),
})
```

| Method | Extracts | From |
|--------|----------|------|
| `.value(fn?)` | `e.target.value` | Input, textarea, select events |
| `.checked(fn?)` | `e.target.checked` | Checkbox change events |
| `.data(name, fn?)` | `e.target.dataset[name]` | Any element with `data-*` attributes |
| `.key(fn?)` | `e.key` | Keyboard events |
| `.target(fn?)` | `e.target` | Any event |

All methods return enriched streams, so they can be chained with standard stream operators:

```jsx
SEARCH: DOM.input('.search').value().compose(debounce(300)),
```

## Accessing Global DOM Events

To listen for events outside your component's DOM (like keyboard events on `document`):

```jsx
MyComponent.intent = ({ DOM }) => ({
  KEY_PRESS: DOM.select('document').events('keydown').key()
})
```
