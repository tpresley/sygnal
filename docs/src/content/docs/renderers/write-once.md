---
title: "Write Once: Web, Native, Terminal"
description: One Sygnal component file for the web, React Native, the terminal and agents. The primitives from sygnal/primitives, controls in intents, React Native styles everywhere, and what each target does with them
---

`sygnal/primitives` gives you eight components that every target understands: `View`, `Text`, `Pressable`, `TextInput`, `Switch`, `Image`, `ScrollView` and `List`. A component written with them runs unchanged on:

| Target | How it runs the primitives |
|---|---|
| the web (the DOM driver) | as HTML: a `View` is a flex-column `<div>`, a `Pressable` a `<button>`, a `Switch` an `<input type="checkbox" role="switch">` |
| [React Native](/renderers/react-native/) (`sygnal/react-native`) | as the React Native components of the same names |
| [a terminal](/renderers/terminal/) (`sygnal/terminal`) | as text: `[Add]`, `[x]`, `[What needs doing?]` |
| [an agent](/renderers/agent-ui/) (`sygnal/agent-ui`) | as roles in the snapshot: `button "Add"`, `switch "Done: …" [checked]` |

The [write-once example](https://github.com/tpresley/sygnal/tree/main/examples/write-once) is one task-list component (`src/Tasks.jsx`) running on all four, with an iOS screenshot next to the web one.

## A component for every target

```jsx
// Tasks.jsx
import { Collection, controls, set, toggle, ABORT } from 'sygnal'
import { View, Text, Pressable, TextInput, Switch, List } from 'sygnal/primitives'

const { Draft, Add } = controls({ Draft: TextInput, Add: Pressable })
const { Done } = controls({ Done: Switch })

function Task({ state }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Done value={state.done} aria-label={`Done: ${state.title}`} />
      <Text style={{ flex: 1, fontSize: 18 }}>{state.title}</Text>
    </View>
  )
}
Task.intent = ({ DOM }) => ({ TOGGLE: DOM.change(Done) })
Task.model = { TOGGLE: toggle('done') }

export default function Tasks({ state }) {
  return (
    <View style={{ padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 30, fontWeight: '700' }}>Tasks</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Draft value={state.draft} placeholder="What needs doing?" aria-label="New task" style={{ flex: 1 }} />
        <Add style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#2f6fed' }}>
          <Text style={{ color: '#ffffff' }}>Add</Text>
        </Add>
      </View>
      <List>
        <Collection of={Task} from="tasks" />
      </List>
    </View>
  )
}

Tasks.initialState = { draft: '', tasks: [] }

const add = (state) => {
  const title = state.draft.trim()
  if (!title) return ABORT
  return { ...state, draft: '', tasks: [...state.tasks, { id: state.tasks.length + 1, title, done: false }] }
}

Tasks.intent = ({ DOM }) => ({
  DRAFT: DOM.input(Draft).value(),
  ADD: DOM.click(Add),
  ENTER: DOM.keydown(Draft).key().filter((key) => key === 'Enter'),
})

Tasks.model = {
  DRAFT: set((_state, draft) => ({ draft })),
  ADD: add,
  ENTER: add,
}
```

```js
// main.js
import { run } from 'sygnal'
import Tasks from './Tasks.jsx'

run(Tasks)                                  // the web
```

```js
// index.js
import { createElement } from 'react'
import { registerRootComponent } from 'expo'
import { SygnalView } from 'sygnal/react-native'
import Tasks from './src/Tasks.jsx'

registerRootComponent(() => createElement(SygnalView, { app: Tasks }))   // iOS, Android
```

```js
// terminal.js
import { runTerminal } from 'sygnal/terminal'
import Tasks from './Tasks.jsx'

runTerminal(Tasks)                          // a terminal
```

## The rules

**Intents select controls.** Cross-platform intents use [controls](/guide/controls/) (`DOM.click(Add)`), never CSS selectors (`DOM.click('.add')`). A control is an identity: it matches wherever the view renders it, whatever the layout. Pass a primitive as the control's spec, `controls({ Add: Pressable })`, and the control renders that primitive.

**Event names are the DOM's.** Every target makes `click`, `input`, `change`, `keydown`, `submit` and `scroll`, with `e.target.value`, `e.target.checked` and `e.key`. React Native's `onPress`, `onChangeText` and `onValueChange` arrive as `click`, `input` and `change`. So `.value()`, `.checked()`, `.key()` and `processForm` work on all of them.

| Primitive | Listen for |
|---|---|
| `Pressable` | `click` |
| `TextInput` | `input` (`.value()`), `keydown` (`.key()`: Enter is the native keyboard's submit key), `change` (on blur) |
| `Switch` | `change` (`.checked()`), or `click` |
| `ScrollView`, `List` | `scroll` (`e.detail`: `{ x, y, end }` on native) |

**Styles are React Native's.** `style` takes React Native style objects: camelCase keys, numbers for lengths, arrays with falsy holes (`[base, done && faded]`). On the web, the primitives turn lengths into `px` and expand React Native's shorthands (`paddingHorizontal` and friends). They also start from React Native's box defaults: no border unless one is styled, column flex, and a plain button look for `Pressable`. Text styles go on `Text`: React Native doesn't inherit a font or color from a `View`.

**Accessible names.** Give a `TextInput`, `Switch` or icon-only `Pressable` an `aria-label` (or `accessibilityLabel`). The web, the terminal and the agent UI use it as the field's name, and React Native as its accessibility label.

## Per-target differences

Most apps need none, but each target takes a stylesheet of `[selector, style]` rules for its own adjustments:

```js
// styles.js
export const nativeStyles = [['.task.done', { opacity: 0.5 }]]          // SygnalView styles
export const terminalStyles = [['.task.done', { dim: true }]]           // runTerminal styles
```

A target that needs a different layout gets its own view over the same intent and model; see [platform-specific views](/renderers/overview/#platform-specific-views).

## What stays per platform

- **Web-only:** `Portal`, the [UI parts](/ui/overview/), `VirtualCollection` and view transitions need the browser's DOM. On native, use `List`, which windows native views over a FlatList.
- **Native-only:** React Native components that aren't primitives (a map, a camera) go in through `SygnalView`'s `components` option, under a tag of your own. See [React Native](/renderers/react-native/#your-own-components).
- **Gestures:** `click` is a tap. There's no `dblclick` or hover on native, so don't make a cross-platform intent depend on them.

## Testing

Test the logic once with [`renderComponent`](/integration/testing/): it runs the intent and model with no renderer, so the result holds on every target. Then add a frame or snapshot test per text target ([terminal](/renderers/terminal/#testing), [agent UI](/renderers/agent-ui/)) where its output matters. The example's `src/Tasks.test.js` does all three in one file.
