const SYGNAL_RENDERER_NAME = '@sygnal/astro'

export default function sygnalAstroIntegration() {
  return {
    name: SYGNAL_RENDERER_NAME,
    hooks: {
      'astro:config:setup': ({ addRenderer, updateConfig }) => {
        addRenderer({
          name: SYGNAL_RENDERER_NAME,
          clientEntrypoint: 'sygnal/astro/client',
          serverEntrypoint: 'sygnal/astro/server',
        })

        updateConfig({
          vite: {
            esbuild: {
              jsxFactory: 'jsx',
              jsxInject: `import { jsx } from 'sygnal/jsx'`,
            },
          },
        })
      },
    },
  }
}
