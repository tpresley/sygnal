/**
 * Type tests for 4B (G-062): a `lazy()` component is used in JSX like any other
 * sub-component, with no `state` prop required.
 */
import type { Component } from 'sygnal'
import { lazy, Suspense } from 'sygnal'

type ChartProps = { title: string; points?: number[] }

// Default-export module shape (what `() => import('./Chart')` resolves to)
const Chart = lazy<ChartProps>(() => Promise.resolve({ default: ((({ title }) => <h2>{title}</h2>) as Component<any, ChartProps>) }))

// Untyped props, component-returning loader
const Settings = lazy(() => Promise.resolve((() => <section />) as Component))

// Props inferred from the loaded component
const Inferred = lazy(() => Promise.resolve({ default: (({ title }: { title: string }) => <h3>{title}</h3>) as Component<any, { title: string }> }))

const Page: Component = () => (
  <div>
    <Suspense fallback={<p>Loading…</p>}>
      <Chart title="Sales" />
      <Chart title="Sales" points={[1, 2]} />
      <Settings />
      <Settings anything="goes" />
      <Inferred title="x" />
    </Suspense>
  </div>
)
void Page

// Declared props are still checked
// @ts-expect-error title is required
const missingTitle = <Chart />
void missingTitle

// @ts-expect-error title must be a string
const wrongTitle = <Chart title={1} />
void wrongTitle

// The result still carries component statics
Chart.initialState = undefined

// Still assignable where a Component is expected
const asComponent: Component<any, ChartProps> = Chart
Page.components = { Settings }
void asComponent
