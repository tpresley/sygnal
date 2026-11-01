---
title: Compiled Views (experimental)
description: Let the Vite plugin compile JSX views at build time, for faster updates and faster server rendering
---

The [Vite plugin](/integration/bundler-config/) can compile your JSX views at build time. Your components stay as they are: the same view functions, the same intent and model. The plugin rewrites the JSX in them into code that does less work when it runs. The DOM is the same with or without it.

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal({ compile: true })],
})
```

`compile` is off by default and needs Vite 8; under an older Vite it warns once and compiles nothing. Files under `node_modules` are never compiled.

## Why views compile well

A Sygnal view is a function of `{ state, context, ...props }` that returns markup, and the markup carries no event handlers: events come from the [intent](/guide/intent/)'s selectors. So everything in a view's JSX is fixed except its `{expressions}`. The compiler uses that in three ways:

- **Elements** (`views`): an HTML element becomes a direct call that makes the same vnode the JSX runtime makes. An element whose attributes are all literals has its data made once, when the module loads, instead of on every render.
- **Server rendering** (`ssr`): in server builds, compiled elements render straight to HTML strings inside [`renderToString`](/integration/ssr/), with no vnode per element.
- **Blocks** (`blocks`): a row made by `.map()` and the element a component returns become a *block*. The block's markup is cloned from a template, and afterwards only its dynamic parts (text, the attributes that use an expression) are written. The diff never walks inside it.

## Options

`compile: true` turns on every part. An object turns parts off; each one you leave out is on:

```javascript
// vite.config.js
sygnal({ compile: { blocks: false } })   // elements and server rendering, no blocks
```

| Option | Default | What it compiles |
|---|---|---|
| `views` | `true` | HTML elements in client code: direct vnode calls, static data made once |
| `ssr` | `true` | Server builds: compiled elements render to HTML strings. Never under Vitest |
| `blocks` | `true` | Client code: `.map()` rows and component root elements as blocks |
| `test` | `true` | Also compile under Vitest (elements and blocks), so tests run what ships. `false` leaves test files as they are |

## What it compiles, and what it leaves alone

The compiler only takes plain HTML elements. Everything else stays a JSX call, handled exactly as without `compile`; the compilable elements inside it are still compiled:

- components, and the special components (`Collection`, `Switchable`, `Portal`, `Slot`, `Transition`, `Suspense`, `ClientOnly`), controls and widgets;
- fragments;
- form fields (`input`, `textarea`, `select`, `option`) and custom elements (a tag with a hyphen), because Sygnal re-syncs their values on every render;
- SVG and MathML tags, and any other tag that isn't an HTML element (a renderer's own tags);
- an element with a spread (`{...props}`), a `ref`, `autoFocus`, `autoSelect`, a `hook`, or an HTML entity in its text (`&amp;`).

A block is only made from a subtree that is compiled all the way down, has at least two elements, and whose `{expressions}` hold text: an expression with JSX in it, `children` or `slots` keeps the subtree as plain vnodes. If a text expression turns out to hold markup when the view runs (an array, a vnode), that render uses plain vnodes instead of the block.

## What stays the same

- **The vnodes**: anything that reads vnodes gets the same vnodes as without `compile`. That covers the dev checks, the DevTools, [`renderComponent`](/integration/testing/) (mock DOM or `dom: 'real'`), a custom DOM driver, and `renderToString` run on client code. Blocks are handed over as their plain vnodes, each with its `elm`.
- **The DOM**: a block makes the same elements, attributes and text as the vnodes would.
- **The HTML**: compiled server rendering writes the same HTML, byte for byte, as `renderToString` of the uncompiled view, including `uid()` values and hydration ids.
- **Hydration**: a block adopts the server's markup when it matches (it keeps the server's elements and text nodes) and makes its inside again when it doesn't.
- **Size**: an app built without `compile` doesn't change. With it, the bundle gains the compiled runtime (a few hundred bytes for elements, more with blocks) and loses the JSX calls it replaced.

The parity checks behind these: about 55 test views compared vnode for vnode and HTML byte for byte; every `.jsx` / `.tsx` file in the Sygnal repository compiled; each example app's own test suite run with `compile: true`; and the benchmark tables checked in Chromium for the same DOM, and the same number of DOM mutations, after every step.

## What it buys

Measured on the [benchmark](https://github.com/tpresley/sygnal/tree/main/benchmarks) table (1,000 rows) in Chromium. These are medians on a shared machine, so read them as directions, not exact values:

| Operation | JSX | `compile: true` | React 19 |
|---|---:|---:|---:|
| select a row | 1.9 ms | 1.05 ms | 0.9 ms |
| remove a row | 2.95 ms | 2.1 ms | 1.95 ms |
| clear 1,000 rows | 3.9 ms | 2.95 ms | 4.15 ms |
| heap for 1,000 rows | 0.89 MB | 0.62 MB | 1.36 MB |
| server render, 1,000 rows | 1.78 ms | 0.38 ms | |
| server render, 10,000 rows | 23.7 ms | 4.3 ms | |

Creating rows isn't faster: about half of that time is the browser's layout, which compiling doesn't change. In a Collection (one component per row) the gain is smaller (select 1.8 → 1.4 ms), because each row's component instance costs more than its view.

## Limits

- **Experimental.** The option may change before it is on by default.
- **Vite 8 only**, and only files Vite transforms (not prebuilt libraries).
- **Source maps** map each compiled JSX expression to its start; a stack trace inside compiled markup points at the element, not the attribute.
- If a view behaves differently compiled, turn the part off (`compile: { blocks: false }`, then `{ views: false }`) and [open an issue](https://github.com/tpresley/sygnal/issues) with the view.
