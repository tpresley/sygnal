// sygnal-check docs: answers from the installed package's dist/reference.json.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { main } from '../src/cli.js'
import { lookupDocs, nearestNames, answerText } from '../src/docs.js'
import { createMcpServer } from '../src/mcp.js'

const entry = (title, more = {}) => ({ kind: 'type', title, summary: null, signature: null, label: null, options: [], example: null, note: null, topic: null, ...more })
const reference = {
  format: 1, sygnal: '9.9.9', statics: ['resources', 'intent'], memberNames: ['latest'],
  aliases: { latest: 'FetchRequest.latest', 'ResourceRequest.latest': 'FetchRequest.latest', 'DOM.click': 'DOM' },
  entries: {
    FetchRequest: entry('FetchRequest (type, sygnal)', { label: 'Members', options: ['url: string', 'latest?: boolean - Latest only'], topic: 'llms/http.md', example: "latest: true" }),
    'FetchRequest.latest': entry('FetchRequest.latest?: boolean', { kind: 'member', summary: 'Latest only.' }),
    'Component.resources': entry('Component.resources?: object', { kind: 'static' }),
    'Component.intent': entry('Component.intent?: function', { kind: 'static' }),
    DOM: entry('DOM (source, in intent)', { kind: 'source' }),
    SYG900: entry('SYG900 (warn): from the package', { kind: 'diagnostic' }),
  },
}

let project, nested
const run = (argv, cwd = project) => {
  let out = '', err = ''
  const code = main(['docs', ...argv], { stdout: { write: (s) => { out += s } }, stderr: { write: (s) => { err += s } }, cwd })
  return { code, out, err }
}

beforeAll(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-docs-'))
  fs.mkdirSync(path.join(project, 'node_modules/sygnal/dist'), { recursive: true })
  fs.writeFileSync(path.join(project, 'node_modules/sygnal/dist/reference.json'), JSON.stringify(reference))
  nested = path.join(project, 'src/deep')
  fs.mkdirSync(nested, { recursive: true })
})
afterAll(() => fs.rmSync(project, { recursive: true, force: true }))

describe('sygnal-check docs', () => {
  it('prints an answer: options, example and the file to read', () => {
    const r = run(['FetchRequest'])
    expect(r.code).toBe(0)
    expect(r.out).toBe(answerText(reference.entries.FetchRequest) + '\n')
    expect(r.out).toContain('  latest?: boolean - Latest only')
    expect(r.out).toContain('Example: latest: true')
    expect(r.out).toContain('Read: node_modules/sygnal/llms/http.md')
  })

  it('finds the reference above the working directory', () => {
    expect(run(['FetchRequest'], nested).code).toBe(0)
  })

  it.each([
    ['latest', 'FetchRequest.latest'],
    ['ResourceRequest.latest', 'FetchRequest.latest'],
    ['DOM.click', 'DOM'],
    ['.resources', 'Component.resources'],
    ['App.resources', 'Component.resources'],
    ['Search.intent', 'Component.intent'],
    ['fetchrequest', 'FetchRequest'],
    ['FetchRequest.url', 'FetchRequest'],
    ['syg900', 'SYG900'],
    ['900', 'SYG900'],
  ])('%s answers from %s', (query, key) => {
    expect(lookupDocs(query, { cwd: project }).answer.key).toBe(key)
  })

  it('an unknown name fails and lists the nearest ones', () => {
    const r = run(['latset'])
    expect(r.code).toBe(1)
    expect(r.out).toBe('')
    expect(r.err).toContain("nothing named 'latset'")
    expect(r.err).toContain('latest')
    expect(nearestNames(reference, 'latset')[0]).toBe('latest')
  })

  it('a member an owner does not have is unknown, not the owner', () => {
    expect(lookupDocs('FetchRequest.nope', { cwd: project }).status).toBe('unknown')
  })

  it('--json has the parts and the text; an unknown name has found: false', () => {
    const found = JSON.parse(run(['FetchRequest', '--json']).out)
    expect(found).toMatchObject({ found: true, key: 'FetchRequest', topic: 'llms/http.md' })
    expect(found.text).toContain('Members:')
    const r = run(['latset', '--json'])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.out)).toMatchObject({ found: false, query: 'latset' })
    expect(JSON.parse(r.out).matches.length).toBeGreaterThan(0)
  })

  it('without the reference: a code still answers from the checker, anything else explains itself', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-docs-bare-'))
    try {
      const code = run(['SYG104'], bare)
      expect(code.code).toBe(0)
      expect(code.out).toContain('SYG104')
      const r = run(['FetchRequest'], bare)
      expect(r.code).toBe(2)
      expect(r.err).toContain('reference.json')
    } finally { fs.rmSync(bare, { recursive: true, force: true }) }
  })

  it('usage errors exit 2', () => {
    expect(run([]).code).toBe(2)
    expect(run(['a', 'b']).code).toBe(2)
    expect(run(['a', '--nope']).code).toBe(2)
    expect(run(['--help']).code).toBe(0)
  })

  it('the MCP tool gives the same answer, and an error for an unknown name', async () => {
    const server = createMcpServer({ cwd: project })
    const call = async (args) => (await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'docs', arguments: args } })).result
    const ok = await call({ symbol: 'FetchRequest' })
    expect(ok.isError).toBeFalsy()
    expect(ok.structuredContent.text).toBe(answerText(reference.entries.FetchRequest))
    const bad = await call({ symbol: 'latset' })
    expect(bad.isError).toBe(true)
    expect(bad.content[0].text).toContain('latest')
  })
})
