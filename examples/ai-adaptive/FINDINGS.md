# Findings: stress-testing composed UI

What building this example turned up, in order of impact. "Verified" means reproduced, not just
read from the source. Model observations are from `qwen3:8b` on Ollama (temperature 0, thinking
off) through `compose.llm()`.

## Bugs

Bugs 1–4 are fixed in tpresley/sygnal#65 (1) and tpresley/sygnal#66 (2–4); the example no longer
works around them, and `src/realdom.test.js` guards 1–3 in a real DOM.

### 1. Non-bubbling events: one listener per element, whichever selector came first (fixed, #65)

`EventDelegator` puts one listener per element per non-bubbling type (`submit`, `reset`, `toggle`,
`scroll`, `load`, …) in `element.subs[type]`, bound to the destination of the first stream whose
selector matched (`setupNonBubblingListener` in `src/cycle/dom/EventDelegator.ts`). Two effects:

- **An element that snabbdom reuses for another selector keeps the old listener.** In the intake
  lab, the `.change` form appears once a form is composed; snabbdom reused the existing `<form>`
  element for it (unkeyed siblings with the same tag). Its listener was still `.intake`'s, so
  `DOM.submit('.change', { preventDefault: true })` never ran: Enter in the "Change it" field
  reloaded the page (`/?`).
- **Two selectors on one element: only the first hears the event.** `DOM.submit('.a')` and
  `DOM.submit('.f')` on `<form class="f a">`: `A` fires, `F` never does. A host listening to its own
  form next to a `form()` behavior on the same element would hit this.

Repro (`// @vitest-environment jsdom`, `renderComponent(C, { dom: 'real' })`):

```jsx
function Two({ state }) {
  return (
    <div>
      {state.show && <form className="late"><button type="submit">late</button></form>}
      <form className="first"><button type="submit">first</button></form>
    </div>
  )
}
Two.intent = ({ DOM }) => ({ FIRST: DOM.submit('.first', { preventDefault: true }), LATE: DOM.submit('.late', { preventDefault: true }) })
// after SHOW: a submit on .late is not prevented and LATE never fires (FIRST still works)

function Both() { return <form className="f a"><button type="submit">go</button></form> }
Both.intent = ({ DOM }) => ({ A: DOM.submit('.a'), F: DOM.submit('.f') })
// a submit: A fires, F doesn't
```

Fix: each element's listener delivers to every destination set up on it.

### 2. `render` parts are rendered unkeyed (fixed, #66)

`catalog.render` keys component parts by node key, but a `render` part's vnode is returned as the
view function made it (`render.ts`: `if (part.render) return part.render(...)`). When an edit
inserts a piece above another ("add the device field above the details"), the patch reuses
elements by position: the `<textarea>` being typed in is replaced, focus goes to `<body>`, and the
next keystrokes are lost. A/B in the browser: unkeyed, the textarea was a new element and " on
the seat" was dropped; with a keyed wrapper, the same element kept focus through the edit.
Fix: set the vnode's key to the node key (as for components) when the view didn't give one.
Fix: a `render` part's root vnode gets the node key unless the view gave one.

### 3. A fresh composition's preview tears down the page it replaces (fixed, #66)

While `compose.llm()` streams a fresh layout, `catalog.render` shows the preview: only the nodes
finished so far. Re-arranging an existing board therefore takes every card off the page and puts
them back one by one over the ~15 s stream (sampled: 9 cards → 1 → 2 → … → 9). Component parts are
disposed and remade: focus, typing and local state go. For a first composition the preview is
right; for a re-arrangement it is the worst choice. Ideas: a preview that keeps the previous
layout's nodes not yet streamed in place (merge), or `compose(…, { preview: 'first' | false })`.
Fix: `compose(…, { preview: 'merge' | 'replace' | 'keep' })`, `'merge'` by default: the parts not streamed yet
stay where they were, mounted. Verified with qwen3:8b: every card stayed mounted through a 15 s
re-arrangement, and a note being typed kept its element and focus.

### 4. Containers can't repeat, silently (fixed, #66)

`maxUses` on a container is dropped by `defineCatalog` (not in `CatalogContainer`'s normalized
shape nor in the `.d.ts`), and the LLM backend reads `def.maxUses ?? 1`: a reply with three
sections is repaired down to one. A form with "Trip" and "Expenses" sections can't be composed.
No diagnostic for the unknown key either. Fix: containers take `maxUses` (default: no limit), in
both backends, the prompt ("up to 3 times") and `finish`.

## DX rough edges and feature ideas

### Forms whose fields are chosen at run time

- **`form()` only takes names already in its start values** (others are skipped; SYG230 in dev).
  A composed form has to predeclare every name any piece could write, including the node keys of
  repeated parts (`extra: { question: '', 'question~2': '', 'question~3': '' }`), which ties the
  form's values to the catalog's `maxUses` and its key scheme. Idea: let a record-typed path
  accept new keys (`open: ['extra']`), or let `render` parts register their fields.
- **The schema is fixed at definition; required-ness depends on the composition.** The app
  re-implements "required" (`requiredNames` / `missingNames`), keeps its own `missing` list and
  error rendering next to the schema's, and a submit it rejects still leaves the slice
  `submitted: true`. Idea: `schema: (state) => schema` or `required: (state) => names`; or a
  documented recipe that feeds `form.ERRORS`.
- **`render` vs `component` parts matter far more than the table says.** Only `render` parts sit
  in the host's DOM scope, so only they can join a host's `form()` (and be heard by the host's
  intent). Worth a sentence in the guide's Parts table, and an example.

### Composing from a situation, not a request

