---
title: Recipes
description: Using popular JavaScript libraries (charts, editors, carousels, tables, grids, icons, translations) with Sygnal
---

Most JavaScript UI libraries don't need a Sygnal version. A library that builds its UI inside an element you give it becomes a JSX tag with [`defineWidget`](/guide/widgets/); a library that only computes (a table model, a translation) is called from the view or the context, as a pure function of state. Each recipe shows the code, how to test it, what it adds to the bundle, and the mistakes to avoid.

| Recipe | Library | How |
|---|---|---|
| [Charts](/recipes/charts/) | Chart.js, ECharts | Widget |
| [Rich text](/recipes/rich-text/) | Tiptap | Widget, toolbar as element commands |
| [Code editor](/recipes/code-editor/) | CodeMirror 6 | Widget, `focus` command |
| [Carousel](/recipes/carousel/) | Embla Carousel | Widget, previous/next as element commands |
| [Data table](/recipes/data-table/) | TanStack Table v9 | A pure function of state in the view |
| [Data grid](/recipes/data-grid/) | AG Grid Community | Widget, immutable row data |
| [Icons](/recipes/icons/) | Lucide | A helper that returns Sygnal SVG vnodes |
| [Translations (i18n)](/recipes/i18n/) | i18next | `t()` in `.context`, the locale saved with `persist()` |

Elsewhere in the docs:

- **Positioning** (tooltips, popovers, menus) with Floating UI: [Floating UI for older browsers](/ui/overview/#floating-ui-for-older-browsers). Current browsers position `sygnal/ui` parts with CSS anchor positioning and need no library.
- **List animations** with AutoAnimate and Motion: [View Transitions](/guide/view-transitions/#recipe-autoanimate).
- **Date pickers** (flatpickr): the [Widgets](/guide/widgets/) guide's example.
- **Web components** (Web Awesome, Shoelace): no wrapper needed, see [Web components](/guide/web-components/).
- **Forms with validation** (zod, valibot): the [`form` behavior](/guide/forms/).

## Choosing a pattern

- **The library owns some DOM** (a canvas, an editor, a slider): `defineWidget`. Sygnal renders the host element and never touches what the library builds inside it. Props flow in through `update`, events flow out through `dispatch` and the intent, and the model calls the library's methods through the widget's `commands`.
- **The library only computes** (rows to show, a translated string, an icon's shape): call it in the view or in `.context`, and render the result with JSX. Sygnal keeps rendering the DOM, so the output is ordinary markup: it is server-rendered, tested in the mock DOM, and checked by sygnal-check.
- **The library is a framework component** (React, Vue): see [Adapters](/guide/adapters/), and look for a framework-agnostic core first (most headless libraries have one).

## Size numbers

Each recipe gives what it adds to an app, measured with Vite (minified, gzipped), Sygnal itself not included. `defineWidget` adds about 1.1 KB the first time an app uses it.
