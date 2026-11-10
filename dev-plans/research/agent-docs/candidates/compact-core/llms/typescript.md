# Sygnal: TypeScript beyond `Comp`

> A topic file of Sygnal's agent context. It assumes the core (`llms.txt`, or the sygnal-dev skill's `SKILL.md`: mental model, component anatomy, canonical forms, wiring rules, testing): read that first.

- **Which form.** A model next to its component is `C.model = { ... }`: canonical, typed by `Comp`, every action listed in `actions`, an unknown key is a type error. Use `ModelFor` only when the model is its own constant: don't hand-annotate its reducers.
- **A `const model`**: `Spec` is what `Comp` names.

```tsx
const intent = ({ DOM }: IntentSources<State>) => ({ LOAD: DOM.click('.load') })
type Spec = { state: State; actions: ActionsOf<typeof intent> }
const model = {
  LOAD: { STATE: (state) => ({ ...state, busy: true }), HTTP: (state) => ({ url: `/q/${state.id}`, ok: 'LOADED', error: 'FAILED' }) },
  LOADED: (state, quote: Quote) => ({ ...state, busy: false, quote }),
  FAILED: (state, failure: FetchFailure) => ({ ...state, busy: false, status: failure.status }),
} satisfies ModelFor<Spec>
const C: Comp<Spec & { actions: ModelActions<typeof model> }> = ({ state }) => <div>{state.quote?.text}</div>
C.intent = intent
C.model = model
```

- `state`, `next` and the 4th argument are typed; so is the data of an action `Spec` names. Annotate the data only of actions it doesn't name (replies, `next()` targets), once, on the reducer: unannotated it is `unknown`. No separate action map: `ModelActions<typeof model>` reads names and data from the model.
- Any key is allowed, so a misnamed model key or `next()` name is not a `tsc` error here: run `sygnal-check` (SYG101, SYG102, SYG117). `next('NAME', data)` is checked only for names `Spec` knows. Needs TypeScript 4.9+.
- **App-wide context**: register what the root provides once; then no `context` key on each component and no per-component interface repeating those fields. In a module file:

```tsx
export const context = { route: (s: AppState) => s.route, csrf: (s: AppState) => s.csrf }
declare module 'sygnal' { interface SygnalContext extends ContextOf<typeof context> {} }
App.context = context
```

- A component's `context` key adds to the registry (what a subtree's provider adds). The registry doesn't prove an ancestor provides a field; `RootComp<{ state: S; provided: ContextOf<typeof context> }>` makes the root provide all of it.
- Guide: https://sygnal.js.org/integration/typescript/
