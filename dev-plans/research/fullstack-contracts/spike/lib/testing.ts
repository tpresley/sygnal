// Spike: contract-checked test fixtures. A fixture that no longer matches the contract fails
// the test that uses it, so a fake backend can't drift from the real one unnoticed.
import type { Procedure, OutputOf } from './contract.ts'

export function fixture<P extends Procedure>(proc: P, data: OutputOf<P['output']>): OutputOf<P['output']> {
  const r: any = proc.output['~standard'].validate(data)
  if (r instanceof Promise) throw new Error('fixture(): async schemas are not supported in this spike')
  if (r.issues) throw new Error(`fixture does not match the contract: ${r.issues.map((i: any) => `${i.path?.join('.') ?? ''} ${i.message}`).join('; ')}`)
  return r.value
}
