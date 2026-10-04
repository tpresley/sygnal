import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { serve } from './lib/server.mjs'
const page = process.argv[2] || 'counters'
const server = await serve(resolve(import.meta.dirname, 'dist'))
const b = await chromium.launch(); const p = await b.newPage()
p.on('pageerror', e => console.log('PAGEERROR', e.message, e.stack?.split('\n').slice(0,4).join(' | ')))
p.on('console', m => console.log('CONSOLE', m.type(), m.text()))
await p.goto(`${server.url}/next/apps/next/${page}.html`)
await p.waitForTimeout(500)
console.log((await p.innerHTML('#main')).slice(0, 400))
for (const a of process.argv.slice(3)) { await p.click(a); await p.waitForTimeout(100); console.log('after', a, (await p.innerHTML('#main')).slice(0, 600)) }
await b.close(); server.close?.(); process.exit(0)
