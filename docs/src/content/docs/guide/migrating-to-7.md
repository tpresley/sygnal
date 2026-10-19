---
title: Migrating to 7.0
description: Updated-state output sinks by default, explicit library contracts, and migration from Sygnal 6
---

**Sygnal 7 changes the state seen by output sinks.** In 6.x, every reducer received the state
from before the action. In 7.x, STATE runs first and output sinks receive its committed result,
including calculated fields. `run(App)` and `renderComponent(App)` both use this default.

This applies to EFFECT, HTTP, EVENTS, PARENT, ELEMENT and other output sinks. Their relative
order is preserved. Effects remain synchronous within the action; the DOM patch follows it.
An aborted or failed STATE transition leaves state unchanged and does not cancel other sinks.

## Audit output reducers

An output that already computes the update must stop applying it a second time:

```js
// 6.x: outputs received the old count.
Counter.model = {
  INC: {
    STATE: state => ({ ...state, count: state.count + 1 }),
    PARENT: state => ({ count: state.count + 1 }),
  },
}
```

```js
// 7.x: STATE has already incremented count.
Counter.model = {
  INC: {
    STATE: state => ({ ...state, count: state.count + 1 }),
    PARENT: state => ({ count: state.count }),
  },
}
```

Audit requests that append a message, increment a request ID or construct a record alongside
STATE. Read the resulting value directly. When STATE clears an input or removes a record, use
`previousState` for the old value:

```js
Editor.model = {
  SAVE: {
    STATE: state => ({ ...state, draft: '' }),
    HTTP: (state, data, next, { previousState }) => ({
      url: '/api/draft', method: 'POST', body: previousState.draft, ok: 'SAVED',
    }),
  },
}
```

`props.state` matches the reducer's selected snapshot. `props.previousState` is always the
pre-action component state. Behavior reducers receive their slice as the first argument;
their props contain the host's state and previousState.

### Preserve loading and admission guards

A guard that decides whether an action may start must read the pre-action state. Repeating
`state.status !== 'working'` in both STATE and HTTP now blocks the first request: STATE has
already set `status` to `'working'` when HTTP runs. Keep the output guard, but use
`previousState` for admission:

```js
Worker.model = {
  START: {
    STATE: state => state.status !== 'working'
      ? { ...state, status: 'working' }
      : ABORT,
    HTTP: (state, data, next, { previousState }) => previousState.status !== 'working'
      ? { url: '/work', ok: 'DONE' }
      : ABORT,
  },
  DONE: state => ({ ...state, status: 'idle' }),
}
```

The first START sends a request; repeated START actions while working send none. Removing
the HTTP guard would allow duplicate requests because STATE returning `ABORT` does **not**
cancel other sinks. Use the updated `state` for request fields written by STATE, and
`previousState` for checks that admitted the action. The same distinction applies to loading
booleans, toggle guards, and other output sinks. With an explicit `before` contract, the first
argument already holds the pre-action snapshot.

[SYG256](/reference/errors#syg256) warns when sygnal-check can prove that a same-action literal
STATE field write makes a simple output guard return imported `ABORT`. It requires an installed
Sygnal 7 or later and a known `after` context. It skips explicit `before` timing, unknown versions
or timing, complex or composed writes, and guards it cannot prove. The warning has no automatic
fix: preserve the guard and choose its admission snapshot deliberately. Zero warnings do not
replace auditing these guards during migration.

## Migrate incrementally

On Sygnal 7, restore the old app default while auditing components:

```js
run(App, drivers, { sinkState: 'before' })
// Use the same mode in tests.
renderComponent(App, { sinkState: 'before' })
```

A component can declare `Editor.sinkState = 'before'` or `'after'`. Its declaration wins over
the app default and applies only to that component; children independently inherit the app
default. A behavior can declare `defineBehavior({ sinkState: 'before', ... })`, preserving its
contract in any host. Built-in behaviors explicitly retain the pre-action snapshots their
transitions require. Audit undeclared third-party components and behaviors when upgrading.

When an action contains both before and after contributors, the composed STATE transition
runs first, then outputs retain their relative order and receive their own declared snapshots.
In this case, `before` promises the old snapshot, not execution before STATE. Grouped EFFECT
handlers retain their order and shared exception boundary. Actions whose outputs all use before
retain their legacy model order. Code that used an effect to prepare a subsequent STATE reducer
should move that work into the state transition instead.

The `sinkState` option and `previousState` are 7.x APIs. They are not compatibility shims that
can be passed to the published 6.x runtime. sygnal-check resolves the installed Sygnal version
from each source's package context, including workspace packages, and checks the supported
contract. Upgrade runtime and tooling together; an unresolved version does not establish which
default is active.

## Changed binding targets start new lifetimes

Sygnal 6 retained a child's original state binding until its key changed. In 7, changing a
known path or `byId(field, id, idKey)` target automatically disposes the old instance and
mounts the new selection. This applies to ordinary child `state`, Collection/VirtualCollection
`from`, and Switchable `state`. Old requests, delayed actions, subscriptions and descendants
are disposed; initialization runs again and local component state resets. Collection items
and Switchable pages with IDs shared across targets do not carry work into the new entity.

You can remove a key used solely to work around `byId()` selection:

```jsx
// 6.x required key={selected.id}; 7.x follows this target automatically.
<Workspace state={byId('projects', selected.id)} />
```

The `sinkState: 'before'` migration option changes reducer snapshots only; these binding
lifetime rules still apply. Keep state that must survive selection in the parent/app state.

Keep explicit keys when they intentionally reset an unchanged target, or when a changing
custom lens needs a new lifetime. Fresh equivalent byId helpers preserve instances. Normal
record updates and reordering within a target do not remount it. A stable explicit key does
not override a known target change. A missing target produces no stale entity content.
Deleting an existing selected record without changing its byId arguments also disposes that
entity’s old lifetime. A fresh missing-state lifetime can initialize/fetch data; isolated defaults
and path seeding still follow the normal creation rules. Reinserting the same ID cannot revive
old pending work.

Deletion ends the old known lifetime after the deleting action's outputs finish, before later
queued work from that subtree can run. This includes deletion and same-ID reinsertion between
renders, hidden descendants, and whole Collection/VirtualCollection source targets. Cleanup
receives the last owned state and cannot write a deleted target back into the parent.

Hidden page views remain paused. An ordinary replacement child mounts when its owner next
reconciles (normally when shown), then follows normal initialization and default/seeding rules.

Arbitrary custom lenses remain opaque: recreating a closure does not establish that its target
changed, so they retain their mount-time binding. Use a key tied to their selected entity, and conditionally remove the child when that entity
disappears (or include availability in its key).
See [state lifetimes](/guide/state/#changing-the-selected-record) for details.

## Other additions

Scaffolding into a directory containing only `.git` and/or `.DS_Store` now preserves that
metadata, and `.` gets a package name from the resolved directory. Other nonempty destinations
remain rejected. TypeScript tests can use `t.query<HTMLInputElement>(selector)` and
`t.queryAll<HTMLInputElement>(selector)`; these type arguments assert an element type and do
not validate it at runtime. Typed control tokens continue to infer their element types.
