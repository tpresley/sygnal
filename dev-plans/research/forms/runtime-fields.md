# Forms whose fields are chosen at run time (RT-1)

Status: implemented (`form(schema, { dynamic })`, `form((state) => schema, …)`), 2026-11-02.
Source: `examples/ai-adaptive` (intake lab, `src/intake/`), FINDINGS.md "Forms whose fields are
chosen at run time" and "A piece that repeats needs its own value names".

## The problem

The `form` behavior took only field names already present in its start values; any other name was
skipped (SYG230 in dev). A composed form, where a model picks the field pieces, fought that three
ways:

1. **Predeclared names.** `values` had to list every name any piece could write, including the node
   keys of repeated pieces (`extra: { question: '', 'question~2': '', 'question~3': '' }`), tying
   the form to the catalog's `maxUses` and to compose's node-key scheme.
2. **Fixed names per piece.** A piece wrote `amount` / `currency`, so it could not repeat: a second
   amount piece ("flight and hotel budget") would write over the first.
3. **Required-ness outside the schema.** The schema is fixed at definition, but which fields are
   required depends on what was composed (and on piece params: the contact's phone may be
   required, optional or absent). The app kept its own `requiredNames` / `missingNames`, its own
   `missing` list and error rendering beside the schema's, and a submit it rejected still left the
   slice `submitted: true` (the form had already accepted it).

## What established libraries do

| Library | Fields that appear at run time | Validation that depends on them | A field that goes away |
| --- | --- | --- | --- |
| React Hook Form | `register(name, rules)` at render; any path | field `rules`, or a `resolver(values, context)`: the app passes `context` (its state) | `shouldUnregister` (default false: value kept, validation skipped) |
| TanStack Form | `<form.Field name>` creates it; any path; `defaultValue` per field | field-level `validators` (Standard Schema), plus form-level | value kept (`removeFieldValue` / `deleteField` to drop it) |
| Final Form | `registerField(name, …, { initialValue, validate })` | field-level `validate` plus form-level | `destroyOnUnregister` (default false) |
| Formik | any path via `setFieldValue` | `validationSchema` (Yup `when()` reads sibling values) | kept |

Common ground: a field has a **default value** when it appears (otherwise a `<select>` that shows
"USD" submits nothing), and validation can depend on **context the schema can't see** (RHF's
resolver context, Yup's `when`, TanStack's per-field validators).

## Options

### A. Open paths: `form(schema, { open: ['extra'] })`

CHANGE on any name under an open path creates it. Smallest change; solves (1) for one record path.

- A field that never receives input has no value: a select showing its first option or a checkbox
  left unticked submits nothing (the schema sees `undefined`).
- Nothing removes a piece's value when the piece goes; the submit sends it.
- Doesn't touch (3): the schema is still fixed, so required-ness stays in the app.
- SYG230 loses its typo check under the open path.

### B. Fields register themselves when rendered (read from the DOM)

The form's intent reads the named controls inside the form element (`DOM.select(sel).elements()`)
and makes them fields, as RHF's `register` does at mount.

