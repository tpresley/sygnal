// @vitest-environment jsdom
// Run the published recipe itself: STATE marks busy before LLM, so guarding the new state
// would silently prevent every subsequent summary request after BOOTSTRAP completes.
import {it, expect} from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import ts from 'typescript'
import {renderComponent} from 'sygnal'

it('the on-device summary recipe retries after completion and ignores an already busy action', async()=>{
  const here=path.dirname(fileURLToPath(import.meta.url))
  const page=fs.readFileSync(path.join(here,'../docs/src/content/docs/recipes/ai-summarize.md'),'utf8')
  const source=/```jsx live[^\n]*\n([\s\S]*?)\n```/.exec(page)?.[1]
  expect(source).toBeTruthy()
  const dir=fs.mkdtempSync(path.join(here,'.p12-recipes-'))
  let t
  try {
    const file=path.join(dir,'Article.mjs')
    fs.writeFileSync(file,ts.transpileModule(source+'\nexport {Article}',{fileName:'Article.jsx',compilerOptions:{
      jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'sygnal',module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
    }}).outputText)
    const {Article}=await import(pathToFileURL(file).href)
    t=renderComponent(Article)
    await t.ready()
    expect(t.state.status).toBe('busy')
    expect(t.sinkValues('LLM')).toHaveLength(1)
    t.simulateAction('SUMMARIZE')
    await t.settle()
    expect(t.sinkValues('LLM')).toHaveLength(1)
    await t.respond('LLM','Octopuses have three hearts.')
    expect(t.state.status).toBe('ready')
    t.simulateEvent('.summarize','click')
    await t.settle()
    expect(t.sinkValues('LLM')).toHaveLength(2)
    expect(t.state).toMatchObject({status:'busy',summary:''})
    await t.fail('LLM',Object.assign(new Error('Unavailable'),{status:'unavailable'}))
    expect(t.state.status).toBe('fallback')
    expect(t.html()).toContain('Excerpt:')
  } finally {
    t?.dispose()
    fs.rmSync(dir,{recursive:true,force:true})
  }
})
