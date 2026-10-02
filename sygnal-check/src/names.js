/**
 * Name similarity helpers ("did you mean …?").
 */

/** Levenshtein distance. */
export function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[a.length][b.length]
}

/**
 * The candidate closest to `name`: a case-insensitive match, or an edit distance of at most
 * min(2, ⌊length/3⌋) (the same rule as the runtime checks' suggest()). null when none is close.
 */
export function closestName(name, candidates) {
  let best = null
  let bestScore = Infinity
  for (const c of candidates) {
    if (c === name) continue
    const score = c.toLowerCase() === name.toLowerCase() ? 0 : editDistance(c, name)
    if (score < bestScore) { best = c; bestScore = score }
  }
  return bestScore <= Math.min(2, Math.floor(name.length / 3)) ? best : null
}
