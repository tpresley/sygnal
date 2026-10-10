---
title: On-device Summaries
description: Summarise text with Chrome's built-in model through the chromePrompt() transport — no server, no key — and fall back to a plain excerpt where the model is unavailable
---

Chrome can run a small language model on the user's device, through the [Prompt API](https://developer.chrome.com/docs/ai/prompt-api) (`LanguageModel`). The `chromePrompt()` transport from `sygnal/ai` puts it behind the [chat driver](/guide/ai-chat/), so a component asks it for a summary exactly as it would ask a hosted model. Nothing leaves the device: no server, no key, no cost per request.

Not every visitor has it: other browsers don't, and Chrome needs a capable device and a one-time model download. So the feature must **degrade**: where the model is unavailable, the component shows a plain excerpt instead.

## main.js

```js
import { run } from 'sygnal'
import { makeChatDriver, chromePrompt } from 'sygnal/ai'
import Article from './Article.jsx'

run(Article, { LLM: makeChatDriver({ transport: chromePrompt() }) })
```

Where the browser has no `LanguageModel`, or the device can't run it, every request fails at once with an Error whose `status` is `'unavailable'`. The component's `error` action handles that like any failure, so `main.js` needs no check.

To use a hosted model where the on-device one is missing, choose the transport before `run()` with `status()`:

```js
import { run } from 'sygnal'
import { makeChatDriver, chromePrompt, uiMessageStream } from 'sygnal/ai'
import Article from './Article.jsx'

const onDevice = chromePrompt()
const transport = (await onDevice.status()) === 'unavailable' ? uiMessageStream('/api/summarize') : onDevice

run(Article, { LLM: makeChatDriver({ transport }) })
```

`status()` resolves with `'available'`, `'downloadable'`, `'downloading'` or `'unavailable'`. A `'downloadable'` model is downloaded by its first request, which must come from a user action (a click), so summarise on a click rather than on load. `chromePrompt({ monitor })` gets the download's progress events.

A component can show the status too, for example to say "Summaries need a one-time download" before the first click. A promise can't be read in a view, so give `status` to [`driverFromAsync`](/guide/custom-drivers/) and ask for it like any request:

```js
import { run, driverFromAsync } from 'sygnal'
import { makeChatDriver, chromePrompt } from 'sygnal/ai'
import Article from './Article.jsx'

const onDevice = chromePrompt()
run(Article, { LLM: makeChatDriver({ transport: onDevice }), MODEL: driverFromAsync(onDevice.status) })
```

```js
Article.model = {
  BOOTSTRAP: { MODEL: () => ({ ok: 'MODEL_STATUS' }) },
  MODEL_STATUS: (state, status) => ({ ...state, model: status }),
}
```

In a test, `await t.respond('MODEL', 'downloadable')` answers it.

## The component

The component is the same whatever the transport. In this demo it runs on the page's demo model (as every demo here does), and asks for a summary as soon as it shows. In your app, the same code runs on the device.

```js live-server
import { encodeOpenResponses } from 'sygnal/ai'

export default {
  'POST /v1/responses': () => ({
    sse: encodeOpenResponses(['Octopuses ', 'have three hearts ', 'and blue blood, ', 'and each arm ', 'can act ', 'on its own.']),
    delayMs: 300,
    chunkMs: 80,
  }),
}
```

```jsx live live-height=260
import { ABORT } from 'sygnal'

const TEXT = 'The octopus has three hearts: two pump blood through the gills, and one through the rest of the body. Its blood is blue, because it carries oxygen with copper instead of iron. Two thirds of its neurons are in its arms, so each arm can taste, touch and react without waiting for the brain. Most octopuses live only a year or two.'

// the fallback: the first two sentences
const excerpt = (text) => text.match(/[^.!?]+[.!?]+/g)?.slice(0, 2).join(' ') ?? text

const summarize = (text) => ({
  instructions: 'Summarise the text in one sentence of at most 25 words.',
  messages: [{ role: 'user', content: text }],
  key: 'summary',
  delta: 'SUMMARY',
  ok: 'SUMMARIZED',
  error: 'NO_SUMMARY',
})

function Article({ state }) {
  return (
    <article className="article">
      <p>{state.text}</p>
      <button type="button" className="summarize" disabled={state.status === 'busy'}>Summarise</button>
      <p aria-live="polite">
        {state.status === 'busy' && !state.summary && 'Summarising…'}
        {state.summary && <><b>Summary:</b> {state.summary}</>}
        {state.status === 'fallback' && <><b>Excerpt:</b> {excerpt(state.text)} <i>(summaries need Chrome's built-in model)</i></>}
      </p>
    </article>
  )
}

Article.initialState = { text: TEXT, summary: '', status: 'ready' }

Article.intent = ({ DOM }) => ({
  SUMMARIZE: DOM.click('.summarize'),
})

Article.model = {
  BOOTSTRAP: {
    STATE: (state) => ({ ...state, status: 'busy' }),
    LLM: (state) => summarize(state.text),
  },
  SUMMARIZE: {
    STATE: (state) => (state.status === 'busy' ? ABORT : { ...state, summary: '', status: 'busy' }),
    LLM: (state) => (state.status === 'busy' ? ABORT : summarize(state.text)),
  },
  SUMMARY: (state, { text }) => ({ ...state, summary: text }),
  SUMMARIZED: (state, { text }) => ({ ...state, summary: text, status: 'ready' }),
  // no model on this device: show the excerpt; any other failure: let the user try again
  NO_SUMMARY: (state, { error }) => ({ ...state, summary: '', status: error.status === 'unavailable' ? 'fallback' : 'ready' }),
}
```

- **The summary streams in** through `SUMMARY`, and `SUMMARIZED` ends the busy state.
- **Degrade, don't hide.** The excerpt is computed in the view from the text, so it needs no model. Where a summary isn't essential, an excerpt is an honest fallback.
- **Keep prompts short and in `instructions`.** The on-device model is small and has a small context window. Long articles need splitting, or a hosted model.

## What the on-device model can't do

- **No tools.** The Prompt API has no tool calling yet, so `chromePrompt()` doesn't send `tools`. An assistant that operates the app needs a hosted model.
- **One system prompt.** The Prompt API takes system text only at the start of a session, so `instructions` and every `system` message (wherever it is in the conversation) are joined into that one prompt.
- **Structured output works.** `output` becomes the Prompt API's `responseConstraint`, and `ok` gets the validated `value`, as with any transport.

## Testing

The LLM fake doesn't care which transport `main.js` uses. Fail a request with the transport's error to test the fallback:

```js
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import Article from './Article.jsx'

it('summarises, and falls back to an excerpt without the model', async () => {
  const t = renderComponent(Article)
  await t.respond('LLM', 'Octopuses have three hearts.')
  expect(t.html()).toContain('Summary:')

  t.simulateEvent('.summarize', 'click')
  await t.fail('LLM', Object.assign(new Error('the on-device model is unavailable'), { status: 'unavailable' }))
  expect(t.html()).toContain('Excerpt:')
  t.dispose()
})
```

To test the transport itself, `chromePrompt({ LanguageModel })` takes a stub of the Prompt API instead of the browser's.
