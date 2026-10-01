/**
 * Type tests for workstream 3D (G-055): flattenConcurrently / flattenSequentially / concat
 * are re-exported from 'sygnal' (the SYG301 RxJS→xstream hints point here).
 */
import { xs, flattenConcurrently, flattenSequentially, concat } from 'sygnal'
import type { Stream } from 'xstream'

const nested$: Stream<Stream<number>> = xs.of(xs.of(1), xs.of(2))
const conc$: Stream<number> = nested$.compose(flattenConcurrently)
const seq$: Stream<number> = nested$.compose(flattenSequentially)
const both$: Stream<number> = concat(xs.of(1), xs.of(2, 3))
// @ts-expect-error flattened values are numbers
const wrong$: Stream<string> = nested$.compose(flattenConcurrently)
void conc$; void seq$; void both$; void wrong$
