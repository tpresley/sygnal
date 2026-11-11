# Backlog for 8.0

Changes decided for the next major release, with what earlier releases do to prepare for them.
Each entry: the change, why, the migration path, what's still to decide.

## B8-1: the object-form component type becomes canonical under the `Component` name

Decided 2026-11-02 (maintainer). Origin: the Sift port's feedback (seven positional generics per
annotated file, `CHILD.select` payloads `unknown` until `SINK_RETURNS` is filled in), answered in
7.2 by `Comp<{ ... }>` / `RootComp<{ ... }>` (`ComponentSpec` / `RootComponentSpec`) next to the
positional `Component<State, Props, Drivers, Actions, Calculated, Context, SinkReturns>`.

**Change (8.0):** `Component<{ state, props, drivers, actions, calculated, context, parent, ... }>`
and `RootComponent<{ ... }>` take only the object form. The positional form is removed (types
only; no runtime change). `Comp` / `RootComp` stay as aliases through 8.x so code written against
7.2–7.x keeps compiling, and `sygnal-check --fix` renames them to `Component` / `RootComponent`.

**Why:** named keys can't be put in the wrong place, unused positions need no `{}`, a misspelled
key is a type error, and `parent: Payload` sits next to the state instead of in a seventh slot.
That's better for people and for agents (fewer positional mistakes, nothing to count).

**Why it can't happen in 7.x:** `Component<{ state: 'idle' | 'busy' }>` is valid positional code
today (a state with a `state` key), and no type can tell it apart from the object form. Reading
one as the other would silently retype existing code: the reason 7.2 used new names.

**Migration path:**
- 7.x (from 7.2): docs, llms.txt and the skill show `Comp<{ ... }>` as the preferred annotation.
  A strict-mode sygnal-check rule (new SYG5xx, info/warn) flags positional
  `Component<...>` / `RootComponent<...>`, and `--fix` rewrites them by position:
  `Component<S, P, {}, A>` → `Comp<{ state: S; props: P; actions: A }>` (empty `{}` / defaults
  dropped). The fix is syntactic and needs no type information, because in 7.x every argument's
  meaning is fixed by its position. This is the main migration: run it before upgrading.
- 8.0: sygnal-check error (new SYG6xx, removed form, like SYG612) for a `Component<X>` /
  `RootComponent<X>` whose argument isn't an object type whose keys are all spec keys:
  `Component<State>` (a type reference), `Component<S, P>` (more than one argument), or an object
  literal with non-spec keys. `--fix` wraps it as `Component<{ state: X }>` / maps the positions.
  `--fix` also renames `Comp` → `Component`.
- 8.0 types: `ComponentSpec` rejects unknown keys, so most unmigrated `Component<State>` uses fail
  to compile ("'count' does not exist in type ComponentSpec") instead of compiling wrongly. The one
  silent case is a state type made only of spec-key names (`{ state; props }`, ...). The checker's
  7.x rule catches it before the upgrade, and the 8.0 rule flags object literals there. The
  migration guide (`guide/migrating-to-8`) says to run `sygnal-check --fix` on 7.x first.
- `defineComponent<...>` explicit generics: same treatment (object form only in 8.0).

**Still to decide:** the diagnostic numbers (allocate in `codes.ts` when the work starts);
whether `Comp` / `RootComp` are deprecated in 8.0 (a JSDoc `@deprecated`) or only in 9.0; whether
`ParentPayloadOf` and the other helper types gain object-form inputs.

## B8-2: declaration statics read context fields only through `bag.context`

Decided 2026-11-03 (maintainer). Origin: the Sift port (a resource function couldn't see the
component's props, so a child copied props into state and the parent reset it when they changed),
generalized to one rule in 7.2: every function written over state takes `(subject, …its own
arguments, bag)`, the bag being the view's `{ ...props, state, context, uid }`.

**Change (8.0):** the declaration statics' bag (`resources`, `timers`, `connections`, `head`,
`browser`, `route`) no longer carries the context's own fields. `(state, { route })` then reads a
prop named `route`, or undefined; the context is `(state, { context: { route } })`.

