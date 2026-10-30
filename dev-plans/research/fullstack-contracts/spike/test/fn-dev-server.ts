// globalSetup: a Vite dev server with serverFunctions() (esbuild can't start inside jsdom)
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { serverFunctions } from '../lib/vite-server-functions.ts'

export default async function setup(project: any) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const vite = await createServer({ root, configFile: false, logLevel: 'silent', plugins: [serverFunctions()], server: { port: 0, host: '127.0.0.1' } })
  await vite.listen()
  const a: any = vite.httpServer!.address()
  project.provide('fnBase', `http://127.0.0.1:${a.port}`)
  return () => vite.close()
}
