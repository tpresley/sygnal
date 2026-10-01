/**
 * Type tests for workstream 3D (G-058): `Suspense` is declared in the public types.
 */
import type { Component, SuspenseProps } from 'sygnal'
import { Suspense } from 'sygnal'

const Page: Component = () => (
  <div>
    <Suspense fallback={<p>Loading…</p>}>
      <section className="chart">chart</section>
    </Suspense>
    <Suspense fallback="Loading">
      <span>text fallback</span>
    </Suspense>
    <Suspense>
      <span>no fallback</span>
    </Suspense>
  </div>
)
void Page

const props: SuspenseProps = { fallback: <p>wait</p>, children: [<span />] }
void props

// @ts-expect-error Suspense is a component function, not a string
const notString: string = Suspense
void notString
