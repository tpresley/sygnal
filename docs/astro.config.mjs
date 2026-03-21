import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  site: 'https://sygnal.js.org',
  base: '/',
  integrations: [
    starlight({
      title: 'Sygnal',
      logo: {
        dark: './src/assets/sygnal-logo-light.svg',
        light: './src/assets/sygnal-logo.svg',
        alt: 'Sygnal',
      },
      description: 'An intuitive reactive component framework built on Cycle.js patterns',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/tpresley/sygnal' },
      ],
      editLink: {
        baseUrl: 'https://github.com/tpresley/sygnal/edit/main/docs/',
      },
      customCss: ['./src/styles/custom.css'],
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
            { label: 'Streams', slug: 'guide/streams' },
            { label: 'Drivers', slug: 'guide/drivers' },
            { label: 'Collections', slug: 'guide/collections' },
            { label: 'Switchable', slug: 'guide/switchable' },
            { label: 'Context', slug: 'guide/context' },
            { label: 'Parent-Child Communication', slug: 'guide/parent-child' },
            { label: 'Calculated Fields', slug: 'guide/calculated-fields' },
            { label: 'Peer Components', slug: 'guide/peer-components' },
            { label: 'Forms & Focus', slug: 'guide/forms' },
            { label: 'Drag and Drop', slug: 'guide/drag-and-drop' },
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
            { label: 'Model Shorthand', slug: 'advanced/model-shorthand' },
            { label: 'Disposal Hooks', slug: 'advanced/disposal' },
          ],
        },
        {
          label: 'Integration',
          items: [
            { label: 'TypeScript', slug: 'integration/typescript' },
            { label: 'Testing', slug: 'integration/testing' },
            { label: 'Server-Side Rendering', slug: 'integration/ssr' },
            { label: 'Astro', slug: 'integration/astro' },
            { label: 'Hot Module Replacement', slug: 'integration/hmr' },
            { label: 'Bundler Configuration', slug: 'integration/bundler-config' },
            { label: 'Debugging', slug: 'integration/debugging' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'API Reference', slug: 'reference/api' },
            { label: 'Utilities', slug: 'reference/utilities' },
            { label: 'Types', slug: 'reference/types' },
          ],
        },
      ],
    }),
  ],
})
