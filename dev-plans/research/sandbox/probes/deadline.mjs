// How far past its deadline a hostile reducer runs in the in-thread sandbox. The interrupt handler
// is polled between bytecodes; time inside one C call (the GC, JSON, a regexp, a sort) isn't
// interruptible. Each case runs in a child process with a hard 15 s timeout.
//   node probes/deadline.mjs
import {spawnSync} from 'node:child_process'

const CASES = {
  'loop': `for (;;) {}`,
  'objects to the limit': `const a = []; for (;;) a.push({x: a.length})`,
  'typed arrays to the limit (core catches)': `const a = []; for (;;) a.push(new Float64Array(1 << 20))`,
  'typed arrays to the limit (guest catches)': `const a = []; try { for (;;) a.push(new Float64Array(1 << 20)) } catch (e) { return s }`,
  'regexp backtracking': `/^(a+)+$/.test('a'.repeat(40) + 'b')`,
  'sort 200k': `const a = Array.from({length: 2e5}, () => Math.random()); for (;;) a.sort((x, y) => x - y)`,
  'repeat + split 8M': `'x'.repeat(1 << 23).split('').join('-')`,
  'JSON round trip, 10k rows': `const o = []; for (let i = 0; i < 1e4; i++) o.push({i, s: 'x'.repeat(50)}); for (;;) JSON.parse(JSON.stringify(o))`,
  'JSON round trip, 100k rows': `const o = []; for (let i = 0; i < 1e5; i++) o.push({i, s: 'x'.repeat(50)}); for (;;) JSON.parse(JSON.stringify(o))`,
}

if (process.argv[2] === '--case') {
  const {mount} = await import('../test/helpers.mjs')
  const {loadQuickJS} = await import('../src/sandbox.js')
  const [, , , name, mem, cap] = process.argv
  const QJS = cap ? await loadQuickJS({maxWasmBytes: +cap << 20}) : undefined
  const t = mount(`
    export default function P() { return <button className="b">go</button> }
    P.intent = ({ DOM }) => ({ GO: DOM.select('.b').events('click') })
    P.model = { GO: (s) => { ${CASES[name]} } }
  `, {QJS, limits: {memoryBytes: +mem << 20, callMs: 100, cpuShare: 1e9}})
  const t0 = performance.now()
  t.fire('.b', 'click')
  const threw = t.logs.find(l => /SYG216/.test(l[1]))
  console.log(JSON.stringify({ms: Math.round(performance.now() - t0), reason: t.errors[0]?.reason || (threw ? 'reducer threw ' + threw[1].split('InternalError: ').pop() + ' (SYG216)' : 'none')}))
} else {
  console.log('| case | heap limit 16 MB | heap limit 64 MB | heap 16 MB, instance capped at 48 MB |\n|---|---|---|---|')
  for (const name of Object.keys(CASES)) {
    const cells = [[16], [64], [16, 48]].map(([mem, cap]) => {
      const r = spawnSync(process.execPath, [import.meta.filename, '--case', name, mem, cap || ''], {timeout: 15000, encoding: 'utf8', cwd: import.meta.dirname})
      if (r.error || r.status !== 0) return r.error?.code === 'ETIMEDOUT' ? '**> 15 s (process killed)**' : 'crashed: ' + (r.stderr || '').split('\n').find(l => /Error|Abort/.test(l))
      const o = JSON.parse(r.stdout.trim().split('\n').pop())
      return `${o.ms} ms, ${o.reason}`
    })
    console.log(`| ${name} | ${cells.join(' | ')} |`)
  }
}
