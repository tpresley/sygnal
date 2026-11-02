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
