---
title: Browser Sources
description: Element visibility and size, media queries, storage keys, page visibility, the network, the clipboard and geolocation, declared from state with the browser static and makeBrowserDriver()
---

A component declares what it wants to watch in the browser as a function of its state, and gets each change as one of its own actions. There is no observer to create or listener to remove: while the declaration is there the source runs, and when it goes away the source stops.

```jsx
Card.browser = (state) => ({
  seen: !state.seen && { intersection: '.cover', action: 'SEEN' },
  dark: { media: '(prefers-color-scheme: dark)', action: 'DARK' },
})
```

It is the same shape as [`timers`](/guide/timers/): a function of the state that returns named specs, compared with the previous result by name.

## Setup

Browser sources are run by `makeBrowserDriver()`, which you register when you start the app:

```jsx
import { run, makeBrowserDriver } from 'sygnal'
import App from './App.jsx'

run(App, { BROWSER: makeBrowserDriver() })
```

The key is yours to choose (`BROWSER` by convention): Sygnal finds the driver by the `browser` static it takes. One driver serves every component of the app. A component that declares `browser` in an app without the driver gets [SYG643](/reference/errors/#syg643) in development.

`makeBrowserDriver()` has every source. An app that uses only a few can list them, so the others add no bytes:

```jsx
import { run, makeBrowserDriverWith, intersectionSource, mediaSource } from 'sygnal'
import App from './App.jsx'

run(App, { BROWSER: makeBrowserDriverWith(intersectionSource, mediaSource) })
```

A spec whose source the driver wasn't made with is [SYG664](/reference/errors/#syg664) in development. The sources are `intersectionSource`, `resizeSource`, `mediaSource`, `storageSource`, `visibilitySource`, `onlineSource`, `geolocationSource` and `clipboardSource`.

## The browser static

`browser` takes the state (with its calculated fields) and returns an object of named specs, or a falsy value for "not now". One key of a spec names its source (a spec has exactly one of them), and `action` names the action each event is delivered as:

| Spec | Watches | Action data |
|---|---|---|
| `{ intersection: '.cover', action }` | The elements the selector matches in this component's view entering or leaving the viewport (`IntersectionObserver`). `true` instead of a selector: the component's root element. Options: `threshold`, `rootMargin` | `{ visible, ratio, index, dataset }` |
| `{ resize: '.chart', action }` | The size of those elements' content box (`ResizeObserver`); `true`: the root element | `{ width, height, index, dataset }` |
| `{ media: '(min-width: 800px)', action }` | A media query | `{ matches, media }` |
| `{ storage: 'theme', action }` | A `localStorage` key (`area: 'session'`: `sessionStorage`; `json: true`: the value parsed), including writes from other tabs | `{ key, value }` (`null` when absent) |
| `{ visibility: true, action }` | Whether the page is visible (another tab, a minimized window) | `{ visible }` |
| `{ online: true, action }` | Whether the browser is online | `{ online }` |
| `{ geolocation: true, action, error }` | The device's position (`watchPosition`; permission-gated). `true`, or the position options `{ enableHighAccuracy, maximumAge, timeout }` | `{ latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed, timestamp }` |

`index` and `dataset` say which element the event is about when the selector matches several (its position among them, and a copy of its `data-*` attributes). Sources with a current value (`media`, `storage`, `visibility`, `online`) send it when they start, so the state is right from the first render after it; `intersection` and `resize` send what their observer reports for each element when it starts observing it. Elements that the selector matches later (a list that grows) are observed after the render that adds them, and removed ones are let go.

Sygnal compares the result with the previous one, name by name, whenever the state changes:

- a new name starts its source;
- a name that is gone, or now falsy, stops it;
- a spec that changed (another selector, another query) restarts it;
- a spec that is the same as before keeps running.

So, as with timers, `browser` is a description: return what should be watched now. A "load more when the end of the list is visible" or "fade in once" component turns its spec off with its state:

```jsx
export function Photo({ state }) {
  return <img className={state.seen ? 'photo shown' : 'photo'} src={state.src} alt={state.alt} />
}

Photo.initialState = { src: '/cat.jpg', alt: 'A cat', seen: false }
// watched until it has been seen once
Photo.browser = (state) => ({
  seen: !state.seen && { intersection: true, action: 'SEEN', threshold: 0.25 },
})
Photo.model = {
  SEEN: (state, { visible }) => visible ? { ...state, seen: true } : state,
}
```

Each [Collection](/guide/collections/) item declares its own sources, so `intersection: true` in an item component watches that item.

## Commands: the clipboard and storage writes

Reading or writing the clipboard is something a user asks for, not something to watch, so it is a command: a model entry sends it to the driver's sink, and the answer comes back as a reply action. The first key is the method:

| Command | Does | Reply |
|---|---|---|
| `{ copy: text, ok, error }` | Writes `text` to the clipboard | `ok`: `{ text }` |
| `{ paste: true, ok, error }` | Reads the clipboard's text | `ok`: `{ text }` |
| `{ setItem: key, value, area, json }` | Writes a storage key (`json: true` stores `value` as JSON); this page's `storage` declarations of that key see the change | `ok`: `{ key }` |
| `{ removeItem: key, area }` | Removes a storage key | `ok`: `{ key }` |

```jsx
export function ShareLink({ state }) {
  return (
    <div className="share">
      <input readOnly value={state.url} aria-label="Link" />
      <button className="copy">{state.copied ? 'Copied' : 'Copy link'}</button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </div>
  )
}

ShareLink.initialState = { url: 'https://example.com/p/42', copied: false, error: null }
ShareLink.intent = ({ DOM }) => ({ COPY: DOM.click('.copy') })
ShareLink.model = {
  COPY: { BROWSER: (state) => ({ copy: state.url, ok: 'COPIED', error: 'COPY_FAILED' }) },
  COPIED: (state) => ({ ...state, copied: true, error: null }),
  COPY_FAILED: (state, { message }) => ({ ...state, error: message }),
}
```

The browser only allows the clipboard in a secure context (HTTPS or localhost), and usually only during a user action such as a click: send the command from the action the click causes, as above. Reading needs the user's permission (some browsers ask, Safari shows a paste menu), so always name an `error` action for `paste`.

## Permissions and failures

`geolocation` and the clipboard are permission-gated: the first use may show a prompt, and the user may say no. A source or command that fails (permission denied, the API is missing, the position timed out, storage is blocked) sends its `error` action with `{ code, message }` (geolocation) or `{ name, message }` (clipboard, storage). Without an `error` action the failure is [SYG665](/reference/errors/#syg665) in development and nothing else happens, so name one whenever the user can refuse:

```jsx
export function NearMe({ state }) {
  if (state.error) return <p role="alert">Location unavailable: {state.error}</p>
  if (!state.position) return <p>Finding you…</p>
  return <p className="where">{state.position.latitude.toFixed(3)}, {state.position.longitude.toFixed(3)}</p>
}

NearMe.initialState = { position: null, error: null }
NearMe.browser = (state) => ({
  here: !state.error && { geolocation: { enableHighAccuracy: true }, action: 'POSITION', error: 'NO_POSITION' },
})
NearMe.model = {
  POSITION: (state, position) => ({ ...state, position }),
  NO_POSITION: (state, { message }) => ({ ...state, error: message }),
}
```

Ask for a permission-gated source when the user can see why, for example only after they press "Use my location" (declare it while `state.locating` is true).

## Storage and persist()

`storage` reads and observes a key that something else owns: another tab, another part of the app, a third-party script. To keep a component's own state across reloads, use [`persist()`](/guide/persistence/) instead: it restores the state before the first render, saves it as it changes, migrates old versions and syncs tabs.

## Hidden pages

A component on a hidden [Switchable](/guide/switchable/) page keeps its state, but its sources stop while the page is hidden, and start again (sending their current value) when it is shown. A source that should keep running says so:

```jsx
Inbox.browser = () => ({
  // keeps following the network while another page is shown
  net: { online: true, action: 'NETWORK', background: true },
})
```

When a component is removed, its sources stop; when the app is disposed, all of them do. During `renderToString` no driver runs, so nothing is watched on the server.

`onlineStatus$` (the [PWA helpers](/integration/pwa/)) is the same information as a stream for an intent. The `online` source is the declaration form: driven by state, paused on hidden pages, and faked by `renderComponent`.

## Testing

`renderComponent` provides a fake browser driver (no `drivers` option needed): the real driver, over sources that touch no browser API. `t.browser` drives it, and each call resolves once the actions it caused are reduced and the tree rendered:

```jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Photo } from './Photo.jsx'

it('shows the photo once it is seen, then stops watching', async () => {
  const t = renderComponent(Photo)
  await t.ready()
  expect(t.browser.active()).toEqual([{ name: 'seen', intersection: true, action: 'SEEN', threshold: 0.25, component: 'Photo' }])

  await t.browser.intersect(true, true)
  expect(t.state.seen).toBe(true)
  expect(t.browser.active()).toEqual([])
  t.dispose()
})
```

| Call | Effect |
|---|---|
| `t.browser.intersect(target, visible, data?)` | The declarations of that `intersection` target hear `{ visible, ratio: 1 or 0, index: 0, dataset: {} }` merged with `data`; `{ at: n }` in `data` picks the n-th of them (start order, from 0), e.g. one Collection item. Throws when nothing declares it |
| `t.browser.resize(target, { width, height })` | The same for `resize` |
| `t.browser.media(query, matches)` | The query matches now (or not) |
| `t.browser.storage(key, value, area?)` | Another tab writes the key (a non-string is stored as JSON; `null` removes it). With only a key: the stored string |
| `t.browser.visibility(visible)`, `t.browser.online(online)` | The page is visible / the network is up (or not) |
| `t.browser.geolocation(coords)` | A position (accuracy 0, the rest `null` unless given); `{ code, message }` instead: a failure |
| `t.browser.clipboard(text?)` | The clipboard's text (with an argument: sets it) |
| `t.browser.deny('geolocation', 'clipboard')` | Those permissions are refused from now on (a running geolocation declaration fails with code 1) |
| `t.browser.active()` | The running declarations: `{ name, ...spec, component }` |

The `browser` option sets the environment at the start: `renderComponent(Theme, { browser: { media: { '(prefers-color-scheme: dark)': true }, storage: { theme: '"dark"' }, online: false, deny: ['geolocation'] } })`. By default no media query matches, storage is empty, the page is visible and online, and nothing is denied. The commands (`copy`, `paste`, `setItem`, `removeItem`) run against the fake too. If the test passes its own browser driver in `drivers`, the fake stands down and `t.browser` throws (`browserSink` renames the fake's sink).

## Diagnostics

| Code | When |
|---|---|
| [SYG663](/reference/errors/#syg663) (error) | A spec the driver can't start (no known source key, no `action`, an `intersection` / `resize` target that is neither a selector nor `true`), or a command with an unknown method |
| [SYG664](/reference/errors/#syg664) (error) | A spec whose source `makeBrowserDriverWith(...)` wasn't given |
| [SYG665](/reference/errors/#syg665) (warning) | A source or command failed and names no `error` action |
| [SYG666](/reference/errors/#syg666) (warning) | An `intersection` / `resize` entry has nothing to observe: no DOM source reached the driver, or (in `renderComponent` with `dom: 'real'`) its selector matches no element of the component |
| [SYG643](/reference/errors/#syg643) (warning) | The component declares `browser`, but no browser driver is registered. `sygnal-check` reports it too when it can read the app's `run()` call |

Deferred loading of a component when it scrolls into view is [`lazy(…, { when: 'visible' })`](/advanced/lazy-loading/#loading-when-visible-or-idle).
