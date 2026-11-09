// The app's root context as a registry: no `context` in a
// component's spec, and no per-component interface repeating the root's fields.
import { type Comp, type ContextOf, type IntentSources, type ModelActions, type ModelFor, type RootComp, type Route } from 'sygnal'

const rootContext = {
  route: (state: { route: Route }) => state.route,
  csrf: (state: { csrf: string | null }): string | null => state.csrf,
}

declare module 'sygnal' {
  interface SygnalContext extends ContextOf<typeof rootContext> {}
}

// the view, and every model reducer, read the registry's fields
const Reader: Comp<{ state: { n: number } }> = ({ state, context }) => {
  const csrf: string | null = context.csrf
  const route: Route = context.route
  // @ts-expect-error — not in the registry
  context.nope
  // @ts-expect-error — string | null
  const wrong: number = context.csrf
  return <div>{state.n}{csrf}{route.name}{wrong}</div>
}
void Reader

type Spec = { state: { n: number } }
const model = {
  SAVE: { HTTP: (_s, _d, _n, { context }) => (context.csrf ? '/x' : false) },
} satisfies ModelFor<Spec>
const WithModel: Comp<Spec & { actions: ModelActions<typeof model> }> = ({ context }) => <div>{context.route.name}</div>
WithModel.model = model

// a subtree's own context is added to the registry's
const Sub: Comp<{ state: { n: number }; context: { extra: number } }> = ({ context }) => <div>{context.extra}{context.csrf}</div>
void Sub

// the root may be required to provide the whole registry: it names `provided`
const Root: RootComp<{ state: { route: Route; csrf: string | null }; provided: ContextOf<typeof rootContext> }> = ({ state }) => <div>{state.csrf}</div>
Root.context = rootContext
void (null as unknown as IntentSources)
