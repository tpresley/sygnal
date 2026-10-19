// @vitest-environment jsdom
// Execute the actual published JSX so host after timing and focus commands cannot drift.
import {afterAll, afterEach, beforeAll, expect, it} from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import ts from 'typescript'
import {renderComponent} from 'sygnal'
let dir, Editor, t
beforeAll(async()=>{
 const here=path.dirname(fileURLToPath(import.meta.url))
 const page=fs.readFileSync(path.join(here,'../docs/src/content/docs/ui/tabs.md'),'utf8')
 const source=page.slice(page.indexOf('## Closable tabs')).match(/```jsx live[^\n]*\n([\s\S]*?)\n```/)?.[1]
 expect(source).toBeTruthy()
 dir=fs.mkdtempSync(path.join(here,'.p11-tabs-guide-'))
 const file=path.join(dir,'Editor.mjs')
 fs.writeFileSync(file,ts.transpileModule(source+'\nexport {Editor}',{fileName:'Editor.jsx',compilerOptions:{
  jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'sygnal',module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
 }}).outputText)
 ;({Editor}=await import(pathToFileURL(file).href))
})
afterEach(()=>{t?.dispose();t=null})
afterAll(()=>{if(dir)fs.rmSync(dir,{recursive:true,force:true})})
it.each([['readme','main'],['main','styles'],['styles','main']])('closing selected %s focuses its neighbor %s',async(id,neighbor)=>{
 t=renderComponent(Editor,{dom:'real'});await t.ready()
 t.query(`.tab[data-value="${id}"]`).click();await t.settle()
 expect(t.state.tabs.selected).toBe(id)
 const close=t.query(`.close[data-value="${id}"]`);close.focus();close.click();await t.settle()
 expect(t.state.files.some(f=>f.id===id)).toBe(false)
 expect(t.state.tabs.selected).toBe(neighbor)
 expect(document.activeElement).toBe(t.query(`.tab[data-value="${neighbor}"]`))
 t.expectNoDiagnostics()
})
it('closing the final remaining tab emits no invalid focus command',async()=>{
 t=renderComponent(Editor,{dom:'real'});await t.ready()
 for(const id of ['readme','main','styles']){
  t.query(`.tab[data-value="${id}"]`).click();await t.settle()
  t.query(`.close[data-value="${id}"]`).click();await t.settle()
 }
 expect(t.state.files).toEqual([]);expect(t.state.tabs.selected).toBeNull()
 t.expectNoDiagnostics()
})
