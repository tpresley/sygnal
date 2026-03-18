const SYGNAL_RENDERER_NAME = '@sygnal/astro'

interface AstroRenderer {
  name: string;
  clientEntrypoint: string;
  serverEntrypoint: string;
}

interface AstroConfigSetupArgs {
  addRenderer: (renderer: AstroRenderer) => void;
  updateConfig: (config: any) => void;
}

export default function sygnalAstroIntegration() {
  return {
    name: SYGNAL_RENDERER_NAME,
    hooks: {
      'astro:config:setup': ({ addRenderer, updateConfig }: AstroConfigSetupArgs) => {
        addRenderer({
          name: SYGNAL_RENDERER_NAME,
          clientEntrypoint: 'sygnal/astro/client',
          serverEntrypoint: 'sygnal/astro/server',
        })

        updateConfig({
          vite: {
            esbuild: {
              jsx: 'automatic',
              jsxImportSource: 'sygnal',
            },
          },
        })
      },
    },
  }
}