- **The built-in prompt rules assume the request names the parts.** "Use only the parts the
  request asks for … Do not add parts it does not ask for" makes a bare task ("I lost my laptop")
  or a situation ("checkout is down") compose little or nothing; `guidance` is appended after
  them and can't override. The app rewrites the request (`formRequest()`), and the board's brief
  ends with "Show every part listed here". Idea: a mode that lets the model infer parts
  (`select: 'infer'`), or a way to replace the rules rather than append to them.
- **No state context for the model.** `model` can be a function of state; `instructions` is a
  string or a function of the prompt string only. The only channels for app data are the prompt
  text and record params' `description` (which the board uses: "SEV1 on checkout, 6 min old,
  not acknowledged"). Idea: `instructions: (prompt, state) => …` or `context: (state) => text`.
- **Invariants on a model's layout need a second pass.** Holding the model to pins and snoozes
  took `page.DONE` → `toTree` → edit → `fromTree` → `page.SET_LAYOUT`, i.e. a second patch after
  the model's layout already showed. Idea: `compose(catalog, { constrain: (layout, state) =>
  layout })`, applied to previews and finished layouts alike.
- **Rules and the model don't share a pipeline.** The rules arrange through `SET_LAYOUT`, which
  doesn't send `page.DONE`, so post-processing hooks only run for the model. A synchronous local
  backend (`compose.local((state, prompt) => tree)`) would let rules be a backend: same slice,
  same DONE, and an easy "rules now, model refines" fallback.
- **`pin` only works with `required`.** A confirmation checkbox should stay last whenever it's on
  the form; a later "also ask who attended" edit put the new question below it.

### Latency on a page that re-arranges itself

A fresh arrangement of the board (9 parts, each with a `why`) took 15–20 s on `qwen3:8b`; the
intake form 6–9 s; a one-piece edit 3–6 s. For a surface that moves on its own, the app had to:
re-arrange only when a part changes band (`STATE.watch` on a signature, not the scores), keep the
current page up while composing (bug 3), and fall back to the rules on an error. An edit (ops) is
much cheaper than a fresh tree; re-arranging as an edit ("Current page … Change: <brief>") is
worth measuring.

### Smaller things

- A capitalized view helper (`<Card>`, `<Field>`) is a child component, so the buttons in it are
  out of the intent's reach. sygnal-check caught it (SYG104) for `<Card>`; the fix is to call it
  as a function.
- sygnal-check's SYG110 (info) flags `.pin` / `.snooze` in `BoardLab`'s intent as not in its view:
  they are rendered by the catalog's `render` parts, which the checker doesn't follow.
- sygnal-check's SYG254 was useful: it caught descriptions naming a param option ("…or a from–to
  range" on the dates piece).
- Testing: `simulateEvent(radio, 'change')` doesn't reach a `form()` (it listens to `input`, which
  browsers fire for radios and selects too); and `t.waitForState(s => s.missing.length === 0)`
  matched the initial state (documented, but easy to trip on). A hint when a simulated `change`
  lands on a field of a form behavior that only hears `input` would help.

## Found while verifying the fixes

- **An edit can't wrap parts in a container.** `compose.llm()`'s edit operations place things only
  `top`, `bottom`, `above/below <key>` or `left/right of <key>`: there is no op to add a container
  or move a part into one, and the ops schema doesn't offer containers at all. The edit prompt
  still lists them ("Containers: section … up to 3 times"), so "put the dates and amount in a Trip
  section" asks for something the grammar can't express. With qwen3:8b the model looped
  `{"op":"add","part":"dates","where":"top"},{"op":"add","part":"amount","where":"top"},…` without
  end: replayed with `max_tokens: 600` it stopped at the cap (`finish_reason: "length"`, 28 s); the
  app's own request, which sends no `max_tokens` and whose `ops` array has no `maxItems`, streamed
  for minutes with the page in "preview" and the Change button disabled. Ideas: container ops (`wrap: [keys], in: '<container>'`, `where: 'into <key>'`), or
  dropping containers from the edit prompt and answering such a change as a fresh composition;
  either way a cap on `ops` and a timeout on a compose request.
- **sygnal-check didn't know the new `preview` option** (SYG127 in the dev checker). Fixed in #66.
- **Aborted requests still cost the model's time.** Hot reloads during development (and any
  burst of `latest` re-sends) abort fetches, but Ollama keeps generating each one: about 20 aborted
  requests queued up and delayed the next real composition by minutes. Not a Sygnal bug, but a
  self-arranging page that recomposes on every change needs a debounce, or a cap on requests in
  flight, more than a `latest` abort.
- **A piece that repeats needs its own value names.** "Flight and hotel budget" can only be one
  `amount` piece: the form's names are fixed per piece (`amount`, `currency`), so a second amount
  would write over the first. Only `question` repeats, because its names come from the node key.
  Composed forms want a field-name scheme per node (`<node>.<field>`), which loops back to
  `form()` needing to accept names that appear at run time.

## Model behaviour (qwen3:8b)

- Inferred sensible forms from a task: the laptop → place, date, details, contact (phone
  required), attachments; the dinner expense → amount, date, place, details, and a confirmation
  it wrote itself ("I confirm the expense is for a business dinner with Globex.").
- Fills **required** text params, leaves **optional** ones at their default ("When", "Where"):
  make a label required if it should be written.
- Missed the device piece for a lost *laptop*; the app's rule added it once the details said so.
- Edits were exact: "add device above n3", "add attachments below n1", "add question {label:
  'Who attended the dinner?'} bottom".
- On the board it honored a pin from the brief itself, sized the incidents `full` and the watch
  items `compact`, and wrote a usable reason per card.