- Against Sygnal's grain: the field set would come from the DOM, not from state. The mock DOM
  (`renderComponent`'s default), SSR, `sygnal/host` targets (terminal, worker, native) don't give
  the form's elements; the intake tests run on the mock DOM.
- Start values would have to come from DOM attributes (a select's selected option), the same
  problem as A in another place.
- Required-ness could come from the `required` attribute (HTML constraint validation), but only
  "required": not the piece's other rules, and outside Standard Schema.

### C. Required names from state: `required: (state) => names`

Solves (3) alone, as data. Leaves (1) and (2), and only covers "required": a repeated amount still
needs its own "positive" rule per node, which a fixed schema can't address.

### D. Record-typed values in a Standard Schema

Pieces write under `pieces.<kind>.<node>.<field>`, the schema declares `z.record(...)` per kind.
Repeats work with a fixed schema. But (1) remains (record entries still need to exist before
input: same as A), and param-dependent rules (phone required vs optional) need state.

### E. Dynamic fields from the host state + a schema of the host state (chosen)

Two options that both follow the host's state, the way a composed view does:

- **`dynamic: (state) => ({ path: start value })`**: the fields beyond `values` that are on the form
  now. The form watches it (structurally) and reconciles: an entry that appears is added to
  `values` (and `initial`, so it isn't dirty) with its start value; one that stays keeps what was
  typed (an object start value reshapes it: keys gained added, keys lost dropped, e.g. a date piece
  switched from one day to a range); one that goes is removed with its touched, server errors,
  check results and running checks. RESET and `resetOnShow` start them over too.
- **`form((state) => schema, …)`**: a schema that depends on the host's state (required-ness from
  what is composed, and every other piece rule). Called whenever the form validates; the results
  are cached per schema object, so it must return the same schema while the rules don't change
  (memoized on what it reads, e.g. a WeakMap on the layout). The form re-validates when the
  function returns another schema, even with the same fields (a contact switched to "phone
  required").

Per-node prefixes need no compose change: a `render` part already gets its node key as the `node`
prop, so a piece names its fields `<node>` (one value) or `<node>.<field>` (several), and the app's
`dynamic` and schema key each piece's start values and rules by node key. A repeated piece is
`amount` and `amount~2`.

Why E:

- State-first, like the rest of Sygnal: the field set is derived from the same state the view is
  derived from, so it works on the mock DOM, SSR and every host target, and in record/replay
  (SYNC's data is plain: the field entries).
- Start values are explicit (the RHF / TanStack / Final Form `defaultValue`), so a select or a
  checkbox submits what it shows.
- The schema stays the single source of validation: Standard Schema, sync or async, cross-field
  rules (the date range's "ends before it starts"), coercion in the output. The app's parallel
  required machinery goes, and a rejected submit is a blocked submit (`submitted` stays false, the
  first invalid field is focused).
- SYG230 keeps its typo check: a name is a field only when `values` or `dynamic` has it.
- Matches RHF's resolver-with-context and TanStack's per-field validators in power, without
  per-field registration calls in views.

Costs and limits:

- Two functions of the host state; for a composed form both are derived from the layout
  (`formFields(layout)`, `formSchema(layout)` in the intake lab). One table per catalog part
  (`PIECES[part] = { start(params), rules(params) }`) keeps them together.
- The schema function must be memoized. An unmemoized one re-validates on every host state change
  (and an async one would never settle): SYG239 in dev (the form calls it twice with the same state
  and compares).
- Removing an entry drops its value (RHF's `shouldUnregister: true`). That is right for a composed
  form (the composition is the truth: a removed question's answer isn't sent). An app that wants
  values to survive a piece leaving and coming back keeps the entry in `dynamic` (the field set is
  the app's state, not the DOM's, so there is no transient unmount to guard against, unlike
  React's). If the field set is derived from a streaming preview that drops nodes mid-stream, the
  dropped fields lose their values: derive from `page.preview ?? page.layout` with compose's default
  `preview: 'merge'` (the previous layout's nodes stay in the preview), or from `page.layout` only.
- Dynamic paths name object keys, not array rows (rows have `form.ADD` / `form.REMOVE`).
- `check` (async per-field checks) is keyed by fixed names; a check on a dynamic name works when the
  name is predictable (`'contact.email'`); per-node checks are not covered (SYG235 is skipped when
  `dynamic` is set, since the name may be a dynamic one).

## What changed

- `src/extra/form.ts`: `dynamic` option and the `added` slice key (the entries on the form now);
  the internal `form.SYNC` action (from the host's STATE source: fired when `dynamic(state)` changes
  structurally or the schema function returns another schema; no state change when nothing moved
  and the schema answers the same); every step gets the host state before the action (STATE:
  `props.state`; outputs: `props.previousState`), so validation uses `schema(hostState)`; the
  result cache is per (schema, values); an async result for a schema the state no longer gives is
  dropped (a newer validation is running).
- `src/extra/behaviors.ts`: a behavior's intent gets the host's own STATE source as a 4th argument
  (`sources.STATE` is the slice's), so a behavior can follow the host's state.
- Diagnostics: SYG239 (new, warn) for an unmemoized schema function; SYG230's fix mentions
  `dynamic`; SYG231 also for a schema function that returns something that isn't a Standard
  Schema; SYG235 skipped with `dynamic`.
- Types: `FormOptions.dynamic`, `FormState.added`, a `form((state) => schema, options)` overload
  (output = the returned schema's), the behavior intent's `hostState` argument.
- sygnal-check: no rule reads form field names statically, so nothing changes there (its SYG127
  known-option list for behaviors isn't involved: `form()` is not a compose behavior).
- The intake lab: no `EMPTY` start values, no `requiredNames` / `missingNames` / `missing`, a
  repeatable `amount` piece (`maxUses: 3`), each piece's values under its node key, the "Fill in
  the N highlighted fields" line from the form's own errors after a submit.

## Not done (follow-ups)

- Per-node async checks (`check` keyed by a pattern or by a function of the name).
- A compose-side helper (e.g. the render part's props carrying a `field(name)` that prefixes the
  node key) was considered and not needed: `node` is enough, and compose stays unaware of forms.
