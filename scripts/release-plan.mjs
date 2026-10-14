#!/usr/bin/env node
// Which versions in this checkout aren't published yet (the release workflow's `plan` job, and a
// quick local check). Five targets, each read from its manifest and looked up where it ships:
//
//   sygnal, sygnal-check, create-sygnal-app   npm (`npm view <name>@<version>`)
//   vscode                                    the VS Code Marketplace and Open VSX (both must have it)
//   plugin                                    the git tag sygnal--v<version> on origin (installs follow main)
//
//   node scripts/release-plan.mjs             a table, then JSON on the last line
//   node scripts/release-plan.mjs --all       every target counts as new (the workflow's dry run)
//
// In GitHub Actions it also writes the outputs `any`, `<target>` (true / false: publish it),
// `<target>_version` and `<target>_published` (already on its registry), and a summary table.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'))
const all = process.argv.includes('--all')

const TARGETS = [
  { id: 'check', label: 'sygnal-check', manifest: 'sygnal-check/package.json', where: 'npm' },
  { id: 'sygnal', label: 'sygnal', manifest: 'package.json', where: 'npm' },
  { id: 'csa', label: 'create-sygnal-app', manifest: 'create-sygnal-app/package.json', where: 'npm' },
  { id: 'vscode', label: 'VS Code extension', manifest: 'editors/vscode/package.json', where: 'Marketplace + Open VSX' },
  { id: 'plugin', label: 'Claude Code plugin', manifest: 'editors/claude-code/.claude-plugin/plugin.json', where: 'git tag' },
]

function onNpm(name, version) {
  try {
    return execFileSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === version
  } catch {
    return false // E404: no such version
  }
}

async function onMarketplace(id, version) {
  const res = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=3.0-preview.1' },
    // flags 1: include every version
    body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: id }] }], flags: 1 }),
  })
  if (!res.ok) throw new Error(`Marketplace query: HTTP ${res.status}`)
  const ext = (await res.json()).results?.[0]?.extensions?.[0]
  return !!ext?.versions?.some((v) => v.version === version)
}

async function onOpenVsx(publisher, name, version) {
  const res = await fetch(`https://open-vsx.org/api/${publisher}/${name}/${version}`)
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`Open VSX: HTTP ${res.status}`)
  return true
}

function hasTag(tag) {
  const out = execFileSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { cwd: repo, encoding: 'utf8' })
  return out.trim().length > 0
}

const plan = {}
for (const t of TARGETS) {
  const m = read(t.manifest)
  let published
  if (t.where === 'npm') published = onNpm(m.name, m.version)
  else if (t.id === 'vscode') {
    const [market, openvsx] = await Promise.all([onMarketplace(`${m.publisher}.${m.name}`, m.version), onOpenVsx(m.publisher, m.name, m.version)])
    published = market && openvsx
    t.detail = `Marketplace ${market ? 'has it' : 'no'}, Open VSX ${openvsx ? 'has it' : 'no'}`
  } else published = hasTag(`${m.name}--v${m.version}`)
  plan[t.id] = { label: t.label, version: m.version, publish: all || !published, published }
  console.log(`${t.label.padEnd(20)} ${m.version.padEnd(8)} ${published ? 'published' : 'NEW'}${t.detail ? ` (${t.detail})` : ''}${all && published ? '  (--all: treated as new)' : ''}`)
}
const any = Object.values(plan).some((p) => p.publish)

if (process.env.GITHUB_OUTPUT) {
  const lines = [`any=${any}`, ...Object.entries(plan).flatMap(([id, p]) => [`${id}=${p.publish}`, `${id}_version=${p.version}`, `${id}_published=${p.published}`])]
  fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n')
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = Object.values(plan).map((p) => `| ${p.label} | ${p.version} | ${p.publish ? '**publish**' : 'already published'} |`)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['### Release plan', '', '| Package | Version | |', '|---|---|---|', ...rows, ''].join('\n') + '\n')
}
console.log(JSON.stringify({ any, ...plan }))
