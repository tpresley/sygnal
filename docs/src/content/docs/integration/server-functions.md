---
title: Server Functions
description: Calling Telefunc server functions from Sygnal components through a driver with reply actions
---

Sygnal has no server-function runtime of its own. With [Vike](/integration/vike/), use [Telefunc](https://telefunc.com): a function exported from a `*.telefunc.js` file runs on the server, and importing it on the client gives a stub that calls it over HTTP. In a Sygnal app, the call goes through a driver, so the component stays pure and the reply arrives as a reply action, like an [HTTP request](/guide/http/).

Install and set up Telefunc for Vike as its documentation describes; this page only shows the Sygnal side. The Telefunc API shown here (`*.telefunc.js` files, `getContext()`, `Abort()`, `shield()`) follows the Telefunc docs at the time of writing; check them for your version.

## A server function

```javascript
// pages/quote/Quote.telefunc.js: runs on the server only
import { getContext, Abort } from 'telefunc'

export async function onLoadQuote(id) {
  const { user } = getContext()             // whatever your server puts in the context
  if (!user) throw Abort()                  // every telefunction is a public endpoint
  return db.quotes.find(id)                 // plain JSON data
}
```

## Calling it through driverFromAsync()

Register one driver for the page's functions in a `+drivers.js` file (Vike loads it on the client only; it sets the same `drivers` setting as `+config.js`). `args: ['call', 'args']` calls `call(request.call, request.args)`:

```javascript
// pages/quote/+drivers.js
import { driverFromAsync } from 'sygnal'
import * as quoteFns from './Quote.telefunc.js'

const call = (name, args = []) => quoteFns[name](...args)

export default { RPC: driverFromAsync(call, { args: ['call', 'args'] }) }
```

The component sends the call and names the reply actions:

```jsx
function Quote({ state }) {
  return (
    <div>
      <button className="load">Load</button>
      <p className="text">{state.status === 'loading' ? 'Loading…' : state.error || state.quote?.text}</p>
    </div>
  )
}
Quote.initialState = { id: 1, status: 'idle', quote: null, error: '' }
Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
Quote.model = {
  LOAD: {
    STATE: (state) => ({ ...state, status: 'loading', error: '' }),
    RPC:   (state) => ({ call: 'onLoadQuote', args: [state.id], ok: 'LOADED', error: 'FAILED' }),
  },
  LOADED: (state, quote) => ({ ...state, status: 'done', quote }),       // what onLoadQuote returned
  FAILED: (state) => ({ ...state, status: 'error', error: 'Could not load the quote.' }),            // data: { error, request }
}
```

- `LOADED` gets the function's return value; `FAILED` gets `{ error, request }` when the call throws or the network fails.
- The reply reaches exactly the instance that called. `driverFromAsync` has no `latest`/`abort` ([Custom Drivers](/guide/custom-drivers/#stale-replies) shows the request-id technique).
- Tests need no server and no driver: `await t.respond('RPC', { text: 'Hi' }, 'LOADED')` answers the call, and `t.requests('RPC')` shows `{ call: 'onLoadQuote', args: [1], … }`.
- Data a page needs for its first render belongs in Vike's `+data` (it is merged into `initialState`), not in a call on `BOOTSTRAP`.

## Security

A server function is an HTTP endpoint that anyone can call with any arguments, whatever the client code does. Whether you use Telefunc or expose functions some other way:

- **Authorize inside every function.** Read the user from an explicit request context (`getContext()` in Telefunc) and reject what they may not do. A button the UI hides is not a permission check.
- **Validate every argument at runtime.** Telefunc's `shield()` does this (with TypeScript it can be generated from the types); otherwise use a schema validator (zod, valibot, ArkType). Never trust a type annotation alone.
- **Keep server code in server-only files** (`*.telefunc.js`). Don't define server functions as closures inside client modules, where they can capture and leak values in scope.
- **Send plain JSON** in both directions. Avoid serialisation formats that rebuild objects, references or code on the server.
- **Protect against CSRF**: require POST with a custom header and check the `Origin` header, or rely on a framework that does (check your Telefunc setup and cookie `SameSite` settings).
- **Expose only what you mean to.** Export only the functions the client calls, from files you know; don't route arbitrary names to arbitrary modules (the `call` helper above only reaches the functions of one module).
- **Return only what the caller may see**: select fields instead of returning whole database rows.
