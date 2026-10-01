/**
 * Type-level tests for the Sygnal public API.
 *
 * The assertions themselves live in type-tests/ (G-019): vitest runs
 * expectTypeOf/assertType as no-ops at runtime, so assertions kept in a vitest
 * file were never type-checked. `npm run test:types` compiles type-tests/ (and the
 * library sources) against src/index.d.ts; the tests below compile the programs
 * that one can't cover.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── Typed links: compiled type-test programs ────────────────────────────────
//
// `npm run test:types` compiles type-tests/ against src/index.d.ts. The programs
// below cover what that single program can't:
//  - type-tests/registry/ augments `SygnalEvents` (module augmentation is global to
//    a program, so it must be compiled separately from the untyped tests), and
//  - the bundled dist/index.d.ts that `npm run build` produces (what users import).
// Any diagnostic fails, including ones in src/ or dist/ declarations.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tscBin = createRequire(import.meta.url).resolve('typescript/bin/tsc')

function typeTestErrors(project: string): string[] {
  let output = ''
  try {
    output = execFileSync(process.execPath, [tscBin, '-p', project, '--pretty', 'false'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
  } catch (err: any) {
    output = String(err.stdout ?? '') + String(err.stderr ?? '')
  }
  return output.split('\n').filter((line) => /error TS\d+/.test(line))
}

describe('type-tests programs (tsc)', () => {
  const distTypes = path.join(repoRoot, 'dist/index.d.ts')

  it('SygnalEvents registry type-tests pass against src/index.d.ts', () => {
    expect(typeTestErrors('type-tests/registry/tsconfig.json')).toEqual([])
  }, 120_000)

  it('SygnalEvents registry type-tests pass against the bundled dist/index.d.ts', () => {
    expect(existsSync(distTypes), 'dist/index.d.ts missing: run `npm run build` first').toBe(true)
    expect(typeTestErrors('type-tests/registry/tsconfig.dist.json')).toEqual([])
  }, 120_000)

  it('all other type-tests pass against the bundled dist/index.d.ts', () => {
    expect(existsSync(distTypes), 'dist/index.d.ts missing: run `npm run build` first').toBe(true)
    expect(typeTestErrors('type-tests/tsconfig.dist.json')).toEqual([])
  }, 120_000)
})
