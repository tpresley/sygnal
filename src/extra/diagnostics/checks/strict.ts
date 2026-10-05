/**
 * Strict mode: canonical-form checks (PLAN-1 workstream 2A,
 * dev-plans/PLAN-1-canonical-forms.md). Runtime half; sygnal-check --strict
 * implements every rule statically.
 *
 * Off by default. Turn it on with any of:
 *   - configureStrict(true)                    (this entry)
 *   - renderComponent(C, { strict: true })     (tests)
 *   - globalThis.__SYGNAL_STRICT__ = true      (e.g. injected by a dev tool)
 * and diagnostics must be on (strict reports go through the same core).
 * The flag lives on the core bridge object, so it is shared by every copy of
 * this entry and by renderComponent.
 *
 * | Code   | Rule (canonical form)                    | Runtime mechanism                       |
 * |--------|------------------------------------------|-----------------------------------------|
 * | SYG508 | reply actions, not select()/errors()     | replies.ts: a request with a category   |
 * |        | round trip (PLAN-3 §1.1)                 | the same instance select()ed on a       |
 * |        |                                          | reply-capable source                    |
 *
 * SYG501 (positional views) and SYG504 ('ACTION | SINK' keys) are forms Sygnal 6.0 removed
 * (D164): at run time they are SYG612 (checks/next.ts, strict or not); `sygnal-check --strict`
 * still reports them under their own codes, with --fix. SYG502 is retired (PLAN-4 GS-4). SYG503,
 * SYG505, SYG506, SYG507: static only (sygnal-check --strict).
 *
 * Every finding is reported once per component name (+ action / key).
 * The SYG5xx severities are registered here (registerCodes) and passed
 * explicitly, so the main bundle doesn't carry them (D29).
 */
import type {DiagnosticCheck} from '../index'
import {CODE_TITLES, STRICT_CODE_SEVERITY, registerCodes} from '../codes'
import type {DiagnosticSeverity} from '../codes'
import {bridge} from './shared'

registerCodes(Object.keys(STRICT_CODE_SEVERITY).map(code =>
  [code, STRICT_CODE_SEVERITY[code], CODE_TITLES[code]] as [string, DiagnosticSeverity, string]))

/**
 * Turn runtime strict checks on (true), off (false), or back to the default
 * (undefined → globalThis.__SYGNAL_STRICT__ === true).
 */
export function configureStrict(on?: boolean): void {
  const core = bridge()
  if (core) core.strict = on
}

/** Whether runtime strict checks are on. */
export function isStrictEnabled(): boolean {
  const flag = bridge()?.strict
  return flag === undefined ? (globalThis as any).__SYGNAL_STRICT__ === true : flag === true
}

/** The strict check's runtime half is SYG508 (replies.ts); this entry keeps the flag. */
export const strictCheck: DiagnosticCheck = {
  id: 'strict',
}
