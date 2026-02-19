declare type SygnalAstroIntegration = {
  name: string;
  hooks: {
    'astro:config:setup': (args: {
      addRenderer: (renderer: {
        name: string;
        clientEntrypoint: string;
        serverEntrypoint: string;
      }) => void;
      updateConfig: (config: any) => void;
    }) => void;
  };
};

export default function sygnalAstroIntegration(): SygnalAstroIntegration;