**Why it waits for 8.0:** before 7.2 the second argument was the context itself, so
`(state, { route })` is everywhere (docs, Sift, the examples of 7.1). 7.2 keeps those fields on the
bag (the bag's own keys and the props win on a collision).

**Migration path (done in 7.2):** the dev entry warns on each such read (SYG458, once per
component and key; a collision says the prop won); `sygnal-check` reports it statically (a key some
`.context` declares) and `--fix` rewrites `(s, { route })` → `(s, { context: { route } })`.
**8.0:** remove the `...context` spread in `src/core/statics.ts` (`checkStatics`), the
`DeclarationBag` type's `Omit<CONTEXT, …>` part (it becomes `ReadBag`), and the `wrapBag` hook if
nothing else uses it; SYG458 becomes "Retired in 8.0" (sygnal-check may keep reporting the old form
as an error with its fix).

## B8-3: form `request` takes the host state first

Decided 2026-11-03 (maintainer), with B8-2's rule. 7.2 gives `request` the bag last:
`(data, hostState, bag)`, so it keeps working. Under the rule (`(subject, …its own arguments, bag)`)
the subject is the host state, so 8.0 reorders it to `(hostState, data, bag)`.

**Migration path:** 7.x documents the 7.2 order; a sygnal-check rule (and `--fix`, swapping the
first two parameters of a `request` function in `form()` options) lands before 8.0. Open: whether
the 7.x rule is a strict-mode note or a warning.

## B8-4: a write with `updates` or `invalidates` outlives its sender by default

Decided 2026-11-04 (maintainer), from the Sift console port's Phase C. 7.2 adds `detached: true`
on a fetch request: it isn't aborted when its sender is disposed, its `updates` and `invalidates`
still apply, and its `ok` / `error` actions are dropped. Aborting such a write is rarely what an
app wants: the server may apply it while the client loses its cache effects. React Query's
mutations finish after an unmount by default.

**8.0:** a request with `updates` or `invalidates` (its cache effects belong to the app, not the
component) is detached unless it says `detached: false`; other requests with reply actions keep
being aborted with their sender. Open: whether a write without either should follow (no cache
effect to keep, but the server still applies it).

**Migration path:** 7.x documents `detached`; a strict-mode note before 8.0 for a write with
`updates` / `invalidates` and no `detached`, so an app can opt in early and see what changes.

**Related, deferred (maintainer, 2026-11-05; Sift Phase D):** `updates` names only the sender's own
resources. To write a reply into an ancestor's resource (the root's `/auth/me` session after a
sign-in or a password change), Sift re-declares the identical read in the page so the two share a
cache entry. That works and is its documented pattern. Revisit with B8-4: `updates` naming a cache
key or URL, or a `context` resource.

## B8-5: consider a strict code for feature drivers passed to `run()`

Maintainer decision, 2026-11-09: `App.drivers` is the canonical place for feature drivers, and `run(App, {...})` stays for what differs per environment (`dev-plans/PLAN-1-canonical-forms.md` C21; research: `dev-plans/research/files-touched`). There is no strict-mode code for the `run()` form today. This item is to decide whether 8.0 should add one.

The obstacle is telling the two uses apart from the `run()` call alone, since both are `run(App, { NAME: driver })`. What would distinguish an environment override from a feature driver:

- **Overrides a static.** The root's `drivers` declares the same name: an override by definition, never flagged.
- **Depends on the environment.** The value reads `import.meta.env`, `process.env` or a URL parameter, or sits under a condition. Not flagged.
- **Depends on the entry point.** The value uses something only `main.js` has: a renderer or worker target (`target.driver`, `host.driver`), the mount point, or a value created there that is also used after `run()` returns (an agent view attached to the app, a Yjs provider that connects when created). Not flagged.
- **A double.** The driver is imported from a test or fake module, or a `fetch` option is a local fake. A name-based guess, so it needs an ignore comment as an escape.
- **Otherwise** (a literal factory call with constant options, for a name no static declares): the feature-driver case the code would flag, and `--fix` could move it to the static (the `rootDriverFix` of SYG643/SYG609).

`sygnal-check` can see all of this; the runtime can only see that no static has the name. So it would be static-only, like SYG503. Decide after a release of real use shows how many `run()` arguments land in the "otherwise" case by mistake.

## B8-6: unhandled things become errors

From the strategy review of 2026-11-09 (maintainer: keep for 8.0, 2026-11-10). The friction Tune and Sift kept reporting was silent no-ops: an action, a reply or a command that goes nowhere. Each fix so far was a new diagnostic plus a new sentence in `llms.txt`. The 8.0 change is to make these fail in dev, or to make the mistaken form work, so the rule no longer needs documenting.

The candidates, one decision each, are the 13 entries of `dev-plans/research/agent-docs/data/traps-8.0.md` (SYG101, 105, 106, 115, 116, 132, 143, 202, 221, 222, 302, 421, 643). Three kinds:

- **Throw in dev:** an intent action with no model entry (SYG101), an unknown DOM event shorthand (SYG115), a prop overwritten by a reserved view argument (SYG106), state mutated in place (SYG222, by freezing the state handed to reducers).
- **Make the form work:** `set('draft')` (SYG221), a sink function returning an `event()` result (SYG116), `DOM.select(Widget)` (SYG143), a default import from `xstream/extra/*` (SYG302), a hyphenated `data` key (SYG421), a root with declaration statics and no `initialState` (SYG132).
- **Decide:** `undefined` from a root reducer as ABORT or a throw (SYG202); raising SYG105 to a warning.

Still to decide: which of these are breaking (a dev-only throw is not, a production throw is), and whether a reply or command with no receiver gets the same treatment as an action. Each one that lands removes its sentence from `llms.txt` and its topic file.
