// PLAN-10 C-3 / V-6: a temporary git repository with an app committed in one version and edited in
// the working tree, for `--base` (test/p10-base-diff.vtest.js, browser-tests/graph-view-diff.mjs).
//
//   makeDiffRepo({ dir?, extra?, config? }) → { root, git(...args) }
//     commit 1 (HEAD~1): the app with src/Old.jsx; commit 2 (HEAD): the same plus a config file
//     (`config`, default { ignore: ['SYG105'] }) and the `extra` files;
//     the working tree then: Old removed, New added, Header's actions changed, Item emits REMOVED
//     instead of SAVED, List.jsx renamed to Lists.jsx, App renders New instead of Old.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const V1 = {
  'package.json': JSON.stringify({ name: 'diff-app', private: true }),
  'src/App.jsx': `import { Header } from './Header.jsx'
import { List } from './List.jsx'
import { Old } from './Old.jsx'
export function App({ state }) {
  return <div><Header /><List /><Old /></div>
}
App.initialState = { items: [], saved: 0 }
App.intent = ({ EVENTS }) => ({ SAVED: EVENTS.select('SAVED') })
App.model = { SAVED: (s) => ({ ...s, saved: s.saved + 1 }) }
`,
  'src/Header.jsx': `export function Header({ state }) {
  return <header><button className="t">menu</button></header>
}
Header.initialState = { open: false }
Header.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.t') })
Header.model = { TOGGLE: (s) => ({ open: !s.open }) }
Header.isolatedState = true
`,
  'src/List.jsx': `import { Collection } from 'sygnal'
import { Item } from './Item.jsx'
export function List() {
  return <ul><Collection of={Item} from="items" /></ul>
}
`,
  'src/Item.jsx': `export function Item({ state }) {
  return <li><button className="save">{state.name}</button></li>
}
Item.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
Item.model = { SAVE: { EVENTS: (s) => ({ type: 'SAVED', data: s.id }) } }
`,
  'src/Old.jsx': `export function Old() {
  return <p>old</p>
}
Old.initialState = { x: 1 }
Old.intent = ({ DOM }) => ({ POKE: DOM.click('p') })
Old.model = { POKE: (s) => ({ x: s.x + 1 }) }
Old.isolatedState = true
`,
}

/** What the working tree has after the edits (null: deleted). */
export const EDITS = {
  'src/Old.jsx': null,
  'src/List.jsx': null,
  'src/Lists.jsx': V1['src/List.jsx'],
  'src/New.jsx': `export function New({ state }) {
  return <section><button className="go">go</button></section>
}
New.initialState = { n: 0 }
New.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
New.model = { GO: (s) => ({ n: s.n + 1 }) }
New.isolatedState = true
`,
  'src/App.jsx': V1['src/App.jsx'].replace("import { Old } from './Old.jsx'", "import { New } from './New.jsx'").replace("from './List.jsx'", "from './Lists.jsx'").replace('<Old />', '<New />'),
  'src/Header.jsx': V1['src/Header.jsx'].replace("TOGGLE: DOM.click('.t')", "OPEN: DOM.click('.t'), CLOSE: DOM.click('.t')").replace('TOGGLE: (s) => ({ open: !s.open })', 'OPEN: () => ({ open: true }), CLOSE: () => ({ open: false })'),
  'src/Item.jsx': V1['src/Item.jsx'].replace("type: 'SAVED'", "type: 'REMOVED'"),
}

export function makeDiffRepo({ dir, extra = {}, config = { ignore: ['SYG105'] } } = {}) {
  const root = dir ?? fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-base-test-')))
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const write = (files) => {
    for (const [f, text] of Object.entries(files)) {
      const abs = path.join(root, f)
      if (text == null) { fs.rmSync(abs, { force: true }); continue }
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, text)
    }
  }
  git('init', '-q')
  write(V1)
  git('add', '-A')
  git('commit', '-q', '-m', 'v1')
  write({ 'sygnal-check.config.json': JSON.stringify(config), ...extra })
  git('add', '-A')
  git('commit', '-q', '-m', 'config')
  write(EDITS)
  return { root, git }
}
