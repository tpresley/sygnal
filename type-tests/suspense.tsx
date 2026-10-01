import { Suspense } from 'sygnal'
import type { SuspenseProps } from 'sygnal'

const props: SuspenseProps = { fallback: <div>Loading…</div> }
export const ok = <Suspense fallback={<div>Loading…</div>}><div>content</div></Suspense>
export { props }
// @ts-expect-error unknown prop
export const bad = <Suspense nope={1} />
