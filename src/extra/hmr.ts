interface ModuleWithDefault {
  default: (...args: any[]) => any;
}

interface HotModule {
  accept: (...args: any[]) => void;
  dispose?: (cb: () => void) => void;
}

interface SygnalApp {
  hmr: (next: any, state?: any) => void;
  dispose?: () => void;
  sources?: {STATE?: {stream?: {_v?: any}}};
}

function normalizeModule(maybeModule: any): ModuleWithDefault | null {
  if (!maybeModule) return null;
  const candidate = maybeModule.default || maybeModule;
  if (typeof candidate !== 'function') return null;
  return maybeModule.default ? maybeModule : {default: candidate};
}

export default function enableHMR(
  app: SygnalApp,
  hot: HotModule,
  loadComponent?: () => Promise<any>,
  acceptDependencies?: string | string[]
): SygnalApp {
  if (!app || typeof app.hmr !== 'function') return app;
  if (!hot || typeof hot.accept !== 'function') return app;

  let applying = false;

  const apply = async (acceptedModules: any) => {
    if (applying) return;
    applying = true;
    const incoming = Array.isArray(acceptedModules)
      ? acceptedModules.find(Boolean)
      : acceptedModules;
    try {
      let next = normalizeModule(incoming);
      if (!next && typeof loadComponent === 'function') {
        const loaded = await loadComponent();
        next = normalizeModule(loaded);
      }
      if (next) {
        const explicitState = app?.sources?.STATE?.stream?._v;
        app.hmr(next, explicitState);
      }
    } finally {
      applying = false;
    }
  };

  const invoke = (modules: any) => {
    Promise.resolve(apply(modules)).catch(() => {});
  };

  if (typeof acceptDependencies !== 'undefined') {
    hot.accept(acceptDependencies, invoke);
  }
  // Fallback boundary for bundlers/environments where dependency accept is not triggered as expected.
  hot.accept(invoke);

  if (typeof hot.dispose === 'function' && typeof app.dispose === 'function') {
    hot.dispose(() => app.dispose!());
  }

  return app;
}
