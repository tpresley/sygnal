// The probes' observations (what an author would see where the right answer is debatable): appended to
// ZAG_PROBE_LOG (default: zag-probe.log in the OS temp directory)
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const file = process.env.ZAG_PROBE_LOG || join(tmpdir(), 'zag-probe.log')
export const rec = (...a) => appendFileSync(file, a.map((x) => (typeof x == 'string' ? x : JSON.stringify(x))).join(' ') + '\n')
