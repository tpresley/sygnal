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

// ---- Bash calls that write project files (PLAN-2 0-B fix2)
//
// Agents edit files from Bash as often as with Edit/Write: `cat > f <<EOF`,
// `> f` / `>> f` / `tee f`, `sed -i`, `perl -pi`, a python/node script that
// opens a file for writing (often in a heredoc: `python3 - <<'EOF' … open(p,'w')`),
// and `patch` / `git apply` / `apply_patch`. One call can also edit and then
// run the tests (`… && npm test`); it is then both an edit and an iteration.

const SRC_EXT_RE = /\.(?:[cm]?[jt]sx?|css|scss|less|html|json|md|vue|svelte|snap)$/
const HEREDOC_RE = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1([^\n]*)\n([\s\S]*?)\n\s*\2(?=\s|$)/g
const INTERP_RE = /(?:^|[\s;&|(/])(python3?|node|perl|ruby|deno|bun)\b/
const clean = (p) => String(p).replace(/^['"]|['"]$/g, '')
const notDevice = (p) => p && p !== '/dev/null' && !/^&\d$/.test(p) && !/^\/dev\//.test(p)

/** Heredocs of a command: [{ header, body }], header = the text before `<<` on its line. */
export function heredocs(cmd) {
  const s = String(cmd)
  const out = []
  for (const m of s.matchAll(HEREDOC_RE)) {
    const lineStart = s.lastIndexOf('\n', m.index) + 1
    out.push({ header: s.slice(lineStart, m.index), body: m[4] })
  }
  return out
}

/** Files a python / node / ruby script writes: open(x, 'w'), Path(x).write_text, writeFileSync(x, ...). */
export function scriptWriteTargets(code) {
  const s = String(code)
  const vars = {}
  for (const m of s.matchAll(/(?:\b(?:const|let|var)\s+)?\b([A-Za-z_]\w*)\s*=\s*(?:Path\(\s*)?(['"])([^'"\n]+)\2/g)) vars[m[1]] = m[3]
  const val = (x) => {
    const t = String(x).trim()
    const lit = t.match(/^(?:Path\(\s*)?(['"])([^'"]+)\1/)
    if (lit) return lit[2]
    const v = t.match(/^(?:Path\(\s*)?([A-Za-z_]\w*)/)
    return v && vars[v[1]] ? vars[v[1]] : '?'
  }
  const out = []
  // python: open(x, 'w' | 'a' | 'w+' ...), also mode='w'
  for (const m of s.matchAll(/\bopen\(\s*([^,()]+?)\s*,\s*(?:mode\s*=\s*)?['"]([wax]\+?b?|r\+)['"]/g)) out.push(val(m[1]))
  // python: Path(x).write_text / p.write_text where p = Path('...')
  for (const m of s.matchAll(/((?:Path\(\s*[^)]*\))|[A-Za-z_]\w*)\.write_(?:text|bytes)\(/g)) out.push(val(m[1]))
  // node / deno / bun
  for (const m of s.matchAll(/\b(?:writeFileSync|writeFile|appendFileSync|appendFile|Deno\.writeTextFile|Bun\.write)\(\s*([^,()]+?)\s*,/g)) out.push(val(m[1]))
  // ruby
  for (const m of s.matchAll(/\bFile\.write\(\s*([^,()]+?)\s*,/g)) out.push(val(m[1]))
  return out
}

/** Files a unified diff / apply_patch body touches. */
function patchTargets(text) {
  const out = []
  for (const m of String(text).matchAll(/^\+\+\+ (?:b\/)?([^\s]+)/gm)) if (m[1] !== '/dev/null') out.push(m[1])
  for (const m of String(text).matchAll(/^\*\*\* (?:Update|Add) File: (\S+)/gm)) out.push(m[1])
  return out
}

/**
 * What a Bash command writes: { edits, targets }. `edits` is true when the
 * command writes a project file; `targets` are the paths it could identify
 * (a script that writes through an unresolvable expression is an edit with no
 * target). Redirects and tee count only for source-like files (so `> out.log`
 * is not an edit); sed -i, perl -i, scripts and patches always count.
 */
export function bashEdits(cmd) {
  const s = String(cmd)
  const flat = stripHeredocs(s)
  const targets = []
  let edits = false
  const add = (p, always) => {
    const c = clean(p)
    if (!notDevice(c)) return
    if (c === '?') {
      edits = true
      return
    }
    if (always || SRC_EXT_RE.test(c)) {
      edits = true
      if (!targets.includes(c)) targets.push(c)
    }
  }
  // Redirects and tee, outside heredoc bodies.
  for (const m of flat.matchAll(/(?:^|[^2&>\d<])>{1,2}\s*(["']?[^\s"'&|;<>()]+["']?)/g)) add(m[1], false)
  for (const m of flat.matchAll(/\btee\s+(?:-a\s+)?(["']?[^\s"'&|;<>]+["']?)/g)) add(m[1], false)
  // In-place editors: the file operands after the script.
  for (const seg of splitCommands(s)) {
    const w = seg.match(/^(?:sudo\s+)?(sed|perl|gsed)\s+(.*)$/)
    if (!w) continue
    const rest = w[2]
    const inPlace = w[1] === 'perl' ? /(^|\s)-[a-zA-Z]*i/.test(rest) : /(^|\s)(-i|--in-place)\b/.test(rest)
    if (!inPlace) continue
    const words = rest.match(/'[^']*'|"[^"]*"|\S+/g) ?? []
    const files = words.filter((x) => !x.startsWith('-') && !/^['"]/.test(x) && /[./]/.test(x) && !/^s[/|#]/.test(x))
    if (files.length) for (const f of files) add(f, true)
    else edits = true
  }
  // Scripts: heredoc bodies fed to an interpreter, and -c / -e one-liners.
  for (const h of heredocs(s)) {
    if (INTERP_RE.test(h.header) && !/>\s*\S/.test(h.header)) for (const t of scriptWriteTargets(h.body)) add(t, true)
    if (/\b(?:patch|apply_patch|git\s+apply)\b/.test(h.header)) {
      edits = true
      for (const t of patchTargets(h.body)) add(t, true)
    }
  }
  for (const m of flat.matchAll(/\b(?:python3?|node|perl|ruby|deno|bun)\b[^|;&\n]*?\s-(?:c|e|-eval)\s+('[^']*'|"(?:[^"\\]|\\.)*")/g)) for (const t of scriptWriteTargets(m[1])) add(t, true)
  // Patches from a file or stdin.
  if (splitCommands(s).some((seg) => /^(?:git\s+apply|apply_patch|patch)\b/.test(seg))) edits = true
  return { edits, targets }
}

/**
 * How much of a Bash edit's text goes to each target: [{ target, chars }].
 * A heredoc counts toward the file it is redirected to (`cat > f <<EOF`), or
 * is split evenly over the files the script it feeds writes. Used to split
 * the time of one call that writes both source and test files.
 */
export function bashEditWeights(cmd) {
  const out = []
  for (const h of heredocs(cmd)) {
    const redirect = h.header.match(/>{1,2}\s*["']?([^\s"'&|;<>]+)/)
    const targets = redirect ? [redirect[1]] : INTERP_RE.test(h.header) ? scriptWriteTargets(h.body).filter((t) => t !== '?') : []
    for (const t of targets) out.push({ target: t, chars: h.body.length / targets.length })
  }
  return out
}

/** Does this Bash command write a project file? */
export function isEditCommand(cmd) {
  return bashEdits(cmd).edits
}

// Peeking: the eval harness itself, hidden-test dirs, and hidden test files.
// Deliberately NOT a bare "evals" (G-009): trial dirs often live under .../evals/...
const PEEK_RE = /evals\/agent-ergonomics|agent-ergonomics\/|\/hidden\/|__hidden__|\.hidden\.[jt]sx?/

/** Does this tool input text mention the hidden tests or the eval harness? The trial dir itself is ignored. */
export function mentionsHidden(text, trialDir = null) {
  let t = String(text)
  for (const d of dirAliases(trialDir)) t = t.split(d).join('<trial>')
  return PEEK_RE.test(t)
}

/**
 * The spellings of a directory an agent may use. On macOS /tmp and /var are
 * symlinks into /private, and a headless agent's cwd is the resolved path, so
 * /tmp/x and /private/tmp/x are the same trial dir. Longest first.
 */
export function dirAliases(dir) {
  if (!dir) return []
  const out = new Set([dir])
  const m = dir.match(/^\/private(\/(?:tmp|var)(?:\/.*)?)$/)
  if (m) out.add(m[1])
  else if (/^\/(?:tmp|var)(?:\/|$)/.test(dir)) out.add('/private' + dir)
  return [...out].sort((a, b) => b.length - a.length)
}

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const PATH_TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit']

/**
 * Trial metrics from transcript JSONL text (a PLAN-1 subagent log or a
 * headless `<dest>.transcript.jsonl`); see transcript-stats.mjs for the
 * definitions. Headless transcripts also carry a `system/init` and a final
 * `result` event; their model, cost, billed tokens and duration are returned
 * under `headless` (null for subagent logs).
 */
export function transcriptStats(text, trialDir = null) {
  const events = [] // { kind: 'run'|'edit'|'other', name, input, ts }
  let firstTs = null
  let lastTs = null
  let result = null
  let init = null
  const seen = new Set()
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    const ts = obj.timestamp ? Date.parse(obj.timestamp) : null
    if (ts) {
      firstTs ??= ts
      lastTs = ts
    }
    if (obj.type === 'result') result = obj
    if (obj.type === 'system' && obj.subtype === 'init') init = obj
    const msg = obj.message ?? obj
    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (block?.type !== 'tool_use' || seen.has(block.id)) continue
      seen.add(block.id)
      const name = block.name
      const input = block.input ?? {}
      let edit = EDIT_TOOLS.has(name)
      let run = false
      if (name === 'Bash') {
        const cmd = String(input.command ?? '')
        run = isRunCommand(cmd)
        edit = isEditCommand(cmd)
      }
      // A Bash call that edits and then runs the tests is both an edit and an iteration.
      events.push({ kind: run ? 'run' : edit ? 'edit' : 'other', edit, run, name, input, ts })
    }
  }

  let iterations = 0
  let edits = 0
  let editRounds = 0
  let inEditRound = false
  const audit = []
  for (const e of events) {
    if (e.edit) {
      edits++
      if (!inEditRound) {
        editRounds++
        inEditRound = true
      }
    }
    if (e.run) {
      iterations++
      inEditRound = false
    }
    const t = JSON.stringify(e.input)
    if (mentionsHidden(t, trialDir)) audit.push({ tool: e.name, reason: 'mentions hidden tests / eval harness', input: t.slice(0, 300) })
    if (trialDir && PATH_TOOLS.includes(e.name)) {
      const p = e.input.file_path ?? e.input.path
      if (typeof p === 'string' && p.startsWith('/') && !dirAliases(trialDir).some((d) => p.startsWith(d)) && !/[/\\]skills?[/\\]/.test(p)) {
        audit.push({ tool: e.name, reason: 'touches a path outside the trial dir', input: p })
      }
    }
  }

  let headless = null
  if (result || init) {
    const u = result?.usage ?? {}
    headless = {
      model: init?.model ?? null,
      completed: !!result,
      isError: result ? !!result.is_error : null,
      durationMs: result?.duration_ms ?? null,
      costUsd: result?.total_cost_usd ?? null,
      tokens: result ? (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : null,
      outputTokens: result ? u.output_tokens ?? 0 : null,
      numTurns: result?.num_turns ?? null,
    }
  }

  return {
    iterations,
    editRounds,
    edits,
    wallSeconds: firstTs && lastTs ? Math.round((lastTs - firstTs) / 1000) : headless?.durationMs != null ? Math.round(headless.durationMs / 1000) : null,
    toolCalls: events.length,
    audit,
    headless,
  }
}
