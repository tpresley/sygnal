import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import remarkLive from './src/plugins/remark-live.mjs'

// Astro's content layer keeps rendered pages until a page or the config changes: the live
// examples' build code goes into the config as the plugin's option, so a change to it renders
// every page again
const liveBuild = createHash('sha256')
for (const f of ['src/plugins/remark-live.mjs', 'src/live/compile.mjs', 'src/live/paths.mjs', 'src/live/modules.ts']) {
  liveBuild.update(fs.readFileSync(new URL(f, import.meta.url)))
}

export default defineConfig({
  site: 'https://sygnal.js.org',
  base: '/',
  redirects: {
    '/advanced/model-shorthand': '/advanced/alternative-forms/',
  },
  // live examples: a ```jsx live fence gets a Result panel (see src/plugins/remark-live.mjs)
  markdown: {
    remarkPlugins: [[remarkLive, { build: liveBuild.digest('hex').slice(0, 16) }]],
  },
  vite: {
    resolve: {
      // sygnal is linked (file:..), so its own imports of these would resolve from the repo root:
      // one copy each, the docs' (a Zag machine and the sygnal/zag runtime must match, as React must)
      dedupe: ['@zag-js/vanilla', '@zag-js/menu', '@zag-js/select', '@zag-js/combobox', 'react', 'react-dom'],
    },
  },
  integrations: [
    starlight({
      title: 'Sygnal',
      logo: {
        dark: './src/assets/sygnal-logo-light.svg',
        light: './src/assets/sygnal-logo.svg',
        alt: 'Sygnal',
        replacesTitle: true,
      },
      description: 'An intuitive reactive component framework built on Cycle.js patterns',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/tpresley/sygnal' },
      ],
      editLink: {
        baseUrl: 'https://github.com/tpresley/sygnal/edit/main/docs/',
      },
      customCss: ['./src/styles/custom.css'],
      components: {
        MarkdownContent: './src/components/MarkdownContent.astro',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'index' },
            { label: 'Quick Start', slug: 'getting-started' },
            { label: 'Try It', link: '/try-it/' },
          ],
        },
        {
          label: 'Guide',
          items: [
            { label: 'Architecture', slug: 'guide/architecture' },
            { label: 'Components', slug: 'guide/components' },
            { label: 'Intent', slug: 'guide/intent' },
            { label: 'Model', slug: 'guide/model' },
            { label: 'State Management', slug: 'guide/state' },
            { label: 'Persistence', slug: 'guide/persistence' },
            { label: 'Streams', slug: 'guide/streams' },
            { label: 'Drivers', slug: 'guide/drivers' },
            { label: 'HTTP', slug: 'guide/http' },
            { label: 'Resources and Caching', slug: 'guide/resources' },
            { label: 'Sockets', slug: 'guide/sockets' },
            { label: 'Timers', slug: 'guide/timers' },
            { label: 'Browser Sources', slug: 'guide/browser-sources' },
            { label: 'Router', slug: 'guide/router' },
            { label: 'Document Head', slug: 'guide/head' },
            { label: 'Custom Drivers', slug: 'guide/custom-drivers' },
            { label: 'AI Chat', slug: 'guide/ai-chat' },
            { label: 'AI Decisions', slug: 'guide/ai-decisions' },
            { label: 'Collections', slug: 'guide/collections' },
            { label: 'Virtual Collections', slug: 'guide/virtual-collections' },
            { label: 'Behaviors', slug: 'guide/behaviors' },
            { label: 'Switchable', slug: 'guide/switchable' },
            { label: 'Context', slug: 'guide/context' },
            { label: 'Parent-Child Communication', slug: 'guide/parent-child' },
            { label: 'Calculated Fields', slug: 'guide/calculated-fields' },
            { label: 'Forms', slug: 'guide/forms' },
            { label: 'Forms Reference', slug: 'guide/forms-reference' },
            { label: 'Inputs, Labels and Focus', slug: 'guide/inputs' },
            { label: 'Element Commands', slug: 'guide/element-commands' },
            { label: 'Controls', slug: 'guide/controls' },
            { label: 'Widgets', slug: 'guide/widgets' },
            { label: 'Web Components', slug: 'guide/web-components' },
            { label: 'Adapters', slug: 'guide/adapters' },
            { label: 'Accessibility', slug: 'guide/accessibility' },
            { label: 'Drag and Drop', slug: 'guide/drag-and-drop' },
            { label: 'View Transitions', slug: 'guide/view-transitions' },
            { label: 'Diagnostics', slug: 'guide/diagnostics' },
            { label: 'Strict Mode', slug: 'guide/strict-mode' },
            { label: 'Migrating to 6.0', slug: 'guide/migrating-to-6' },
          ],
        },
        {
          label: 'UI Parts',
          items: [
            { label: 'Overview', slug: 'ui/overview' },
            { label: 'Dialog', slug: 'ui/dialog' },
            { label: 'Popover', slug: 'ui/popover' },
            { label: 'Tooltip', slug: 'ui/tooltip' },
            { label: 'Tabs', slug: 'ui/tabs' },
            { label: 'Accordion', slug: 'ui/accordion' },
            { label: 'Disclosure', slug: 'ui/disclosure' },
            { label: 'Toaster', slug: 'ui/toaster' },
            { label: 'Menu', slug: 'ui/menu' },
            { label: 'Select', slug: 'ui/select' },
            { label: 'Combobox', slug: 'ui/combobox' },
          ],
        },
        {
          label: 'Recipes',
          items: [
            { label: 'Overview', slug: 'recipes/overview' },
            { label: 'Charts', slug: 'recipes/charts' },
            { label: 'Rich Text', slug: 'recipes/rich-text' },
            { label: 'Code Editor', slug: 'recipes/code-editor' },
            { label: 'Carousel', slug: 'recipes/carousel' },
            { label: 'Data Table', slug: 'recipes/data-table' },
            { label: 'Data Grid', slug: 'recipes/data-grid' },
            { label: 'Icons', slug: 'recipes/icons' },
            { label: 'Translations (i18n)', slug: 'recipes/i18n' },
            { label: 'AI: Support Inbox', slug: 'recipes/ai-support-inbox' },
            { label: 'AI: Structured Output into a Form', slug: 'recipes/ai-form-fill' },
            { label: 'AI: On-device Summaries', slug: 'recipes/ai-summarize' },
          ],
        },
        {
          label: 'Advanced',
          items: [
            { label: 'Error Boundaries', slug: 'advanced/error-boundaries' },
            { label: 'Refs', slug: 'advanced/refs' },
            { label: 'Portals', slug: 'advanced/portals' },
            { label: 'Transitions', slug: 'advanced/transitions' },
            { label: 'Slots', slug: 'advanced/slots' },
            { label: 'Lazy Loading', slug: 'advanced/lazy-loading' },
            { label: 'Suspense', slug: 'advanced/suspense' },
            { label: 'Commands', slug: 'advanced/commands' },
            { label: 'Effect Handlers', slug: 'advanced/effect' },
            { label: 'Undo and Redo', slug: 'advanced/undo' },
            { label: 'Disposal Hooks', slug: 'advanced/disposal' },
            { label: 'Alternative Forms', slug: 'advanced/alternative-forms' },
          ],
        },
        {
          label: 'Integration',
          items: [
            { label: 'TypeScript', slug: 'integration/typescript' },
            { label: 'Testing', slug: 'integration/testing' },
            { label: 'Server-Side Rendering', slug: 'integration/ssr' },
            { label: 'Astro', slug: 'integration/astro' },
            { label: 'Vike', slug: 'integration/vike' },
            { label: 'Server Functions', slug: 'integration/server-functions' },
            { label: 'Hot Module Replacement', slug: 'integration/hmr' },
            { label: 'PWA Helpers', slug: 'integration/pwa' },
            { label: 'Bundler Configuration', slug: 'integration/bundler-config' },
            { label: 'Debugging', slug: 'integration/debugging' },
            { label: 'Building with AI Agents', slug: 'integration/agents' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'API Reference', slug: 'reference/api' },
            { label: 'Utilities', slug: 'reference/utilities' },
            { label: 'Types', slug: 'reference/types' },
            { label: 'Error Reference', slug: 'reference/errors' },
          ],
        },
      ],
    }),
  ],
})
