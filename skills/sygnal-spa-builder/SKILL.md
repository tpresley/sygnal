---
name: sygnal-spa-builder
description: Build, refactor, and debug single-page applications using the Sygnal framework (Cycle.js-based functional reactive components). Use when implementing or modifying Sygnal component trees, `.intent` and `.model` behavior, app-level state flow, driver integration, switchable view changes, collection-based lists, or `run()` app bootstrapping.
---

# Sygnal SPA Builder

Build Sygnal SPAs by enforcing pure components, state-driven rendering, and explicit driver-side effects.

## Workflow

1. Identify the target operation.
- New SPA scaffold
- New feature in an existing SPA
- Behavior fix in `.intent`, `.model`, state mapping, or a driver

2. Model app state first.
- Define root-level state shape on `RootComponent.initialState`.
- Reserve `props` for configuration, not runtime app behavior.
- Keep navigation and UI state in the shared state tree.

3. Implement components in Sygnal form.
- Keep view function pure: `function Component({ state, props, children, context }) { ... }`.
- Put event triggers in `.intent` (Observable sources from drivers).
- Put effects/reducers in `.model` keyed by action names.
- Return reducer functions for state updates directly for `STATE` shorthand.

4. Choose subcomponent state mapping.
- By default, subcomponents share the parent/root state and can update it directly through their own `.model` reducers.
- Use `state="fieldName"` for simple subtree mapping.
- Use a state lens `{ get, set }` for custom parent-child mapping.
- Use `<collection>` for array-driven repeated components.
- Use `<switchable>` for view switching based on state (route-like behavior).

5. Wire drivers and boot app.
- Start app with `run(RootComponent, drivers, options)`.
- Keep side effects in drivers, not in component view functions.
- Use `mountPoint` in run options when not mounting to `#root`.

6. Validate behavior changes.
- Confirm intent stream triggers only on expected source events.
- Confirm model outputs update only intended state branches.
- Confirm no direct side effects in view or reducer code.

## Default Patterns

Use these conventions unless the user asks otherwise.

- Routing pattern: maintain `state.route`, render page with `<switchable ... current={state.route} />`, change route via model reducer.
- Data fetch pattern: emit action in `.intent`, send command to an API/custom driver in `.model`, reduce result back into state.
- Form pattern: keep form fields in state, update with reducer actions, derive validation via calculated fields or pure helpers.
- Composition pattern: keep components small and stateless except for mapped state subtree.
- Parent/child action flow pattern: do not relay basic form events through `PARENT/CHILD` when shared state is sufficient; put `.intent` and `.model` on the local subcomponent and update shared state directly.

## Guardrails

- Never mutate incoming `state`; always return new values/objects.
- Never access browser/network/storage directly in component views.
- Never dispatch DOM sink actions directly from `.model`; drive DOM through state and view output.
- Prefer explicit action names (`LOAD_USERS`, `SET_ROUTE`, `SAVE_FORM_SUCCESS`) over generic names.

## References

- Load `references/sygnal-spa-patterns.md` when implementing or refactoring concrete SPA features. It includes starter scaffolds for root app setup, route switching, list rendering, and driver interaction.
