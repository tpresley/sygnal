# Ask with cards

A chat assistant on a local model that **asks with cards**. When it needs you to choose, pick, fill
in, rate or confirm something, it calls the `ask_user` tool and says in one sentence what it needs;
the app builds a card for it from parts it prepared, and your answer goes back to the model, which
continues the conversation from it.

- a **choice**: a question with options the model writes (free-text params: LLM only);
- a **plan picker** over the app's plans, and a **plan details** part (prepared, from app state);
- a **contact form** whose values live in the card (`local`);
- **yes / no** buttons and a 1–5 **rating**.

Every label and button is the app's own component; the model only picks parts and their params.
It is the [Cards in a Chat](https://sygnal.js.org/guide/ai-cards/) guide (`chat({ ask })`) as an app.

## Run it

```bash
npm install
npm run dev     # Ollama on http://localhost:11434 with a chat model that calls tools
                # (ollama pull qwen3:8b) and, optionally, a decision model (ollama pull nimble)
npm test        # no model needed: t.stream answers the chat, composeWith answers each card
```

Two pickers above the chat:

- **Chat model**: the installed Ollama models that call tools (`GET /api/tags`), `qwen3:8b` first.
- **Cards composed by**: the chat model itself (`compose.llm()`, the default), or a decision model:
  Ollama's `nimble` (`/v1/systemone`), or TypeSafe's Jev through a dev-only proxy, as in
  [ai-compose](../ai-compose#jev-typesafe-through-the-dev-proxy): put `TYPESAFE_API_KEY=...` in
  `~/.config/typesafe/env` and restart `npm run dev`. The browser never holds the key.

Another Ollama host: `VITE_OLLAMA_URL=http://host:11434 npm run dev`.

Things to try: "Which plan should I take?", "How much is Business for 5 people? Ask me to
confirm.", "I want to talk to sales", "Ask me to rate this conversation". Reload the page at any
point: the conversation comes back with its cards.

## How it works

**The assistant** ([`src/Assistant.jsx`](src/Assistant.jsx)):

```jsx
Assistant.uses = {
  assistant: chat({
    model: (state) => state.chatModel,       // the picked chat model, read per request
    form: '.ask', prompt: '.prompt', stop: '.stop',
    instructions: INSTRUCTIONS,
    ask: { catalog, backend: cardBackend(choice) },
  }),
}
// in the view, for each tool-ask_user part of a message
<section className="ask-card">
  <p className="need">{p.input?.need}</p>
  {askCard(catalog, state, p)}
</section>
```

The model's `need` is the card's heading, so a prepared part (the plan picker, yes / no) needs no
generated text, and works on a decision backend too. A card composes, opens, and once answered (or
cancelled by Stop, "Skip the card" or a new message) renders frozen with the pick marked.

**The catalog** ([`src/cards.jsx`](src/cards.jsx)): parts with `result: true` answer the card with
`compose.answer(props, value)`; the call's output is `{ part, answer }`. The host hears result
parts too (`CHILD.select(ContactForm)`, `CHILD.select(Rating)`), so the contact details and the
rating also land in app state.

**Grounded answers**: the agent declaration's `read` sends the plans with their real prices and the
user's current plan with every request (as app state, data rather than instructions), and its
action `billing_choose_plan` switches the plan once you picked and confirmed one. Without the
`read`, a small model invents prices.

**The pickers** ([`src/backends.js`](src/backends.js), [`src/App.jsx`](src/App.jsx)): the chat
model is app state, and `chat({ model: (state) => state.chatModel })` reads it per request (so do
the cards of `compose.llm({ model: (state) => state.chatModel })`): switching models needs no new
component. The card backend decides where card requests go (the chat's sink, or HTTP for a decision
model) and is fixed when `chat()` is defined, so `assistantFor(choice)` makes one assistant
component per card backend, once, and the app shows the picked one. The assistant has no state of
its own: the conversation (`state.assistant`) is in the app's state, so it stays when you switch,
and `persist()` keeps it. The first assistant is made when `Assistant.jsx` loads, before `run()`:
the first `chat()` call links the sygnal/ai behaviors to the apps started after it
([SYG442](https://sygnal.js.org/reference/errors#syg442)).

**Persistence**: `App.persist = persist({ key: 'ai-ask', pick: ['assistant', 'plan', …] })`. The
cards live on the messages (`part.ui`): an answered card comes back frozen with its pick, an open
one stays answerable, and one that was composing composes again.

**What happened** ([`src/WhatHappened.jsx`](src/WhatHappened.jsx)): for each card, what the
model asked for, the card's parts, who composed it and why (the chat model's `asked_for` plan, or
the decision model's answers with their probabilities: the card's `part.ui.decisions`), and the
tool output that went back. Who composed it is recorded by a host entry `'assistant.TOOL_CALL'`
when the card opens.

**Tests** ([`src/App.test.js`](src/App.test.js)), on fakes: ask → card → answer → the model
continues and switches the plan; a generated choice and a contact form; a failed composition and a
reply that is no card (the model is told and can ask in text); the same flow on nimble and on Jev
(`decide()` requests); switching the chat model mid-conversation; Stop while a card composes, Skip while one is open, a new message; reload
with an answered card and with an open one; the agent's `read` and action.
