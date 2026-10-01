// Extract framework/tooling complaints from an agent's final report.

const COMPLAINT_RE = /\b(bug|issues?|problems?|gap|quirk|sharp edge|workaround|worked around|work around|get around|got around|getting around|is not defined|is not a function|swallow(s|ed)?|silently|stale|doesn'?t support|does not support|breaks?|broke|limitation|be fixed|needs? a fix|worth fixing|lags?|sharp|surpris\w+|confus\w+|undocumented|not documented)\b/i
const TOOLING_RE = /\b(sygnal|plugin|vite|vitest|renderComponent|simulateAction|driverFromAsync|mock|framework|library|helper|jsdom|data-sygnal|isolat\w*|Collection|EVENTS|xstream|skill|docs?|React|testing-library|act\(|StrictMode|harness)\b/i

/** Split a markdown report into sentence-ish units (bullets kept whole). */
export function units(text) {
  const out = []
  for (const block of String(text ?? '').split(/\n+/)) {
    const b = block.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim()
    if (!b) continue
    // split long paragraphs into sentences
    for (const s of b.split(/(?<=[.!?])\s+(?=[A-Z`*])/)) if (s.trim()) out.push(s.trim())
  }
  return out
}

/** Short complaint strings from a final report. */
export function selfReportedIssues(text, max = 8) {
  const out = []
  for (const u of units(text)) {
    if (COMPLAINT_RE.test(u) && TOOLING_RE.test(u)) {
      const s = u.replace(/\*\*/g, '').replace(/\/private\/tmp\/\S+?\/(runs|trials)\/[^/\s]+\/[^/\s`]+/g, '<trial>').replace(/\s+/g, ' ')
      out.push(s.length > 240 ? s.slice(0, 237) + '...' : s)
      if (out.length >= max) break
    }
  }
  return out
}
