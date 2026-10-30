import { serve } from '@hono/node-server'
import { makeApp } from './server.ts'

declare const process: { env: Record<string, string | undefined> }
const port = Number(process.env.PORT ?? 8787)
serve({ fetch: makeApp().fetch, port }, () => console.log(`rpc on http://localhost:${port}/rpc`))
