// PLAN-7 I-3 (§3 Templates gate): every create-sygnal-app template recommends the
// VS Code extension (`.vscode/extensions.json`, id `sygnal.sygnal`, D300) and carries the
// shared sygnal-check config (`sygnal-check.config.json`, D299), both files survive
// `npm pack` and scaffolding, and this repo's sygnal-check reads the config of a freshly
// scaffolded project: plain `sygnal-check` checks what AGENTS.md's command checks.
//
// The scaffold runs the real CLI from the packed tarball (no network: `--no-install`, and
// `@clack/prompts`, which the non-interactive path only imports, is a local stub).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { check } from '../sygnal-check/src/index.js'
import { loadConfig, resolveOptions } from '../sygnal-check/src/config.js'
import { expandInputs } from '../sygnal-check/src/files.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const csa = path.join(repo, 'create-sygnal-app')

const TEMPLATES = ['vite', 'vite-pwa', 'vike', 'astro', 'mcp-app']
const VARIANTS = TEMPLATES.flatMap(t => [
  { template: t, lang: 'js', dir: `template-${t}` },
  { template: t, lang: 'ts', dir: `template-${t}-ts` },
])
// Templates whose sources are not under src/ (the config's default `paths`)
const PATHS = { vike: ['pages'] }

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

/** The path AGENTS.md's `npx --no-install sygnal-check [path] --strict` checks ('src' when none). */
function agentsCheckPaths(projectDir) {
  const text = fs.readFileSync(path.join(projectDir, 'AGENTS.md'), 'utf8')
  const m = text.match(/`npx --no-install sygnal-check((?: [^-`\s]\S*)*) --strict`/)
  expect(m, 'AGENTS.md names the sygnal-check --strict command').toBeTruthy()
  const args = m[1].trim()
  return args ? args.split(/\s+/) : ['src']
}

describe('create-sygnal-app templates: editor recommendation + sygnal-check config (PLAN-7 I-3)', () => {
  it('there are exactly the 10 expected templates', () => {
    const dirs = fs.readdirSync(csa).filter(n => n.startsWith('template-')).sort()
    expect(dirs).toEqual(VARIANTS.map(v => v.dir).sort())
  })

  for (const { template, dir } of VARIANTS) {
    it(`${dir} has .vscode/extensions.json and sygnal-check.config.json`, () => {
      const root = path.join(csa, dir)
      expect(readJson(path.join(root, '.vscode/extensions.json'))).toEqual({ recommendations: ['sygnal.sygnal'] })
      const expected = { strict: true, ...(PATHS[template] ? { paths: PATHS[template] } : {}) }
      expect(readJson(path.join(root, 'sygnal-check.config.json'))).toEqual(expected)
    })
  }

  describe('a freshly scaffolded project (from the packed tarball)', () => {
    let tmp
    let pkgDir
    const projects = {}

    beforeAll(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csa-i3-'))
      const out = execFileSync('npm', ['pack', '--json', '--pack-destination', tmp], { cwd: csa, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      const tarball = path.join(tmp, JSON.parse(out)[0].filename)
      execFileSync('tar', ['-xzf', tarball, '-C', tmp])
      pkgDir = path.join(tmp, 'package')
      // The non-interactive path (template + language + --no-install given) never prompts.
      const stub = path.join(pkgDir, 'node_modules/@clack/prompts')
      fs.mkdirSync(stub, { recursive: true })
      fs.writeFileSync(path.join(stub, 'package.json'), JSON.stringify({ name: '@clack/prompts', type: 'module', main: 'index.js' }))
      fs.writeFileSync(path.join(stub, 'index.js'), "export const isCancel = () => false\nconst no = () => { throw new Error('prompted in a non-interactive scaffold') }\nexport const intro = no, text = no, select = no, confirm = no, spinner = no, note = no, outro = no, cancel = no\n")
      const work = path.join(tmp, 'apps')
      fs.mkdirSync(work)
      for (const { template, lang, dir } of VARIANTS) {
        const name = `app-${dir}`
        execFileSync(process.execPath, [path.join(pkgDir, 'index.js'), name, '--template', template, `--${lang}`, '--no-install'], { cwd: work, stdio: 'ignore' })
        projects[dir] = path.join(work, name)
      }
    }, 60_000)

    afterAll(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) })

    it('the tarball contains both files of every template', () => {
      for (const { dir } of VARIANTS) {
        expect(fs.existsSync(path.join(pkgDir, dir, '.vscode/extensions.json')), dir).toBe(true)
        expect(fs.existsSync(path.join(pkgDir, dir, 'sygnal-check.config.json')), dir).toBe(true)
      }
    })

    for (const { template, dir } of VARIANTS) {
      it(`${dir}: scaffolded with both files, and sygnal-check reads the config`, () => {
        const proj = projects[dir]
        expect(readJson(path.join(proj, '.vscode/extensions.json'))).toEqual({ recommendations: ['sygnal.sygnal'] })
        expect(readJson(path.join(proj, 'sygnal-check.config.json')))
          .toEqual(readJson(path.join(csa, dir, 'sygnal-check.config.json')))

        // loadConfig finds the project's file (it wins over package.json, which has no key)
        const loaded = loadConfig(proj)
        expect(loaded.diagnostics).toEqual([])
        expect(fs.realpathSync(loaded.file)).toBe(fs.realpathSync(path.join(proj, 'sygnal-check.config.json')))
        expect(loaded.config.strict).toBe(true)
        const { options } = resolveOptions({ cwd: proj })
        expect(options.strict).toBe(true)

        // plain `sygnal-check` (no inputs) checks the files AGENTS.md's command checks
        const agentsPaths = agentsCheckPaths(proj)
        if (PATHS[template]) expect(agentsPaths).toEqual(PATHS[template])
        const viaConfig = expandInputs(options.paths, { cwd: proj }).files.sort()
        const viaAgents = expandInputs(agentsPaths, { cwd: proj }).files.sort()
        expect(viaConfig.length).toBeGreaterThan(0)
        expect(viaConfig).toEqual(viaAgents)

        // and the templates are strict-clean, with the config and with AGENTS.md's flags
        expect(check(undefined, { cwd: proj })).toEqual([])
        expect(check(agentsPaths, { cwd: proj, strict: true, config: false })).toEqual([])
      })
    }
  })
})
