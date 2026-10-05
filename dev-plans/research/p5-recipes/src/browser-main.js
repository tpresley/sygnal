// The browser half of the recipe tests (run-browser.mjs): every src/**/*.browser.jsx exports
// `tests`, an object of name → async function. They run one at a time, with the recipe mounted
// by renderComponent(..., { dom: 'real' }) and real input from Playwright (window.__pw).
const modules = import.meta.glob('./**/*.browser.jsx')
const only = new URLSearchParams(location.search).get('only')

const out = document.getElementById('results')
const results = []

async function main() {
  for (const [file, load] of Object.entries(modules).sort()) {
    if (only && !file.includes(only)) continue
    const { tests } = await load()
    for (const [name, fn] of Object.entries(tests)) {
      const label = `${file.replace('./', '')} > ${name}`
      try {
        await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout (8 s)')), 8000))])
        results.push({ label, ok: true })
      } catch (err) {
        results.push({ label, ok: false, error: err?.stack || String(err) })
      }
      document.querySelectorAll('body > :not(#results):not(script)').forEach((el) => el.remove())
      out.textContent = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.label}${r.ok ? '' : '\n  ' + r.error}`).join('\n')
    }
  }
  window.__done = results
}

main().catch((err) => { window.__done = [{ label: 'harness', ok: false, error: err?.stack || String(err) }] })
