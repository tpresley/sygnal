/**
 * SYG301 — an RxJS operator was called on an xstream stream (error).
 *
 * Without help this fails with a bare "x.switchMap is not a function" inside
 * the intent function. Mechanism: when 'sygnal/diagnostics' is loaded, every
 * RxJS operator name below that xstream's Stream does NOT already have is
 * defined on Stream.prototype (non-enumerable) as a method that throws an
 * enriched TypeError: same "stream.<op> is not a function" shape, plus the
 * xstream equivalent and the SYG301 docs link. The error is also reported
 * (collected / printed per the diagnostics mode; in 'error' mode report()
 * throws the DiagnosticError itself). It works anywhere a stream is used
 * (intent, peers, drivers), with no hook in the core.
 *
 * Caveat: `typeof stream.pipe === 'function'` is true while this entry is
 * loaded (dev only).
 */
import {report} from './shared'
import {docsUrlFor} from '../codes'

/** RxJS operator -> xstream equivalent. */
export const RXJS_HINTS: Record<string, string> = {
  pipe: `chain xstream operators directly (.map(...).filter(...)), or use .compose(operator) for extra operators`,
  switchMap: `.map(x => inner$).flatten()`,
  mergeMap: `.map(x => inner$).compose(flattenConcurrently) (import { flattenConcurrently } from 'sygnal')`,
  flatMap: `.map(x => inner$).compose(flattenConcurrently) (import { flattenConcurrently } from 'sygnal')`,
  concatMap: `.map(x => inner$).compose(flattenSequentially) (import { flattenSequentially } from 'sygnal')`,
  exhaustMap: `.map(x => inner$).flatten() (xstream has no exhaustMap; ignore new values while busy with .filter())`,
  switchAll: `.flatten()`,
  mergeAll: `.compose(flattenConcurrently) (import { flattenConcurrently } from 'sygnal')`,
  concatAll: `.compose(flattenSequentially) (import { flattenSequentially } from 'sygnal')`,
  debounceTime: `.compose(debounce(ms)) (import { debounce } from 'sygnal')`,
  debounce: `.compose(debounce(ms)) (import { debounce } from 'sygnal')`,
  throttleTime: `.compose(throttle(ms)) (import { throttle } from 'sygnal')`,
  throttle: `.compose(throttle(ms)) (import { throttle } from 'sygnal')`,
  auditTime: `.compose(throttle(ms)) (import { throttle } from 'sygnal')`,
  delay: `.compose(delay(ms)) (import { delay } from 'sygnal')`,
  distinctUntilChanged: `.compose(dropRepeats()) (import { dropRepeats } from 'sygnal')`,
  withLatestFrom: `.compose(sampleCombine(other$)) (import { sampleCombine } from 'sygnal')`,
  combineLatest: `xs.combine(a$, b$) (import { xs } from 'sygnal')`,
  combineLatestWith: `xs.combine(a$, b$) (import { xs } from 'sygnal')`,
  merge: `xs.merge(a$, b$) (import { xs } from 'sygnal')`,
  mergeWith: `xs.merge(a$, b$) (import { xs } from 'sygnal')`,
  concat: `concat(a$, b$) (import { concat } from 'sygnal')`,
  scan: `.fold((acc, x) => next, seed)`,
  reduce: `.fold((acc, x) => next, seed).last()`,
  skip: `.drop(n)`,
  first: `.take(1)`,
  takeUntil: `.endWhen(other$)`,
  tap: `.debug(fn)`,
  do: `.debug(fn)`,
  catchError: `.replaceError(err => fallback$)`,
  catch: `.replaceError(err => fallback$)`,
  pluck: `.map(x => x.field)`,
  share: `xstream streams are already shared (hot); use .remember() to replay the latest value`,
  shareReplay: `.remember()`,
  publishReplay: `.remember()`,
  finalize: `.debug({ complete: fn }) or handle completion in the subscriber`,
}

const SYG301_URL = docsUrlFor('SYG301')

function rxjsError(op: string): TypeError {
  const hint = RXJS_HINTS[op]
  const message = `stream.${op} is not a function: '${op}' is an RxJS operator, but Sygnal streams are xstream streams`
  const fix = `Use ${hint}`
  // In 'error' mode report() throws the DiagnosticError itself (we are about to throw anyway).
  const d = report('SYG301', {message, fix, data: {operator: op, hint}})
  const err: any = new TypeError(d ? d.text : `[Sygnal SYG301] ${message}. ${fix}. ${SYG301_URL}`)
  err.diagnostic = d
  return err
}

/** Install the hints on xstream's Stream.prototype. Returns an uninstall function. */
export function installRxjsHints(proto: any): () => void {
  const added: string[] = []
  if (!proto) return () => {}
  for (const op of Object.keys(RXJS_HINTS)) {
    if (op in proto) continue
    Object.defineProperty(proto, op, {
      configurable: true,
      writable: true,
      enumerable: false,
      value: function rxjsOperatorHint() { throw rxjsError(op) },
    })
    added.push(op)
  }
  return () => { for (const op of added) delete proto[op] }
}
