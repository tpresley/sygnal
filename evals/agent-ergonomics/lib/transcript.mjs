// Command classification for transcript-stats.mjs (unit-tested in
// tests/transcript.unit.mjs).

const SCRIPT_RE = /^(build|test|dev|preview|start)(:|$)/
const VITE_BIN_RE = /^(vite|vitest)$/
// Options that take a value, for the package managers and npx-likes we parse.
const VALUE_OPTS = new Set(['--prefix', '-C', '--cwd', '--dir', '-w', '--workspace', '--filter', '-F', '-p', '--package', '--call', '-c', '--loglevel'])

/** Remove here-document bodies (`<<'EOF' ... EOF`): they are file contents or scripts, not commands. */
export function stripHeredocs(cmd) {
  return String(cmd).replace(/<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, '<<heredoc')
}

/** Split a shell command into simple-command segments at && || ; | & and newlines (quotes are not respected; good enough here). */
export function splitCommands(cmd) {
  return stripHeredocs(cmd)
    .split(/&&|\|\||[;|&\n]/)
    .map((s) => s.trim().replace(/^[({]+\s*/, '').replace(/\s*[)}]+$/, '').trim())
    .filter(Boolean)
}

const unquote = (w) => w.replace(/^['"]|['"]$/g, '')
const baseName = (w) => unquote(w).split('/').pop()

/** Positional words of an argument list, skipping options (and the values of options that take one). */
function positionals(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') break
    if (a.startsWith('-')) {
      if (VALUE_OPTS.has(a)) i++
      continue
    }
    out.push(unquote(a))
  }
  return out
}

function isViteBin(word) {
  if (!word) return false
  const w = unquote(word)
  return VITE_BIN_RE.test(baseName(w)) || /(^|\/)vite\/bin\/vite\.js$|(^|\/)vitest\/vitest\.mjs$/.test(w)
}

/** Does one simple command build, test or run the app? */
export function segmentRuns(segment) {
  let words = segment.split(/\s+/).filter(Boolean)
  // Leading env assignments and wrappers: `CI=1 npm test`, `timeout 60 npx vitest`, `env FOO=1 ...`.
  for (;;) {
    if (!words.length) return false
    const w = words[0]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || ['env', 'time', 'command', 'exec', 'nohup'].includes(w)) words.shift()
    else if (w === 'timeout' || w === 'gtimeout') {
      words.shift()
      while (words[0] && /^(-|\d)/.test(words[0])) words.shift()
    } else break
  }
  const [bin, ...args] = words
  const base = baseName(bin)

  if (['bash', 'sh', 'zsh'].includes(base) && args.includes('-c')) {
    return isRunCommand(args.slice(args.indexOf('-c') + 1).join(' ').replace(/^['"]|['"]$/g, ''))
  }
  if (VITE_BIN_RE.test(base)) return true // vite, vitest, ./node_modules/.bin/vitest
  if (base === 'node') return isViteBin(positionals(args)[0])
  if (['npx', 'bunx', 'pnpx'].includes(base)) return isViteBin(positionals(args)[0])

  if (['npm', 'pnpm', 'yarn', 'bun'].includes(base)) {
    const [sub, next] = positionals(args)
    if (!sub) return false
    if (['test', 't', 'tst'].includes(sub)) return true
    if (['run', 'run-script', 'rum', 'urn'].includes(sub)) return SCRIPT_RE.test(next || '')
    if (['exec', 'x', 'dlx'].includes(sub)) return isViteBin(next)
    // pnpm / yarn / bun run scripts directly: `yarn build`, `pnpm dev`.
    if (base !== 'npm') return SCRIPT_RE.test(sub)
    return false
  }
  return false
}

/** Does this Bash command (possibly a chain) build, test or run the app at least once? */
export function isRunCommand(cmd) {
  return splitCommands(cmd).some(segmentRuns)
}

const BASH_EDIT_RE = /\bsed\s+-i\b|\bperl\s+-[a-z]*i|\btee\b|(?:^|[^2&])>{1,2}\s*[^\s&|]+\.(?:jsx?|tsx?|css|html|json)\b/

/** Does this Bash command obviously write a source file? */
export function isEditCommand(cmd) {
  return BASH_EDIT_RE.test(String(cmd))
}

// Peeking: the eval harness itself, hidden-test dirs, and hidden test files.
// Deliberately NOT a bare "evals" (G-009): trial dirs often live under .../evals/...
const PEEK_RE = /evals\/agent-ergonomics|agent-ergonomics\/|\/hidden\/|__hidden__|\.hidden\.[jt]sx?/

/** Does this tool input text mention the hidden tests or the eval harness? The trial dir itself is ignored. */
export function mentionsHidden(text, trialDir = null) {
  let t = String(text)
  if (trialDir) t = t.split(trialDir).join('<trial>')
  return PEEK_RE.test(t)
}
