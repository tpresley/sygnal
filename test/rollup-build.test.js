import {it, expect, afterEach} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'

const require = createRequire(import.meta.url)
const rollup = require.resolve('rollup')
const cli = path.join(path.dirname(rollup), 'bin/rollup')
const plugin = pathToFileURL(fileURLToPath(new URL('../scripts/rollup-typescript.mjs', import.meta.url))).href
const dirs = []
afterEach(() => {for (const dir of dirs.splice(0)) fs.rmSync(dir, {recursive: true, force: true})})
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-rollup-test-')); dirs.push(dir)
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'src/constants.ts'), 'export const enum Numbers { Current = 1 }\n')
  fs.writeFileSync(path.join(dir, 'src/main.ts'), "import {Numbers} from './constants'; export const value = Numbers.Current;\n")
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({compilerOptions: {
    target: 'ES2020', lib: ['ES2020'], module: 'ESNext', moduleResolution: 'bundler',
    rootDir: './src', outDir: './dist', sourceMap: true, inlineSources: true, strict: true, skipLibCheck: true,
  }, include: ['src/**/*.ts']}))
  return dir
}
function run(dir, args) {
  return spawnSync(process.execPath, args, {cwd: dir, encoding: 'utf8', timeout: 20000,
    env: {...process.env, NODE_OPTIONS: ''}})
}
function completed(result) {
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.signal, result.stderr).toBeNull()
  expect(result.status, result.stderr).toBe(0)
}

it('ordinary multi-config builds create no compiler file watchers and exit with both formats/maps', () => {
  const dir = fixture()
  fs.writeFileSync(path.join(dir, 'rollup.config.mjs'), `import typescript from ${JSON.stringify(plugin)};
const probe = () => ({name:'watcher-probe',buildStart(){
 const watchers=process.getActiveResourcesInfo().filter(n=>/FSEvent|FSWatcher|StatWatcher/.test(n));
 if(watchers.length)this.error('Ordinary build opened file watchers: '+watchers);
}});
export default [0,1].map(i=>({input:'src/main.ts',plugins:[typescript({tsconfig:'./tsconfig.json'}),probe()],
 output:[{file:'dist/'+i+'.mjs',format:'es',sourcemap:true},{file:'dist/'+i+'.cjs',format:'cjs',sourcemap:true}]}));`)
  completed(run(dir, [cli, '-c']))
  for (const name of ['0.mjs', '0.cjs', '1.mjs', '1.cjs']) {
    expect(fs.readFileSync(path.join(dir, 'dist', name), 'utf8')).toMatch(/value\s*=\s*1/)
    const map = JSON.parse(fs.readFileSync(path.join(dir, 'dist', name + '.map'), 'utf8'))
    expect(map.sourcesContent.join('\n')).toContain('Numbers.Current')
  }
}, 25000)

it('watch keeps compiling after result.close, follows erased dependencies, and closes pending updates', () => {
  const dir = fixture()
  fs.writeFileSync(path.join(dir, 'watch.mjs'), `import {watch} from ${JSON.stringify(pathToFileURL(rollup).href)};
import typescript from ${JSON.stringify(plugin)};
import fs from 'node:fs'; import assert from 'node:assert/strict';
const watcher=watch({input:'src/main.ts',plugins:[typescript({tsconfig:'./tsconfig.json'})],output:{file:'dist/watch.js',format:'es',sourcemap:true}});
let builds=0;
watcher.on('event',async e=>{try{
 if(e.code==='ERROR')throw e.error;
 if(e.code!=='BUNDLE_END')return;
 await e.result.close();
 const code=fs.readFileSync('dist/watch.js','utf8');builds++;console.error('watch-build',builds);await new Promise(r=>setTimeout(r,100));
 if(builds===1){assert.match(code,/value\\s*=\\s*1/);fs.writeFileSync('src/constants.ts','export const enum Numbers { Current = 2 }\\n');}
 else if(builds===2){assert.match(code,/value\\s*=\\s*2/);fs.writeFileSync('src/main.ts',"import {Numbers} from './constants'; export const value=Numbers.Current+10;\\n");}
 else if(builds===3){assert.match(code,/2[^;]*\\+\\s*10/);fs.writeFileSync('src/constants.ts','export const enum Numbers { Current = 3 }\\n');setTimeout(async()=>{await watcher.close();console.log('watch-finished');},25);}
 }catch(error){console.error(error);process.exitCode=1;setTimeout(()=>watcher.close(),0);}});`)
  const result = run(dir, ['watch.mjs'])
  completed(result)
  expect(result.stdout).toContain('watch-finished')
}, 25000)

it('a compiler failure exits normally rather than retaining watcher resources', () => {
  const dir = fixture()
  fs.writeFileSync(path.join(dir, 'src/main.ts'), 'export const value: string = 1;\n')
  fs.writeFileSync(path.join(dir, 'rollup.config.mjs'), `import typescript from ${JSON.stringify(plugin)};
export default {input:'src/main.ts',plugins:[typescript({tsconfig:'./tsconfig.json',noEmitOnError:true})],output:{file:'dist/main.js',format:'es'}};`)
  const result = run(dir, [cli, '-c'])
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.signal, result.stderr).toBeNull()
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('TS2322')
}, 25000)
