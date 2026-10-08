// The modules a live example can import. Each entry is a dynamic import, so Vite bundles each
// library as its own lazy chunk and a page loads only what its examples import (the runtime
// scans a demo's imports before running it).
//
// To add a library: add it to docs/package.json (a fixed range, as tested), then add its
// specifier here, one entry per subpath the docs import ('echarts/core', 'chart.js/auto').
// A stylesheet ('flatpickr/dist/flatpickr.css') goes through `css(import('...?url'))`: a plain
// import() of CSS would make Astro add it to every page's stylesheets.
const css = (url: Promise<{ default: string }>) => url.then(({ default: href }) => {
  if (!document.querySelector(`link[data-sygnal-live][href="${href}"]`)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.sygnalLive = ''
    document.head.append(link)
  }
  return {}
})

export const MODULES: Record<string, () => Promise<any>> = {
  // Sygnal
  'sygnal': () => import('sygnal'),
  'sygnal/jsx-runtime': () => import('sygnal/jsx-runtime'),
  'sygnal/jsx': () => import('sygnal/jsx'),
  'sygnal/ui': () => import('sygnal/ui'),
  'sygnal/ui/menu': () => import('sygnal/ui/menu'),
  'sygnal/ui/select': () => import('sygnal/ui/select'),
  'sygnal/ui/combobox': () => import('sygnal/ui/combobox'),
  'sygnal/zag': () => import('sygnal/zag'),
  'sygnal/react': () => import('sygnal/react'),
  'sygnal/element': () => import('sygnal/element'),

  // Recipes (versions: dev-plans/research/p5-recipes/package.json)
  'chart.js': () => import('chart.js'),
  'chart.js/auto': () => import('chart.js/auto'),
  'echarts/core': () => import('echarts/core'),
  'echarts/charts': () => import('echarts/charts'),
  'echarts/components': () => import('echarts/components'),
  'echarts/renderers': () => import('echarts/renderers'),
  '@tiptap/core': () => import('@tiptap/core'),
  '@tiptap/starter-kit': () => import('@tiptap/starter-kit'),
  'codemirror': () => import('codemirror'),
  '@codemirror/state': () => import('@codemirror/state'),
  '@codemirror/view': () => import('@codemirror/view'),
  '@codemirror/lang-javascript': () => import('@codemirror/lang-javascript'),
  'embla-carousel': () => import('embla-carousel'),
  '@tanstack/table-core': () => import('@tanstack/table-core'),
  '@tanstack/table-core/store-reactivity-bindings': () => import('@tanstack/table-core/store-reactivity-bindings'),
  'ag-grid-community': () => import('ag-grid-community'),
  'lucide': () => import('lucide'),
  'i18next': () => import('i18next'),

  // UI parts, widgets, adapters, web components
  '@zag-js/menu': () => import('@zag-js/menu'),
  '@zag-js/select': () => import('@zag-js/select'),
  '@zag-js/combobox': () => import('@zag-js/combobox'),
  '@zag-js/vanilla': () => import('@zag-js/vanilla'),
  '@floating-ui/dom': () => import('@floating-ui/dom'),
  'flatpickr': () => import('flatpickr'),
  'flatpickr/dist/flatpickr.css': () => css(import('flatpickr/dist/flatpickr.css?url')),
  'react': () => import('react'),
  'react-dom': () => import('react-dom'),
  'react-dom/client': () => import('react-dom/client'),
  '@awesome.me/webawesome/dist/styles/themes/default.css': () => css(import('@awesome.me/webawesome/dist/styles/themes/default.css?url')),
  '@awesome.me/webawesome/dist/components/rating/rating.js': () => import('@awesome.me/webawesome/dist/components/rating/rating.js'),
  '@awesome.me/webawesome/dist/components/input/input.js': () => import('@awesome.me/webawesome/dist/components/input/input.js'),

  // Other guide pages
  'zod': () => import('zod'),
  'immer': () => import('immer'),
  'motion': () => import('motion'),
  '@formkit/auto-animate': () => import('@formkit/auto-animate'),
}
