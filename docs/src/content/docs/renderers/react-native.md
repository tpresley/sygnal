---
title: React Native
description: Run Sygnal components on iOS and Android with sygnal/react-native. SygnalView, how primitives and HTML map to native components, controlled fields, native stylesheets, lists, incremental rendering, and your own components
---

`sygnal/react-native` runs a Sygnal app on React Native. Your components, intents and models stay as they are. The view renders into a [host tree](/renderers/custom-targets/), and the bridge shows that tree as React Native components. Native callbacks arrive as the DOM events your intents already listen for: `onPress` is a `click`, `onChangeText` an `input`.

```js
// index.js
import { createElement } from 'react'
import { registerRootComponent } from 'expo'
import { SygnalView } from 'sygnal/react-native'
import Tasks from './src/Tasks.jsx'

registerRootComponent(() => createElement(SygnalView, { app: Tasks }))
```

`react` and `react-native` are optional peer dependencies: install them in the app, as Expo does. In a Sygnal component file, set the JSX source with a pragma comment (`/** @jsxImportSource sygnal */`), because the React Native Babel preset compiles JSX for React by default. The [write-once example](https://github.com/tpresley/sygnal/tree/main/examples/write-once) is an Expo app with its Metro config, run in the iOS simulator.

## SygnalView

| Prop | |
|---|---|
| `app` | the root component |
| `drivers` | the app's other drivers (`DOM` is the bridge's) |
| `runOptions` | [`run()`](/reference/api/) options |
| `styles` | the native stylesheet (below) |
| `defaultStyles` | `false`: drop `defaultNativeStyles` (the look of plain HTML tags) |
| `components` | your own React Native components, by tag or primitive name |
| `onNavigate(href, el)` | a link's default action: route with your router driver |
| `style` | the root View's style (default `{ flex: 1 }`) |

The app starts when the view mounts, and is disposed when it unmounts. For lower-level control, `createNativeHost(options)` returns `{ driver, Root, doc, stop }`: run the app with `run(App, { DOM: host.driver })`, render `<host.Root />` wherever you like, and call `host.stop()` before disposing.

## What renders as what

| Host element | React Native | Events it makes |
|---|---|---|
| `View`, and `div` / `section` / `ul` / `form` … | `View` | |
| `Text`, and `span` / `p` / `label` / `h1` … | `Text` | `click` (`onPress`) when an intent listens for it |
| `Pressable`, `button` | `Pressable` (direct text wrapped in `Text`) | `click` |
| `TextInput`, `input`, `textarea` | `TextInput` | `input`, `keydown` Enter (submit key), `focus`, `blur`, `change` |
| `Switch`, `input type="checkbox"` | `Switch` | `click`, `input`, `change` |
| `Image`, `img` | `Image` | |
| `ScrollView` | `ScrollView` | `scroll` |
| `List` | `FlatList` over its children | `scroll` |
| `select` | a `Pressable` that steps to the next option | `input`, `change` |
| `a href` | `Text` | `click`, then `onNavigate(href)` |

An HTML view runs too. A container whose children are all inline (a `<li>` holding a checkbox, a label and a button) becomes a row, the way a browser lays it out, and `defaultNativeStyles` gives headings, links, buttons and fields their usual look. The [primitives](/renderers/write-once/) give you exact control instead.

A target's own field tags, registered with [`registerFieldTags`](/renderers/custom-targets/#your-own-tags), map by kind: `'text'` to `TextInput`, and `{ tag, kind: 'checkbox' }` to `Switch`.

## Controlled fields

A field's value comes from the app's state: `<Draft value={state.draft} />`. The bridge reads the value from the host element at the moment React renders the field, not before. React Native's own `TextInput` protocol (the native event count) then keeps the user's typing ahead of a render that hasn't seen it yet. The app's value wins whenever it differs, for example when the model clears the field after Add. You don't need anything extra for fast typing.

A `Switch` is a real checkbox: a press toggles `checked`, then fires `click`, `input` and `change`. When an intent prevents the click (`preventDefault()`), the switch springs back.

## Styles

Inline styles are React Native style objects. The `styles` prop adds a stylesheet of `[selector, style]` rules for anything that depends on classes or structure. Its rules are compiled with `StyleSheet.create`:

```js
// nativeStyles.js
export const nativeStyles = [
  ['.task.done', { opacity: 0.5 }],
  ['.toolbar', { flexDirection: 'row', justifyContent: 'space-between' }],
  ['.toolbar .title', { fontSize: 20, fontWeight: '600' }],
]
```

An element's style is its matching rules in order (after `defaultNativeStyles`), then its inline style. Flex layout keys work as in React Native. React Native doesn't inherit text styles from a `View`, so a View-like element's text keys (`color`, `fontSize`, …) style the `Text` that wraps its own direct text, and nested `Text` inherits as usual. Selectors support what the [host selectors](/renderers/custom-targets/#painting) do: tags, classes, attributes, `:not()`, and descendant and child combinators.

## Lists

Put a `Collection` in a `List`:

```jsx
// Feed.jsx
import { Collection } from 'sygnal'
import { List } from 'sygnal/primitives'
import Post from './Post.jsx'

export default function Feed() {
  return <List><Collection of={Post} from="posts" /></List>
}
```

On native, the `List` is a `FlatList` over the Collection's items, so only the visible rows have native views. The limits:

- **Every item stays mounted in Sygnal.** Each item component runs and keeps its state, as on the web. FlatList windows the native views only. Lists of a few thousand simple items are fine; for far more, page the data in your model (listen for `scroll` and its `detail.end`).
- **`VirtualCollection` is web-only:** it measures DOM elements, which a host tree doesn't have.

## Incremental rendering

Every host element is a memoized React component, keyed by its host node and that node's revision. A mutation moves the revision of the node and its ancestors, so a change re-renders only the path to it:

| A list of 100 items (303 elements) | Elements rendered | React commits |
|---|---|---|
| tap a counter at the top: full re-render | 303 | 1 |
| tap a counter at the top: `sygnal/react-native` | 2 | 1 |
| toggle item 51: full re-render | 303 | 1 |
| toggle item 51: `sygnal/react-native` | 4 | 1 |

These counts come from the library's tests, which use `onNodeRender` and `incremental: false` to compare. A descendant selector in the stylesheet (`.done .title`) makes a class change re-render that element's subtree too, since its descendants may now match differently.

## Your own components

`components` maps a tag (or a primitive name) to a function that returns a React element:

```js
// components.js
import { createElement as h } from 'react'
import { ActivityIndicator } from 'react-native'

export const components = {
  // <spinner size="large" /> in a Sygnal view
  spinner: (el, _children, style) => h(ActivityIndicator, { size: el.size || 'small', style: style.view }),
}
```

The function gets the host element, its children (already React elements), its computed style split into `{ view, text, all }`, and a context: `ctx.fire(el, type, init)` sends a DOM-shaped event, and `ctx.press(el)` sends a click with its default action. The tag renders as `<spinner>` on the web, so give the web a fallback or keep it in a native-only view.

## Limits

- **Expo Go, simulators and devices:** the bridge is plain JavaScript. A native build (`expo run:ios`) needs CocoaPods, as for any React Native app.
- **Web-only features:** `Portal`, the [UI parts](/ui/overview/), `VirtualCollection`, view transitions and the browser sources need the DOM.
- **Gestures:** a press is a `click`; double clicks, hover and long-press aren't mapped. Use a `components` entry with your gesture library for more.
- **Pickers:** React Native's core has no picker, so a `<select>` steps through its options on each press. Map `select` to a picker component through `components` for a real one.
