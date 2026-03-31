---
title: "PWA Helpers"
description: "Service worker driver, online/offline detection, and install prompt handling for Progressive Web Apps"
---

Sygnal provides three PWA helpers that integrate with the reactive driver architecture — no external dependencies required.

## Service Worker Driver

`makeServiceWorkerDriver` creates a Cycle.js driver that registers a service worker and exposes its lifecycle as reactive streams.

```jsx
import { run, makeServiceWorkerDriver } from 'sygnal'
import App from './App'

run(App, {
  SW: makeServiceWorkerDriver('/sw.js', { scope: '/' }),
})
```

### Receiving Lifecycle Events

The driver source uses the standard `.select()` pattern:

```jsx
App.intent = ({ SW }) => ({
  SW_INSTALLED:    SW.select('installed'),    // true when SW installs
  SW_ACTIVATED:    SW.select('activated'),     // true when SW activates
  SW_WAITING:      SW.select('waiting'),       // ServiceWorker when update is waiting
  SW_CONTROLLING:  SW.select('controlling'),   // true when SW takes control
  SW_ERROR:        SW.select('error'),         // Error on registration failure
  SW_MESSAGE:      SW.select('message'),       // data from SW postMessage
})
```

### Sending Commands

The driver sink accepts command objects:

```jsx
App.model = {
  APPLY_UPDATE: {
    SW: () => ({ action: 'skipWaiting' }),   // activate waiting worker
  },
  SEND_DATA: {
    SW: (state) => ({ action: 'postMessage', data: { type: 'SYNC', payload: state.pending } }),
  },
  UNREGISTER: {
    SW: () => ({ action: 'unregister' }),
  },
}
```

### Update Banner Pattern

A common pattern is showing a banner when a new version is available:

```jsx
function App({ state }) {
  return (
    <div>
      {state.updateAvailable && (
        <div className="update-bar">
          <span>New version available</span>
          <button className="update-btn">Update now</button>
        </div>
      )}
      {/* rest of app */}
    </div>
  )
}

App.initialState = { updateAvailable: false }

App.intent = ({ DOM, SW }) => ({
  SW_WAITING:    SW.select('waiting'),
  SW_CONTROLLING: SW.select('controlling'),
  APPLY_UPDATE:  DOM.click('.update-btn'),
})

App.model = {
  SW_WAITING: (state) => ({ ...state, updateAvailable: true }),
  SW_CONTROLLING: (state) => ({ ...state, updateAvailable: false }),
  APPLY_UPDATE: {
    SW: () => ({ action: 'skipWaiting' }),
    EFFECT: () => window.location.reload(),
  },
}
```

## Online Status

`onlineStatus$()` returns a stream of booleans reflecting the browser's network state.

```jsx
import { onlineStatus$ } from 'sygnal'

App.intent = ({ DOM }) => ({
  ONLINE_CHANGED: onlineStatus$(),
})

App.model = {
  ONLINE_CHANGED: (state, isOnline) => ({
    ...state,
    isOffline: !isOnline,
  }),
}
```

The stream emits `navigator.onLine` immediately on subscribe, then emits `true`/`false` on `online`/`offline` window events. Listeners are cleaned up when the stream is unsubscribed.

## Install Prompt

`createInstallPrompt()` captures the `beforeinstallprompt` event and exposes it reactively.

```jsx
import { createInstallPrompt } from 'sygnal'

const installPrompt = createInstallPrompt()

App.intent = ({ DOM }) => ({
  CAN_INSTALL: installPrompt.select('beforeinstallprompt'),
  INSTALLED:   installPrompt.select('appinstalled'),
  INSTALL:     DOM.click('.install-btn'),
})

App.model = {
  CAN_INSTALL: (state) => ({ ...state, canInstall: true }),
  INSTALLED:   (state) => ({ ...state, canInstall: false }),
  INSTALL: {
    EFFECT: () => installPrompt.prompt(),
    STATE: (state) => ({ ...state, canInstall: false }),
  },
}
```

Create the instance once at module level and reference it in both intent and model.

## Service Worker File

The helpers handle the app-side integration. You still need a service worker file served from your `public/` directory. A minimal network-first example:

```javascript
// public/sw.js
const CACHE_NAME = 'app-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/', '/index.html']))
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()))
        return res
      })
      .catch(() => caches.match(event.request))
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
```

## SSR Safety

All three helpers are SSR-safe:

- `makeServiceWorkerDriver` no-ops when `navigator.serviceWorker` is unavailable
- `onlineStatus$()` emits `true` once if `window` is undefined
- `createInstallPrompt()` returns inert select/prompt methods without `window`

## PWA Template

Scaffold a complete PWA project with `create-sygnal-app`:

```bash
npm create sygnal-app my-app --template vite-pwa --ts
```

The template includes a service worker, web manifest, app icons, offline indicator, update banner, and install button — all wired up and ready to go.
