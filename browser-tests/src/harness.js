/**
 * Minimal browser test harness for Sygnal.
 * Each test gets its own mount point. Results are displayed in a table.
 */

const results = []
const containers = document.getElementById('test-containers')
let testCounter = 0

export function mount() {
  const id = `test-${testCounter++}`
  const el = document.createElement('div')
  el.id = id
  el.className = 'test-mount'
  containers.appendChild(el)
  return { id: `#${id}`, el }
}

export function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed')
}

export function record(category, name, status, details = '') {
  results.push({ category, name, status, details })
  render()
}

export async function runTest(category, name, fn, timeoutMs = 3000) {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs)),
    ])
    record(category, name, 'pass')
  } catch (err) {
    record(category, name, 'fail', err.message)
  }
}

export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function waitFor(predicate, timeoutMs = 2000, intervalMs = 50) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      try {
        if (predicate()) return resolve()
      } catch (_) {}
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'))
      setTimeout(check, intervalMs)
    }
    check()
  })
}

export function getResults() {
  return results
}

function render() {
  const tbody = document.getElementById('results-body')
  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length
  const total = results.length

  document.getElementById('summary').innerHTML =
    `<strong>${passed}</strong> passed, <strong class="fail">${failed}</strong> failed, <strong>${total}</strong> total`

  let html = ''
  let lastCategory = ''
  for (const r of results) {
    if (r.category !== lastCategory) {
      html += `<tr class="category"><td colspan="3">${r.category}</td></tr>`
      lastCategory = r.category
    }
    const cls = r.status === 'pass' ? 'pass' : r.status === 'fail' ? 'fail' : 'pending'
    html += `<tr><td>${r.name}</td><td class="${cls}">${r.status.toUpperCase()}</td><td>${r.details}</td></tr>`
  }
  tbody.innerHTML = html
}
